import { v4 as uuid } from "uuid";
import type { FactCheckResult, SummaryItem, VideoRecord } from "./types";
import type { YoutubeMeta } from "./youtube";
import { detectReportType } from "./report";
import type { ReportType } from "./types";
import { buildFactCheckPrompt } from "./text-format";

export type SummaryMeta = YoutubeMeta & {
  transcriptSource:
    | "youtube"
    | "youtube_auto"
    | "speech_text"
    | "pasted"
    | "creator_meta"
    | "none";
  videoId?: string;
};

export function hasLlm(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

function parseJsonLoose<T>(raw: string): T | null {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      try {
        return JSON.parse(fenced[1].trim()) as T;
      } catch {
        /* continue */
      }
    }
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function chatJson<T>(
  system: string,
  user: string,
  opts?: { maxTokens?: number; temperature?: number }
): Promise<T | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    console.error("[pipeline] OPENAI_API_KEY 없음 — AI 요약 불가");
    return null;
  }
  const base = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: opts?.temperature ?? 0.25,
      max_tokens: opts?.maxTokens ?? 8_000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("[pipeline] LLM JSON error", res.status, err.slice(0, 400));
    throw new Error(`LLM error: ${res.status} ${err}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) return null;
  return parseJsonLoose<T>(content);
}

/** JSON 없이 상세 요약 본문만 받기 (안정적) */
async function chatText(
  system: string,
  user: string,
  opts?: { maxTokens?: number; temperature?: number }
): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    console.error("[pipeline] OPENAI_API_KEY 없음 — AI 요약 불가");
    return null;
  }
  const base = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: opts?.temperature ?? 0.3,
      max_tokens: opts?.maxTokens ?? 8_000,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("[pipeline] LLM text error", res.status, err.slice(0, 400));
    throw new Error(`LLM error: ${res.status} ${err}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content?.trim();
  return content || null;
}

const DETAILED_TEXT_SYSTEM = `당신은 한국어 유튜브 강연 심층 요약가입니다.
스크립트의 세부 내용·과학적 근거·논리 전개를 살려 **구체적이고 상세하게** 요약합니다.

반드시 아래 형식으로만 작성하세요 (마크다운 기호 ### 없이 평문):

제공해주신 강연 녹취록의 세부 내용과 과학적 근거, 논리 전개 과정을 모두 살려 구체적이고 상세하게 요약합니다.

1. (대주제 제목)
• (소주제): (2~5문장 상세 설명. 고유명사·연대·수치·학명·비유 포함)
• (소주제): …

2. (대주제 제목)
• …

(대주제 4~8개)

최종 결론
(3~6문장. 영상의 핵심 메시지)

금지: 한 줄 요약, 자막 복붙, 같은 구절 반복, "살펴본다/소개한다", 초반만 쓰기.`;

function bulletsFromDetailedOverview(overview: string): string[] {
  return overview
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => /^\d+\.\s+/.test(l))
    .slice(0, 12);
}

/**
 * 수동 요약 텍스트 → 팩트체크 대상 항목 (LLM 없이 즉시).
 * `1. 제목` + 아래 `•` 줄을 한 항목으로 묶습니다.
 */
export function itemsFromManualOverview(
  overview: string,
  videoId?: string
): { summaryBullets: string[]; items: SummaryItem[] } {
  const lines = overview
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  type Sec = { title: string; details: string[] };
  const sections: Sec[] = [];
  let current: Sec | null = null;

  for (const line of lines) {
    if (/^최종\s*결론/.test(line) || /^결론\s*[:：]?/.test(line)) {
      current = null;
      continue;
    }
    // 1. / 1) / 1、 / ## 제목
    const numbered = line.match(
      /^(?:#{1,3}\s+)?(?:\d+[\.\)]\s+|[\u2460-\u2473]\s*)(.+)$/
    );
    if (numbered) {
      current = { title: numbered[1].trim(), details: [] };
      sections.push(current);
      continue;
    }
    const bullet = line.match(/^[•\-·*]\s*(.+)$/);
    if (bullet && current) {
      current.details.push(bullet[1].trim());
      continue;
    }
    // 번호 없는 긴 문장도 항목으로 (결론 구간 제외)
    if (!current && line.length >= 40 && !/^「/.test(line)) {
      sections.push({ title: line.slice(0, 160), details: [] });
    } else if (current && line.length >= 20 && !bullet) {
      current.details.push(line);
    }
  }

  const usable = sections
    .map((s) => ({
      title: s.title.replace(/\s+/g, " ").trim(),
      detail: s.details.join(" ").replace(/\s+/g, " ").trim(),
    }))
    .filter((s) => s.title.length >= 8)
    .slice(0, 12);

  if (!usable.length) {
    // 번호 구조가 없으면 문장 단위로 — 근거 확인 필요한 것만
    const dens = pickDenseSentences(overview, 14)
      .map((s) => stripSpokenCruff(s))
      .filter((s) => s.length >= 24);
    const items: SummaryItem[] = [];
    for (const s of dens) {
      const c = isFactCheckWorthy(s);
      if (!c.worthy || c.type === "info") continue;
      const statement = s.length > 140 ? `${s.slice(0, 137)}…` : s;
      const detail = "수치·시기·인명·인과·출처를 교차 확인";
      items.push(
        toItem(
          statement,
          c.type,
          true,
          videoId,
          items.length,
          undefined,
          detail,
          aiPromptFor(statement, detail)
        )
      );
      if (items.length >= 8) break;
    }
    return {
      summaryBullets: items.map((it, i) => `${i + 1}. ${it.statement}`),
      items,
    };
  }

  const items: SummaryItem[] = [];
  for (const s of usable) {
    const picked = pickFactCheckStatement(s.title, s.detail);
    if (!picked) continue;
    items.push(
      toItem(
        picked.statement,
        picked.type,
        true,
        videoId,
        items.length,
        undefined,
        picked.detail.slice(0, 500),
        aiPromptFor(picked.statement, picked.detail.slice(0, 280))
      )
    );
    if (items.length >= 8) break;
  }

  return {
    summaryBullets: usable.map((s, i) => `${i + 1}. ${s.title}`),
    items,
  };
}

/**
 * 요약 본문이 바뀌면 팩트체크 대상·가이드를 요약 기준으로 전부 다시 맞춤.
 * (이전 항목/답변은 유지하지 않음 — 요약과 어긋나지 않게)
 */
export function rebuildFactChecksFromOverview(
  overview: string,
  videoId?: string,
  summaryBullets?: string[]
): {
  summaryBullets: string[];
  items: SummaryItem[];
  factChecks: FactCheckResult[];
} {
  const parsed = itemsFromManualOverview(overview, videoId);
  const bullets =
    summaryBullets?.map((b) => b.trim()).filter(Boolean) ??
    (parsed.summaryBullets.length
      ? parsed.summaryBullets
      : overview
          .split(/\n+/)
          .map((l) => l.trim())
          .filter((l) => /^\d+[\.\)]\s+/.test(l))
          .slice(0, 12));

  const items = parsed.items;
  return {
    summaryBullets: bullets.length ? bullets : parsed.summaryBullets,
    items,
    factChecks: syncFactCheckGuides(items),
  };
}

/** 수동 요약 저장용 — LLM 없이 즉시 팩트체크 가이드 생성 */
export function syncFactCheckGuides(items: SummaryItem[]): FactCheckResult[] {
  return heuristicGuides(items.filter((i) => i.needsFactCheck));
}

async function summarizeDetailedText(
  meta: SummaryMeta,
  chapterList: string,
  script: string
): Promise<string | null> {
  const chunks = splitTranscriptChunks(script);
  try {
    if (chunks.length === 1) {
      const text = await chatText(
        DETAILED_TEXT_SYSTEM,
        [
          `제목: ${meta.title}`,
          `채널: ${meta.channel}`,
          `챕터:\n${chapterList}`,
          `스크립트:\n${chunks[0]}`,
        ].join("\n\n"),
        { maxTokens: 8_000 }
      );
      return text && text.length >= 400 ? text : text;
    }

    const parts = await Promise.all(
      chunks.map((chunk, i) =>
        chatText(
          DETAILED_TEXT_SYSTEM +
            `\n지금은 전체 중 구간 ${i + 1}/${chunks.length}만 상세 요약하세요. 번호는 구간 안에서 1부터.`,
          [
            `제목: ${meta.title}`,
            `구간 ${i + 1}/${chunks.length}`,
            `챕터:\n${chapterList}`,
            `스크립트:\n${chunk}`,
          ].join("\n\n"),
          { maxTokens: 5_000 }
        )
      )
    );
    const ok = parts.filter((p): p is string => Boolean(p && p.length > 100));
    if (!ok.length) return null;

    const merged = await chatText(
      DETAILED_TEXT_SYSTEM +
        `\n여러 구간 요약을 하나의 완성본으로 합치세요. 구간 표시를 남기지 마세요.`,
      [
        `제목: ${meta.title}`,
        `채널: ${meta.channel}`,
        ...ok.map((p, i) => `--- 구간 ${i + 1} ---\n${p}`),
      ].join("\n\n"),
      { maxTokens: 8_000 }
    );
    if (merged && merged.length >= 400) return merged;
    return ok.join("\n\n");
  } catch (e) {
    console.error("[pipeline] summarizeDetailedText failed", e);
    return null;
  }
}

export interface SummarizeResult {
  overview: string;
  summaryBullets: string[];
  items: SummaryItem[];
  reportType: ReportType;
  summarySource: "ai" | "fallback";
}

function cleanTranscript(text: string): string {
  return text
    .replace(/^번역:\s*[^\n]+(?:\s*검토:\s*[^\n]+)?\s*/i, "")
    .replace(/>>+/g, " ")
    .replace(/\[[^\]]{0,40}\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** LLM 한 번에 넣을 스크립트 길이. 대부분 영상은 1회로 처리. */
const SCRIPT_PER_CALL = 48000;
const SCRIPT_OVERLAP = 600;
const MAX_SCRIPT_CHUNKS = 6;

function splitTranscriptChunks(text: string): string[] {
  if (text.length <= SCRIPT_PER_CALL) return [text];

  let chunkSize = SCRIPT_PER_CALL;
  const approx = Math.ceil(text.length / SCRIPT_PER_CALL);
  if (approx > MAX_SCRIPT_CHUNKS) {
    chunkSize = Math.ceil(text.length / MAX_SCRIPT_CHUNKS);
  }

  const chunks: string[] = [];
  let start = 0;
  while (start < text.length && chunks.length < MAX_SCRIPT_CHUNKS) {
    let end = Math.min(start + chunkSize, text.length);
    if (end < text.length) {
      const slice = text.slice(start, end);
      const breaks = [". ", "? ", "! ", "。", "？", "！"].map((b) =>
        slice.lastIndexOf(b)
      );
      const lastBreak = Math.max(...breaks);
      if (lastBreak > chunkSize * 0.45) {
        end = start + lastBreak + 1;
      }
    }
    const piece = text.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= text.length) break;
    start = Math.max(0, end - SCRIPT_OVERLAP);
  }

  return chunks.length ? chunks : [text];
}

type LlmPoint = { label?: string; text: string };
type LlmSection = { title: string; points?: LlmPoint[]; body?: string };

type LlmSummary = {
  /** 레거시: 한 덩어리 문자열 (잘리면 파싱 실패하기 쉬움) */
  overview?: string;
  intro?: string;
  sections?: LlmSection[];
  conclusion?: string;
  summaryBullets?: string[];
  factPoints?: Array<{
    statement: string;
    detail?: string;
    checkGuide?: string;
    type?: "claim" | "opinion" | "info";
    needsFactCheck?: boolean;
    chapterTimestamp?: string;
  }>;
  reportTypeHint?: ReportType;
};

/** 섹션 JSON → 예시와 같은 상세 본문 */
function assembleDetailedOverview(llm: LlmSummary): string {
  const parts: string[] = [];
  const intro = (llm.intro ?? "").trim();
  if (intro) parts.push(intro);

  const sections = llm.sections ?? [];
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    if (!s?.title?.trim()) continue;
    const title = s.title.trim().replace(/^\d+\.\s*/, "");
    parts.push(`${i + 1}. ${title}`);

    const points = s.points?.filter((p) => p?.text?.trim()) ?? [];
    if (points.length) {
      for (const p of points) {
        const label = (p.label ?? "").trim();
        const text = p.text.trim();
        parts.push(label ? `• ${label}: ${text}` : `• ${text}`);
      }
    } else if (s.body?.trim()) {
      parts.push(s.body.trim());
    }
    parts.push(""); // blank line between sections
  }

  const conclusion = (llm.conclusion ?? "").trim();
  if (conclusion) {
    parts.push("최종 결론");
    parts.push(conclusion);
  }

  const assembled = parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (assembled.length >= 120) return assembled;

  // 섹션이 없으면 레거시 overview 사용
  return (llm.overview ?? "").trim();
}

function isUsableLlmSummary(llm: LlmSummary | null | undefined): llm is LlmSummary {
  if (!llm) return false;
  const overview = assembleDetailedOverview(llm);
  const bullets = (llm.summaryBullets ?? []).filter((b) => b?.trim());
  const sectionCount = llm.sections?.filter((s) => s?.title?.trim()).length ?? 0;
  return (
    overview.length >= 200 ||
    sectionCount >= 3 ||
    (overview.length >= 80 && bullets.length >= 3)
  );
}

function normalizeLlmSummary(llm: LlmSummary): LlmSummary {
  const overview = assembleDetailedOverview(llm);
  let bullets = (llm.summaryBullets ?? [])
    .map((b) => String(b).trim())
    .filter(Boolean);

  if (!bullets.length && llm.sections?.length) {
    bullets = llm.sections
      .map((s, i) => `${i + 1}. ${(s.title ?? "").replace(/^\d+\.\s*/, "").trim()}`)
      .filter((t) => t.length > 3);
  }
  if (!bullets.length && overview) {
    bullets = overview
      .split(/\n+/)
      .map((l) => l.trim())
      .filter((l) => /^\d+\./.test(l) || l.startsWith("최종"))
      .slice(0, 12);
  }

  return {
    ...llm,
    overview:
      overview ||
      bullets.slice(0, 6).join("\n") ||
      "요약을 생성하지 못했습니다.",
    summaryBullets: bullets,
    factPoints: llm.factPoints ?? [],
  };
}

const SECTION_JSON_SCHEMA = `JSON만 반환 (overview 한 덩어리 문자열 금지 — 반드시 sections 배열):
{
  "intro": "강연 녹취록의 논리·근거를 살린 상세 요약입니다. (1~2문장)",
  "sections": [
    {
      "title": "인간 진화에 대한 패러다임 전환: 사다리가 아니라 나무다",
      "points": [
        { "label": "흔한 오해와 교과서 그림의 오류", "text": "2~5문장의 구체적 설명(고유명사·비유 포함)" },
        { "label": "사촌 관계인 인간과 침팬지", "text": "…" }
      ]
    }
  ],
  "conclusion": "최종 결론 문단 (3~6문장, 핵심 메시지)",
  "summaryBullets": ["1. 대주제 제목", "2. …"],
  "factPoints": [{
    "statement": "근거 확인이 필요한 사실 단정·주장·의견만 (수치·시기·인명·인과 포함)",
    "detail": "왜 교차검증이 필요한지",
    "checkGuide": "AI 팩트체크 질문 한 문장",
    "type": "claim|opinion",
    "needsFactCheck": true,
    "chapterTimestamp": ""
  }],
  ※ factPoints 금지: 목차 소제목, '~총정리/소개/알아보기', 메타 문장, 검증 포인트 없는 서술.
  ※ factPoints 허용: 숫자·연도·효과·인과·연구 인용·인명 관련 단정, 또는 근거가 필요한 의견.
  "reportTypeHint": "C"
}

형식 요구:
- sections 4~8개. 각 points 2~6개.
- label은 굵은 소제목, text는 상세 설명(연대·학명·수치·장소가 있으면 반드시).
- 자막 복붙·구어체·반복 문구·초반만 요약 금지.
- 시청자가 영상 없이도 논증을 따라갈 수 있을 만큼 구체적으로.`;

function summarizeSystemPrompt(
  reportType: ReportType,
  opts: { hasChapters: boolean; partHint?: string; mode?: "full" | "part" | "merge" }
) {
  const mode = opts.mode ?? "full";
  const chapterRule = opts.hasChapters
    ? "챕터 순서를 뼈대로 쓰되 각 주제를 풍부하게 풀어 쓰세요."
    : "챕터가 없어도 스크립트 전체 논증을 대주제 단위로 재구성하세요.";

  if (mode === "merge") {
    return `당신은 한국어 유튜브 심층 요약 편집자입니다.
여러 구간 요약을 하나의 완성된 상세 요약(sections)으로 재구성하세요.
구간 표시를 남기지 말고, 중복을 합치고, 고유명사·연대·논증을 복구하세요.
${opts.partHint ? opts.partHint : ""}

reportTypeHint 기본값: "${reportType}"
${SECTION_JSON_SCHEMA}`;
  }

  const scope =
    mode === "part"
      ? "이 구간의 주장·사례·고유명사만 상세히 (압축 금지)."
      : "영상 전체. 초반만 쓰지 마세요.";

  return `당신은 한국어 유튜브 심층 요약가입니다.
목표: 강연 녹취록의 세부 내용·과학적 근거·논리 전개를 살린 **구체적이고 상세한** 요약.
${chapterRule}
${scope}
금지: 한 줄 요약, 자막 복붙, 같은 구절 반복, "살펴본다/소개한다".
${opts.partHint ? opts.partHint : ""}

reportTypeHint 기본값: "${reportType}"
${SECTION_JSON_SCHEMA}`;
}

async function summarizeOnce(
  reportType: ReportType,
  hasChapters: boolean,
  user: string,
  mode: "full" | "part" | "merge",
  partHint?: string
): Promise<LlmSummary | null> {
  try {
    const llm = await chatJson<LlmSummary>(
      summarizeSystemPrompt(reportType, { hasChapters, mode, partHint }),
      user,
      { maxTokens: mode === "part" ? 6_000 : 10_000, temperature: 0.2 }
    );
    if (isUsableLlmSummary(llm)) return normalizeLlmSummary(llm);
  } catch {
    /* retry below */
  }

  try {
    const llm = await chatJson<LlmSummary>(
      `한국어 상세 요약. sections 배열 필수. 각 포인트 2~5문장. 고유명사·연대 포함. 반복 금지.
reportTypeHint="${reportType}"
${SECTION_JSON_SCHEMA}`,
      user,
      { maxTokens: 8_000, temperature: 0.15 }
    );
    if (isUsableLlmSummary(llm)) return normalizeLlmSummary(llm);
  } catch {
    return null;
  }
  return null;
}

function isChatter(text: string): boolean {
  return /머그컵|굿즈|다이어리|구독|인스타|제휴|인사하고|팬들이|옷도|티셔츠|히스토리입니다|기말고사|촬영 기준/.test(
    text
  );
}

function hasRealScript(meta: SummaryMeta, transcript: string): boolean {
  const cleaned = cleanTranscript(transcript);
  return (
    (meta.transcriptSource === "pasted" ||
      meta.transcriptSource === "youtube" ||
      meta.transcriptSource === "youtube_auto" ||
      meta.transcriptSource === "speech_text") &&
    cleaned.length > 80 &&
    !cleaned.startsWith("제목:")
  );
}

function packSummaryResult(
  llm: LlmSummary,
  meta: SummaryMeta,
  cleanedTranscript: string,
  reportType: ReportType
): SummarizeResult {
  const normalized = normalizeLlmSummary(llm);
  const rt =
    normalized.reportTypeHint &&
    ["H", "S", "C", "P"].includes(normalized.reportTypeHint)
      ? normalized.reportTypeHint
      : reportType;

  const rawPoints = (normalized.factPoints ?? []).filter(
    (p) => p.statement && !isVagueClaim(p.statement)
  );
  const seen = new Set<string>();
  const deduped = rawPoints.filter((p) => {
    const key = p.statement
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
      .slice(0, 80);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const items = deduped
    .map((p, idx) => {
      const judged = isFactCheckWorthy(p.statement, p.detail);
      if (!judged.worthy) return null;
      const type =
        p.type === "opinion" || p.type === "claim" ? p.type : judged.type;
      if (type === "info") return null;
      return toItem(
        p.statement,
        type,
        true,
        meta.videoId,
        idx,
        p.chapterTimestamp,
        p.detail,
        p.checkGuide || aiPromptFor(p.statement, p.detail)
      );
    })
    .filter((x): x is SummaryItem => Boolean(x))
    .slice(0, 8);

  const summaryBullets = normalized.summaryBullets ?? [];
  const bullets = summaryBullets.filter((b) => !isVagueClaim(b));

  return {
    overview: normalized.overview ?? "",
    summaryBullets: bullets.length
      ? bullets
      : summaryBullets.slice(0, 12),
    items: items.length ? items : chapterOrderClaims(meta, cleanedTranscript),
    reportType: rt,
    summarySource: "ai",
  };
}

/** 1) 방송(챕터) 순서 기준 주요 내용 요약 + 팩트체크 항목 */
export async function summarizeContent(
  meta: SummaryMeta,
  transcript: string
): Promise<SummarizeResult> {
  const reportType = detectReportType({
    title: meta.title,
    description: meta.description,
    overview: "",
    chapters: meta.chapters,
  });
  const cleanedTranscript = cleanTranscript(transcript);
  const scriptMode = hasRealScript(meta, cleanedTranscript);
  const hasChapters = meta.chapters.length > 0;
  const chapterList = hasChapters
    ? meta.chapters.map((c) => `${c.timestamp} ${c.title}`).join("\n")
    : "(챕터 없음 — 스크립트 전체 흐름으로 요약)";

  // 0) API 키 없으면 원인을 분명히 표시
  if (!hasLlm()) {
    const fb = chapterOrderFallback(
      meta,
      cleanedTranscript,
      reportType,
      scriptMode
    );
    return {
      ...fb,
      summarySource: "fallback",
      overview: [
        "⚠️ OPENAI_API_KEY가 설정되지 않아 AI 상세 요약을 만들 수 없습니다.",
        ".env.local에 OPENAI_API_KEY를 넣은 뒤 개발 서버를 재시작하고 「스크립트 기준 재요약」을 눌러 주세요.",
        "",
        fb.overview,
      ].join("\n"),
    };
  }

  // 1) 평문 상세 요약 (JSON보다 안정적 · 예시 형식)
  if (scriptMode && cleanedTranscript.length > 80) {
    const detailed = await summarizeDetailedText(
      meta,
      chapterList,
      cleanedTranscript
    );
    if (detailed && detailed.length >= 350) {
      let items = chapterOrderClaims(meta, cleanedTranscript);
      try {
        const facts = await chatJson<{
          factPoints?: LlmSummary["factPoints"];
        }>(
          `스크립트 요약을 보고 **근거 확인이 필요한** 사실 단정·주장·의견만 6~10개 JSON으로.
목차/총정리/소개성 소제목은 제외. 수치·시기·인명·인과·연구 인용·의견(근거 필요)만.
{"factPoints":[{"statement":"…","detail":"…","checkGuide":"…","type":"claim|opinion","needsFactCheck":true}]}`,
          `제목: ${meta.title}\n\n요약:\n${detailed.slice(0, 6000)}`,
          { maxTokens: 2_500, temperature: 0.2 }
        );
        if (facts?.factPoints?.length) {
          items = facts.factPoints
            .filter((p) => p?.statement && !isVagueClaim(p.statement))
            .map((p, idx) => {
              const judged = isFactCheckWorthy(p.statement, p.detail);
              if (!judged.worthy || judged.type === "info") return null;
              const type =
                p.type === "opinion" || p.type === "claim"
                  ? p.type
                  : judged.type;
              return toItem(
                p.statement,
                type,
                true,
                meta.videoId,
                idx,
                p.chapterTimestamp,
                p.detail,
                p.checkGuide || aiPromptFor(p.statement, p.detail)
              );
            })
            .filter((x): x is SummaryItem => Boolean(x))
            .slice(0, 8);
        }
      } catch (e) {
        console.error("[pipeline] factPoints extract failed", e);
      }

      return {
        overview: detailed.trim(),
        summaryBullets: bulletsFromDetailedOverview(detailed),
        items: items.length
          ? items
          : chapterOrderClaims(meta, cleanedTranscript),
        reportType,
        summarySource: "ai",
      };
    }
  }

  if (!scriptMode) {
    const sourceBlock = [
      `【스크립트 약함 — 가능한 범위에서 상세 요약】`,
      `제목: ${meta.title}`,
      `채널: ${meta.channel}`,
      `방송 순서(챕터):\n${chapterList}`,
      meta.description ? `설명:\n${meta.description.slice(0, 5000)}` : "",
      cleanedTranscript
        ? `보조 텍스트:\n${cleanedTranscript.slice(0, 12000)}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const textOnly = await chatText(
      DETAILED_TEXT_SYSTEM,
      sourceBlock,
      { maxTokens: 6_000 }
    );
    if (textOnly && textOnly.length >= 300) {
      return {
        overview: textOnly,
        summaryBullets: bulletsFromDetailedOverview(textOnly),
        items: chapterOrderClaims(meta, cleanedTranscript),
        reportType,
        summarySource: "ai",
      };
    }

    const llm = await summarizeOnce(
      reportType,
      hasChapters,
      sourceBlock,
      "full"
    );
    if (llm) {
      return packSummaryResult(llm, meta, cleanedTranscript, reportType);
    }
    return chapterOrderFallback(meta, cleanedTranscript, reportType, scriptMode);
  }

  const chunks = splitTranscriptChunks(cleanedTranscript);

  try {
    if (chunks.length === 1) {
      const sourceBlock = [
        `【상세 요약 요청】`,
        `제목: ${meta.title}`,
        `채널: ${meta.channel}`,
        `방송 순서(챕터):\n${chapterList}`,
        `스크립트 분량: ${cleanedTranscript.length}자`,
        `요청: 과학적 근거·논리 전개·고유명사·연대를 모두 살려 상세히. sections 배열로.`,
        `스크립트:\n${chunks[0]}`,
      ].join("\n\n");

      const llm = await summarizeOnce(
        reportType,
        hasChapters,
        sourceBlock,
        "full"
      );
      if (llm) {
        return packSummaryResult(llm, meta, cleanedTranscript, reportType);
      }
    } else {
      const settled = await Promise.allSettled(
        chunks.map((chunk, i) =>
          summarizeOnce(
            reportType,
            hasChapters,
            [
              `【구간 ${i + 1}/${chunks.length} 상세 요약】`,
              `제목: ${meta.title}`,
              `챕터:\n${chapterList}`,
              `스크립트:\n${chunk}`,
            ].join("\n\n"),
            "part",
            `구간 ${i + 1}만. 압축 금지.`
          )
        )
      );

      const ok = settled
        .map((r) => (r.status === "fulfilled" ? r.value : null))
        .filter((v): v is LlmSummary => Boolean(v));

      if (ok.length) {
        const mergeUser = [
          `제목: ${meta.title}`,
          `채널: ${meta.channel}`,
          `챕터:\n${chapterList}`,
          `아래 ${ok.length}개 구간 요약을 하나의 상세 sections 요약으로 합치세요.`,
          ...ok.map(
            (p, i) => `--- 구간 ${i + 1} ---\n${p.overview ?? ""}`
          ),
        ].join("\n\n");

        const mergedLlm = await summarizeOnce(
          reportType,
          hasChapters,
          mergeUser,
          "merge"
        );

        if (mergedLlm) {
          if (!(mergedLlm.factPoints?.length)) {
            mergedLlm.factPoints = ok.flatMap((p) => p.factPoints ?? []);
          }
          return packSummaryResult(
            mergedLlm,
            meta,
            cleanedTranscript,
            reportType
          );
        }

        const merged: LlmSummary = {
          overview: ok.map((p) => p.overview).join("\n\n"),
          sections: ok.flatMap((p) => p.sections ?? []),
          summaryBullets: ok.flatMap((p) => p.summaryBullets ?? []),
          factPoints: ok.flatMap((p) => p.factPoints ?? []),
          reportTypeHint: ok.find((p) => p.reportTypeHint)?.reportTypeHint,
        };
        return packSummaryResult(
          normalizeLlmSummary(merged),
          meta,
          cleanedTranscript,
          reportType
        );
      }
    }
  } catch {
    /* fallback */
  }

  return chapterOrderFallback(meta, cleanedTranscript, reportType, scriptMode);
}

function isVagueClaim(text: string): boolean {
  return /논의|소개|다룹|살펴|설명합|알아보|정리합|이야기합|언급합|리뷰|총정리|개요|목차/.test(
    text
  );
}

/**
 * 팩트체크 대상: 근거 확인이 필요한 사실 단정(수치·시기·인명·인과)·주장·의견만.
 * 목차성 소제목·메타 문장은 제외.
 */
export function isFactCheckWorthy(
  statement: string,
  detail?: string
): { worthy: boolean; type: "claim" | "opinion" | "info" } {
  const s = statement.replace(/\s+/g, " ").trim();
  const blob = `${s} ${detail ?? ""}`.replace(/\s+/g, " ").trim();
  if (s.length < 12) return { worthy: false, type: "info" };
  if (isVagueClaim(s) || isTopicHeadingOnly(s)) {
    return { worthy: false, type: "info" };
  }
  if (isOpinionNeedingEvidence(blob)) {
    return { worthy: true, type: "opinion" };
  }
  if (hasVerifiableAnchor(blob)) {
    return { worthy: true, type: "claim" };
  }
  // 단정형 서술 (질문·목차 제외)
  if (
    s.length >= 28 &&
    /(?:다|요|죠)[.。]?$/.test(s) &&
    !/(?:할까|일까|무엇|어떤|왜 |어떻게)/.test(s)
  ) {
    return { worthy: true, type: "claim" };
  }
  return { worthy: false, type: "info" };
}

function isTopicHeadingOnly(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (/^(주요 내용|이 영상은|강연 녹취|스크립트|「)/.test(t) && t.length < 80) {
    return true;
  }
  // 짧은 명사구·목차형 (서술 어미 없음)
  if (
    t.length <= 40 &&
    !/(?:다|요|죠|했다|된다|이다|였다|습니다|합니다|주장|효과|위험|때문)/.test(t) &&
    /총정리|요약|소개|개요|정리|리뷰|알아보기|살펴보기|무엇인가|무엇일까/.test(t)
  ) {
    return true;
  }
  return false;
}

/** 수치·시기·인명성 고유표현·인과·연구 근거 등 */
function hasVerifiableAnchor(text: string): boolean {
  return (
    /\d/.test(text) ||
    /[%％]/.test(text) ||
    /\d{2,4}\s*년|세기|년대|\d+\s*월|\d+\s*일/.test(text) ||
    /때문에|인한|원인|결과|로 인해|덕분에|탓에|으로써|상관|인과|증가|감소|효과|부작용|위험|안전|복용|투여|사망|감염|전파/.test(
      text
    ) ||
    /주장|단정|밝혔다|발표|연구|논문|임상|실험|통계|조사|보고|사료|기록|발견|입증|반박/.test(
      text
    ) ||
    /교수|박사|학자|기관|대학|정부|WHO|FDA|질병청/.test(text)
  );
}

function isOpinionNeedingEvidence(text: string): boolean {
  return (
    /해야\s*한다|바람직|필요하다고 보|위험하다고|추천|비추천|반대|찬성|우려|믿어|생각하|의견|보인다면|보는 것|권장|지양/.test(
      text
    ) && text.length >= 18
  );
}

/** 문장/소제목에서 팩트체크용 statement 후보 추출 */
function pickFactCheckStatement(
  title: string,
  detail: string
): { statement: string; detail: string; type: "claim" | "opinion" } | null {
  const titleCheck = isFactCheckWorthy(title, detail);
  if (titleCheck.worthy && titleCheck.type !== "info") {
    return {
      statement: title.length > 160 ? `${title.slice(0, 157)}…` : title,
      detail:
        detail ||
        "수치·시기·인명·인과·출처를 교차 확인",
      type: titleCheck.type,
    };
  }

  // 제목이 목차면 본문 문장에서 근거 확인 필요한 것만
  const dens = pickDenseSentences(`${title}. ${detail}`, 12);
  for (const raw of dens) {
    const s = stripSpokenCruff(raw);
    const c = isFactCheckWorthy(s);
    if (c.worthy && c.type !== "info") {
      return {
        statement: s.length > 160 ? `${s.slice(0, 157)}…` : s,
        detail: detail.slice(0, 500) || "요약·본문의 근거·출처를 교차 확인",
        type: c.type,
      };
    }
  }
  return null;
}

function chapterOrderFallback(
  meta: SummaryMeta,
  transcript: string,
  reportType: ReportType,
  scriptMode: boolean
): SummarizeResult {
  const body = cleanTranscript(
    scriptMode
      ? transcript
      : [meta.description, transcript].filter(Boolean).join("\n")
  );

  if (meta.chapters.length > 0) {
    const lines = meta.chapters.map((c) => {
      const built = specificFromChapter(c.title);
      const fromScript = snippetForChapter(c.title, body);
      const isIntro = /인트로|outro|엔딩|구독/i.test(c.title);
      const brief = isIntro
        ? fromScript ||
          (meta.description
            ? meta.description
                .split(/\n/)
                .find((l) => l.trim().length > 20)
                ?.slice(0, 180) || "출연·주제 소개"
            : "출연·주제 소개")
        : fromScript || built.statement;
      // 챕터별 상세: 핵심 주장 + 왜/맥락
      const detailed = isIntro
        ? brief.replace(/\s+/g, " ").trim()
        : [brief, built.detail].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
      return {
        timestamp: c.timestamp,
        title: c.title,
        brief: brief.replace(/\s+/g, " ").trim(),
        detailed,
        built,
        isIntro,
      };
    });

    const contentChapters = lines.filter((l) => !l.isIntro);
    // overview: 상세 서술만 (타임스탬프 챕터 목록 중복 없음)
    const overview = [
      `「${meta.title}」(${meta.channel}) 주요 내용 요약입니다.${
        scriptMode ? " 스크립트와 방송 순서를 함께 반영했습니다." : " (스크립트 미확보 · 목차·설명 기준)"
      }`,
      `이 영상은 ${contentChapters.map((l) => l.title.replace(/[?？]/g, "")).join(", ")} 순으로 전개됩니다.`,
      ...contentChapters.map(
        (l) =>
          `${l.title.replace(/[?？]/g, "")}: ${l.built.detail || l.brief}`
      ),
    ].join("\n\n");

    // bullets: 방송 순서 1회만 (상세)
    const summaryBullets = lines.map(
      (l) => `${l.timestamp} ${l.title} — ${l.detailed}`
    );

    const items = contentChapters
      .map((l) => {
        const candidate = l.brief.length >= 24 ? l.brief : l.built.statement;
        const judged = isFactCheckWorthy(candidate, l.built.detail);
        if (!judged.worthy || judged.type === "info") return null;
        return toItem(
          candidate.length > 160 ? `${candidate.slice(0, 157)}…` : candidate,
          judged.type,
          true,
          meta.videoId,
          0,
          l.timestamp,
          l.built.detail,
          l.built.checkGuide || aiPromptFor(candidate, l.built.detail)
        );
      })
      .filter((x): x is SummaryItem => Boolean(x))
      .slice(0, 8)
      .map((it, idx) =>
        toItem(
          it.statement,
          it.type,
          true,
          meta.videoId,
          idx,
          it.chapterTimestamp,
          it.detail,
          it.evidence.find((e) => e.sourceHint === "factcheck-guide")?.text
        )
      );

    return {
      overview,
      summaryBullets,
      items,
      reportType,
      summarySource: "fallback",
    };
  }

  // 챕터 없음: 앞·중·뒤를 고르게 뽑아 요약 흉내 (자막 복붙 방지)
  const spread = extractSpreadPoints(body, meta);
  const bullets =
    spread.bullets.length > 0
      ? spread.bullets
      : ["주요 내용을 추출하지 못했습니다. 스크립트를 붙여넣어 다시 시도하세요."];

  return {
    overview: [
      scriptMode
        ? `「${meta.title}」 스크립트 발췌 메모입니다. (상세 AI 요약을 다시 시도해 주세요)`
        : `「${meta.title}」 설명 기준 주요 내용 요약입니다. (챕터·스크립트 부족)`,
      ...bullets,
    ].join("\n"),
    summaryBullets: bullets,
    items: spread.items,
    reportType,
    summarySource: "fallback",
  };
}

function chapterOrderClaims(
  meta: SummaryMeta,
  body: string
): SummaryItem[] {
  if (meta.chapters.length >= 2) {
    const items: SummaryItem[] = [];
    for (const c of meta.chapters) {
      if (/인트로|outro|엔딩|구독/i.test(c.title)) continue;
      const built = specificFromChapter(c.title);
      const fromScript = snippetForChapter(c.title, body);
      const candidate = fromScript || built.statement;
      const judged = isFactCheckWorthy(candidate, built.detail);
      if (!judged.worthy || judged.type === "info") continue;
      items.push(
        toItem(
          candidate.length > 160 ? `${candidate.slice(0, 157)}…` : candidate,
          judged.type,
          true,
          meta.videoId,
          items.length,
          c.timestamp,
          built.detail,
          built.checkGuide || aiPromptFor(candidate, built.detail)
        )
      );
      if (items.length >= 8) break;
    }
    if (items.length) return items;
  }
  return extractClaimsFromText(body, meta, "C").filter((i) => i.needsFactCheck);
}

/** 챕터 제목 키워드로 스크립트에서 관련 문장 1개 추출 */
function snippetForChapter(title: string, body: string): string | null {
  if (!body || body.length < 40) return null;
  const keys = title
    .replace(/[?？!！]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2)
    .filter(
      (w) =>
        !/까지|일까|정말|이유|비밀|등장한|또|다른|군대들|속에서|어디까지|한복판에|뜬금없이|퍼트렸을까|생각한/.test(
          w
        )
    );
  // 짧은 일반어(몽골 등)만으로는 오매칭이 많아서 핵심 키워드 우선
  const strong = keys.filter(
    (w) =>
      w.length >= 3 &&
      !/^(몽골|유럽|역사|국가|인구)$/.test(w)
  );
  const useKeys = strong.length ? strong : keys;
  if (!useKeys.length) return null;

  const sentences = pickDenseSentences(body, 50);
  const need = Math.min(2, useKeys.length);
  const hit = sentences.find((s) => {
    const matches = useKeys.filter((k) => s.includes(k));
    return matches.length >= need;
  });
  if (!hit) return null;
  return hit.length > 160 ? `${hit.slice(0, 157)}…` : hit;
}

/** AI(제미나이 등)에 붙여넣을 팩트체크 질문 한 문장 */
function aiPromptFor(statement: string, detail?: string): string {
  return buildFactCheckPrompt(statement, detail);
}

/** 타임스탬프·말투 마커 제거 + 같은 구절 연속 반복 제거 */
function stripSpokenCruff(s: string): string {
  let t = s
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, " ")
    .replace(/\b\d{1,2}\.\d{1,2}\b/g, " ")
    .replace(/그런데|그다음에|그래서|자,|네,|어,/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // "A A" / "짧은구절 짧은구절" 연속 반복 제거
  t = t.replace(/(.{5,40}?)\1+/g, "$1");
  t = t.replace(/(.{5,40}?)\1+/g, "$1");
  return t.replace(/\s+/g, " ").trim();
}

/** 긴 스크립트를 앞·중·뒤에서 고르게 발췌 */
function extractSpreadPoints(
  text: string,
  meta: SummaryMeta
): { bullets: string[]; items: SummaryItem[] } {
  const cleaned = cleanTranscript(text);
  if (cleaned.length < 80) {
    return { bullets: [], items: detailedChapterClaims(meta) };
  }

  const parts = Math.min(6, Math.max(3, Math.ceil(cleaned.length / 2800)));
  const sliceLen = Math.floor(cleaned.length / parts);
  const picked: string[] = [];

  for (let i = 0; i < parts; i++) {
    const start = i * sliceLen;
    const end = i === parts - 1 ? cleaned.length : start + sliceLen;
    const segment = cleaned.slice(start, end);
    const dens = pickDenseSentences(segment, 4);
    for (const s of dens) {
      const brief = stripSpokenCruff(s);
      if (brief.length < 24) continue;
      if (picked.some((p) => p.slice(0, 28) === brief.slice(0, 28))) continue;
      picked.push(brief.length > 140 ? `${brief.slice(0, 137)}…` : brief);
      break;
    }
  }

  // 부족하면 전체에서 보충
  if (picked.length < 5) {
    for (const s of pickDenseSentences(cleaned, 24)) {
      const brief = stripSpokenCruff(s);
      if (brief.length < 24) continue;
      if (picked.some((p) => p.slice(0, 28) === brief.slice(0, 28))) continue;
      picked.push(brief.length > 140 ? `${brief.slice(0, 137)}…` : brief);
      if (picked.length >= 10) break;
    }
  }

  const items: SummaryItem[] = [];
  for (const s of picked) {
    if (items.length >= 8) break;
    const statement = toAssertiveClaim(s);
    const judged = isFactCheckWorthy(statement);
    if (!judged.worthy || judged.type === "info") continue;
    const detail = "수치·시기·인명·인과·출처를 교차 확인";
    items.push(
      toItem(
        statement,
        judged.type,
        true,
        meta.videoId,
        items.length,
        undefined,
        detail,
        aiPromptFor(statement, detail)
      )
    );
  }

  const bullets = items.map(
    (it, i) => `${i + 1}. ${it.statement}`
  );

  return {
    bullets,
    items: items.length ? items : detailedChapterClaims(meta),
  };
}

/** 스크립트/본문에서 검증 가능한 문장 추출 */
function extractClaimsFromText(
  text: string,
  meta: SummaryMeta,
  _reportType: ReportType
): SummaryItem[] {
  return extractSpreadPoints(text, meta).items;
}

function pickDenseSentences(text: string, limit: number): string[] {
  const cleaned = cleanTranscript(text).replace(
    /제목:|채널\/제작:|제작자 설명:|챕터\(목차\):/g,
    " "
  );
  const minLen = cleaned.length < 400 ? 18 : 28;
  const parts = cleaned
    .split(/(?<=[.。!?？])\s+|(?<=다)\s+(?=[가-힣A-Z0-9「])/)
    .map((s) => stripSpokenCruff(s))
    .map((s) => s.trim())
    .filter((s) => s.length >= minLen && s.length <= 220)
    .filter((s) => !/^https?:\/\//i.test(s))
    .filter((s) => !isVagueClaim(s))
    .filter((s) => !isChatter(s))
    .filter((s) => !/^(그런데|그다음|그래서|자 |네 )/i.test(s));

  // 키워드 있는 문장 우선, 없으면 일반 문장
  const keyworded = parts.filter((s) =>
    /\d|%|년|세기|인류|진화|화석|연구|기록|주장|공통|기원|침팬|원인|결과|인구|전쟁|정복|사료|DNA|학자|발견/.test(
      s
    )
  );
  const pool = keyworded.length >= Math.min(3, limit) ? keyworded : parts;

  const uniq: string[] = [];
  for (const p of pool) {
    if (!uniq.some((u) => u.slice(0, 40) === p.slice(0, 40))) uniq.push(p);
    if (uniq.length >= limit) break;
  }
  return uniq;
}

function toAssertiveClaim(sentence: string): string {
  let s = sentence.replace(/\s+/g, " ").trim();
  // strip soft wrappers
  s = s.replace(/^(오늘|영상에서는|이제|자,)\s*/g, "");
  if (!/[다요죠]$/.test(s) && !/[.。]$/.test(s)) s = `${s}.`;
  return s.length > 160 ? `${s.slice(0, 157)}…` : s;
}

function detailedChapterClaims(meta: SummaryMeta): SummaryItem[] {
  const chapters = meta.chapters.filter(
    (c) => !/인트로|outro|엔딩|구독/i.test(c.title)
  );
  const items: SummaryItem[] = [];
  for (const c of chapters) {
    const built = specificFromChapter(c.title);
    const judged = isFactCheckWorthy(built.statement, built.detail);
    if (!judged.worthy || judged.type === "info") continue;
    items.push(
      toItem(
        built.statement,
        judged.type,
        true,
        meta.videoId,
        items.length,
        c.timestamp,
        built.detail,
        built.checkGuide
      )
    );
    if (items.length >= 8) break;
  }
  return items;
}

function specificFromChapter(title: string): {
  statement: string;
  detail: string;
  checkGuide: string;
} {
  const t = title.replace(/[?？]/g, "").trim();

  if (/흑사병|페스트|퍼트렸|인구 절반|몰살/.test(t)) {
    return {
      statement:
        "흑사병이 유럽 인구의 약 절반을 몰살시켰고, 그 전파에 몽골(군)이 결정적 역할을 했다는 주장이 있다.",
      detail:
        "영상·목차는 ‘유럽 인구 절반 몰살’과 ‘몽골이 퍼뜨렸다’는 두 명제를 함께 제기한다. 인구 감소율은 지역·시기별로 다르며, 전파 경로는 무역로·크림 반도·중앙아시아 설 등이 경쟁한다. ‘절반’과 ‘몽골 단일 원인’은 각각 별도로 검증해야 한다.",
      checkGuide:
        "다음 주장을 역사학·유전학·역학 연구와 1차 사료로 팩트체크해 주세요: 「흑사병이 유럽 인구의 약 절반을 몰살시켰고 몽골(군)이 결정적으로 전파했다」 — ‘절반’ 수치의 시기·지역별 근거, 몽골/타타르 전파설의 사료와 한계, 현재 학계 합의와 반론을 출처와 함께 사실·과장·미확인으로 구분해 주세요.",
    };
  }
  if (/악마/.test(t) && /유럽|몽골|이유/.test(t)) {
    return {
      statement:
        "중세 유럽인들은 몽골인을 악마(또는 악마적 존재)로 인식·기록했다.",
      detail:
        "영상은 유럽 측 기록이 몽골을 악마·야만으로 묘사한 이유를 다룬다. ‘악마’가 문자 그대로의 신앙적 단정인지, 공포·선전·타자화의 비유인지에 따라 검증 포인트가 달라진다. 구체 연대기·저자·구절 인용이 있는지가 핵심이다.",
      checkGuide:
        "다음 주장을 중세 유럽 연대기·사료로 팩트체크해 주세요: 「유럽인들이 몽골인을 악마(또는 악마적 존재)로 기록했다」 — ‘악마/타르타로스/타타르’ 표현이 실린 저자·연도·원문, 비유인지 존재 단정인지, 영상이 든 이유가 사료와 일치하는지를 출처와 함께 검증해 주세요.",
    };
  }
  if (/악마/.test(t) && /군대|기록|또 다른/.test(t)) {
    return {
      statement:
        "역사 속에서 몽골 외에 ‘악마’로 기록된 군대가 존재하며, 그 사례는 몽골 인식과 비교 가능하다.",
      detail:
        "비교 대상 군대·사건·문헌이 구체적으로 제시됐는지가 검증 핵심이다. 단순 비유 나열이 아니라 동일 범주(선전·타자화·종교적 악마화)인지 확인해야 한다.",
      checkGuide:
        "다음 주장을 사료·연구로 팩트체크해 주세요: 「몽골 외에 ‘악마’로 기록된 군대가 있으며 몽골 인식과 비교 가능하다」 — 비교 사례의 실명·시기·문헌 원문, ‘악마’ 표현의 용법, 몽골 사례와의 공통점·과장 여부를 출처와 함께 검증해 주세요.",
    };
  }
  if (/서진|칭기즈|유럽까지|진짜 이유/.test(t)) {
    return {
      statement:
        "칭기즈칸(몽골제국)이 유럽 방면으로 서진한 ‘진짜 이유’는 영상에서 제시한 특정 동기이다.",
      detail:
        "표준 서술에서는 복수·정복·동맹·전략·경제적 동기 등이 복합적으로 거론된다. 영상이 단일한 ‘진짜 이유’를 주장한다면 그 이유의 정의와 근거 사료를 분리해 확인해야 한다.",
      checkGuide:
        "다음 주장을 몽골사·중앙아시아사 연구로 팩트체크해 주세요: 「칭기즈칸(몽골제국)의 유럽 방면 서진에는 단일한 ‘진짜 이유’가 있다」 — 호레즘·오트라르 사건 등 영상이 제시한 동기의 사료 근거, 다른 유력 동기와의 충돌·과장 여부를 출처와 함께 검증해 주세요.",
    };
  }
  if (/정체성/.test(t)) {
    return {
      statement:
        "‘몽골’의 정체성 범위는 민족·제국·현대 국가 중 특정 기준으로 한정될 수 있다.",
      detail:
        "정체성 논의는 정의에 따라 결론이 달라진다. 영상에서 쓰는 ‘몽골’이 몽골제국·유목 집단·현대 몽골국 중 무엇을 가리키는지 먼저 고정해야 사실 검증이 가능하다.",
      checkGuide:
        "다음 주장을 역사학·민족학 정의로 팩트체크해 주세요: 「‘몽골’ 정체성 범위는 민족·제국·현대 국가 중 특정 기준으로 한정된다」 — 영상 속 ‘몽골’ 정의, 훈·흉노·유연·아바르 등과의 계보 주장 근거와 학계 반론을 출처와 함께 검증해 주세요.",
    };
  }
  if (/비밀|동양인 국가|한복판|뜬금없이/.test(t)) {
    return {
      statement:
        "유럽 한복판에 동양계 국가(또는 세력)가 ‘갑자기’ 등장했다는 기록이 실재한다.",
      detail:
        "‘동양인 국가’가 칼미크·타타르·아바르 등 어느 집단·시기를 가리키는지, ‘뜬금없이’가 유럽 기록의 표현인지 영상 수사인지가 검증 포인트다. 지명·연도·국호를 특정해야 한다.",
      checkGuide:
        "다음 주장을 유럽·유라시아 고고학·역사 기록으로 팩트체크해 주세요: 「유럽 한복판에 동양계 국가(세력)가 갑자기 등장했다」 — 지칭 집단(아바르·칼미크 등)·시기·지명, ‘갑자기 등장’이 사실인지 인식의 문제인지, 관련 DNA·유물 연구 합의를 출처와 함께 검증해 주세요.",
    };
  }

  return {
    statement: `${t}에 대해 영상이 제시하는 핵심 사실 주장은 독립적으로 검증되어야 한다.`,
    detail: `목차 「${title}」에서 제기된 명제·수치·인과를 분리해, 의견이 아닌 사실 주장만 추려 확인한다.`,
    checkGuide: aiPromptFor(
      `${t}에 대해 영상이 제시하는 핵심 사실 주장`,
      `목차 「${title}」의 단정·수치·인과의 출처와 반론`
    ),
  };
}

function toItem(
  statement: string,
  type: "claim" | "opinion" | "info",
  needsFactCheck: boolean,
  videoId: string | undefined,
  index: number,
  chapterTimestamp?: string,
  detail?: string,
  checkGuide?: string
): SummaryItem {
  return {
    id: uuid(),
    type,
    statement,
    detail,
    needsFactCheck,
    chapterTimestamp,
    evidence: checkGuide
      ? [{ text: checkGuide, sourceHint: "factcheck-guide" }]
      : detail
        ? [{ text: detail, sourceHint: "detail" }]
        : [],
    imageUrl: videoId ? thumb(videoId, index) : undefined,
  };
}

function thumb(videoId: string, index: number) {
  const variants = [
    "hqdefault",
    "mqdefault",
    "sddefault",
    "hq1",
    "hq2",
    "hq3",
    "0",
    "1",
    "2",
    "3",
  ];
  return `https://i.ytimg.com/vi/${videoId}/${variants[index % variants.length]}.jpg`;
}

/** 2) 요약 주장 기준 자동 팩트체크 가이드 (상세) */
export async function autoFactCheck(
  items: SummaryItem[],
  meta: SummaryMeta
): Promise<FactCheckResult[]> {
  const targets = items.filter((i) => i.needsFactCheck);
  if (!targets.length) return [];

  const system = `한국어 팩트체크 프롬프트 작성자입니다.
각 항목의 statement/detail을 보고, 제미나이·ChatGPT 등 AI에게 바로 붙여넣어 팩트체크할 수 있는 **질문 한 문장**을 만드세요.
필수: 주장 인용 + 검증 포인트(수치·시기·인명·지명·사료) + 출처 요청 + 사실/과장/미확인 구분 요청.
금지: ①②③ 목록, "전반적으로 확인" 같은 포괄 문구, 여러 문장.

JSON: { "results": [{ "itemId": string, "explanation": string }] }
explanation = AI에게 물어볼 한 문장.`;

  try {
    const llm = await chatJson<{
      results: Array<{ itemId: string; explanation: string }>;
    }>(
      system,
      JSON.stringify({
        title: meta.title,
        items: targets.map((t) => ({
          itemId: t.id,
          statement: t.statement,
          detail: t.detail,
          evidence: t.evidence,
        })),
      })
    );
    if (llm?.results?.length) {
      const now = new Date().toISOString();
      const byId = new Map(llm.results.map((r) => [r.itemId, r.explanation]));
      return targets.map((item) => {
        const prompt =
          byId.get(item.id) ||
          item.evidence.find((e) => e.sourceHint === "factcheck-guide")?.text ||
          aiPromptFor(item.statement, item.detail);
        // 질문은 evidence에 두고, explanation(답변)은 비워 사용자가 입력
        if (
          !item.evidence.some((e) => e.sourceHint === "factcheck-guide")
        ) {
          item.evidence = [
            ...item.evidence,
            { text: prompt, sourceHint: "factcheck-guide" },
          ];
        }
        return {
          itemId: item.id,
          mode: "auto" as const,
          verdict: "pending" as const,
          explanation: "",
          sources: [],
          checkedAt: now,
        };
      });
    }
  } catch {
    /* heuristic */
  }

  return heuristicGuides(targets);
}

function heuristicGuides(items: SummaryItem[]): FactCheckResult[] {
  const now = new Date().toISOString();
  return items.map((item) => {
    const prompt =
      item.evidence.find((e) => e.sourceHint === "factcheck-guide")?.text ||
      aiPromptFor(item.statement, item.detail);
    if (!item.evidence.some((e) => e.sourceHint === "factcheck-guide")) {
      item.evidence = [
        ...item.evidence,
        { text: prompt, sourceHint: "factcheck-guide" },
      ];
    }
    return {
      itemId: item.id,
      mode: "auto" as const,
      verdict: "pending" as const,
      explanation: "",
      sources: [],
      checkedAt: now,
    };
  });
}

export function verdictLabel(v: FactCheckResult["verdict"]) {
  const map: Record<FactCheckResult["verdict"], string> = {
    true: "사실",
    mostly_true: "대체로 사실",
    mixed: "일부 사실",
    mostly_false: "대체로 거짓",
    false: "거짓",
    unverifiable: "검증 불가",
    pending: "대기",
  };
  return map[v];
}

export function buildReport(
  video: Pick<
    VideoRecord,
    "title" | "channel" | "overview" | "items" | "factChecks"
  >
) {
  const fcMap = new Map(video.factChecks.map((f) => [f.itemId, f]));
  return {
    introduction: video.overview,
    body: video.items.map((i) => ({
      itemId: i.id,
      statement: i.statement,
      type: i.type,
      verdict: fcMap.get(i.id)?.verdict ?? ("pending" as const),
      factCheckSummary: fcMap.get(i.id)?.explanation ?? i.detail ?? "",
    })),
    conclusion: "유형별 보고서로 재작성하세요.",
  };
}
