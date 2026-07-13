import { v4 as uuid } from "uuid";
import type { FactCheckResult, SummaryItem, VideoRecord } from "./types";
import type { YoutubeMeta } from "./youtube";
import { detectReportType } from "./report";
import type { ReportType } from "./types";

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

async function chatJson<T>(system: string, user: string): Promise<T | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
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
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`LLM error: ${res.status} ${err}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) return null;
  return JSON.parse(content) as T;
}

export interface SummarizeResult {
  overview: string;
  summaryBullets: string[];
  items: SummaryItem[];
  reportType: ReportType;
}

function cleanTranscript(text: string): string {
  return text
    .replace(/^번역:\s*[^\n]+(?:\s*검토:\s*[^\n]+)?\s*/i, "")
    .replace(/>>+/g, " ")
    .replace(/\[[^\]]{0,40}\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
  const chapterList = meta.chapters.length
    ? meta.chapters.map((c) => `${c.timestamp} ${c.title}`).join("\n")
    : "(챕터 없음)";

  const sourceBlock = scriptMode
    ? [
        `【요약 대상: 스크립트 + 유튜브 방송 순서(챕터)】`,
        `제목: ${meta.title}`,
        `채널: ${meta.channel}`,
        `방송 순서(챕터):\n${chapterList}`,
        `스크립트:\n${cleanedTranscript.slice(0, 16000)}`,
      ].join("\n\n")
    : [
        `【스크립트 약함 — 챕터·설명으로 요약】`,
        `제목: ${meta.title}`,
        `채널: ${meta.channel}`,
        `방송 순서(챕터):\n${chapterList}`,
        meta.description ? `설명:\n${meta.description.slice(0, 5000)}` : "",
        cleanedTranscript
          ? `보조 텍스트:\n${cleanedTranscript.slice(0, 8000)}`
          : "",
      ]
        .filter(Boolean)
        .join("\n\n");

  const system = `당신은 한국어 유튜브 분석가입니다.

필수 규칙:
1) 보고서 유형(H/S/C/P) 구조로 요약하지 마세요.
2) 유튜브가 제공하는 방송 순서(챕터 타임스탬프) 그대로 요약하세요.
3) 각 챕터마다 그 구간의 핵심 내용만 1~2문장으로 쓰세요. 스크립트가 있으면 스크립트 근거로.
4) factPoints는 인트로/엔딩을 제외한 챕터별 검증 가능 주장만.
   - statement: 단정형 주장 한 줄
   - detail: 왜 확인해야 하는지 2~3문장
   - checkGuide: 제미나이 등 AI에게 붙여넣을 수 있는 **팩트체크 질문 한 문장**(상세·구체적)
5) summaryBullets 형식: "00:00 챕터제목 — 핵심 한두 문장"

JSON만 반환:
{
  "overview": "방송 순서 요약을 문단으로 (각 챕터를 타임스탬프와 함께)",
  "summaryBullets": ["00:00 인트로 — …", "03:47 … — …"],
  "factPoints": [{
    "statement": "검증 가능한 단정형 주장",
    "detail": "왜 확인해야 하는지",
    "checkGuide": "AI에게 물어볼 팩트체크 질문 한 문장",
    "type": "claim",
    "needsFactCheck": true,
    "chapterTimestamp": "03:47"
  }],
  "reportTypeHint": "${reportType}"
}`;

  try {
    const llm = await chatJson<{
      overview: string;
      summaryBullets: string[];
      factPoints: Array<{
        statement: string;
        detail?: string;
        checkGuide?: string;
        type?: "claim" | "info";
        needsFactCheck?: boolean;
        chapterTimestamp?: string;
      }>;
      reportTypeHint?: ReportType;
    }>(system, sourceBlock);

    if (llm?.overview && llm.summaryBullets?.length) {
      const rt =
        llm.reportTypeHint && ["H", "S", "C", "P"].includes(llm.reportTypeHint)
          ? llm.reportTypeHint
          : reportType;

      const rawPoints = (llm.factPoints ?? []).filter(
        (p) => p.statement && !isVagueClaim(p.statement)
      );
      const items = rawPoints.map((p, idx) =>
        toItem(
          p.statement,
          "claim",
          true,
          meta.videoId,
          idx,
          p.chapterTimestamp,
          p.detail,
          p.checkGuide || aiPromptFor(p.statement, p.detail)
        )
      );

      return {
        overview: llm.overview,
        summaryBullets: llm.summaryBullets.filter((b) => !isVagueClaim(b)),
        items: items.length
          ? items
          : chapterOrderClaims(meta, cleanedTranscript),
        reportType: rt,
      };
    }
  } catch {
    /* fallback */
  }

  return chapterOrderFallback(meta, cleanedTranscript, reportType, scriptMode);
}

function isVagueClaim(text: string): boolean {
  return /논의|소개|다룹|살펴|설명합|알아보|정리합|이야기합|언급합|리뷰/.test(
    text
  );
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

    const items = contentChapters.map((l, idx) =>
      toItem(
        l.built.statement,
        "claim",
        true,
        meta.videoId,
        idx,
        l.timestamp,
        l.built.detail,
        l.built.checkGuide
      )
    );

    return { overview, summaryBullets, items, reportType };
  }

  // 챕터 없음: 스크립트/설명에서 주요 문장
  const claims = extractClaimsFromText(body, meta, reportType);
  const bullets =
    claims.length > 0
      ? claims.map((c, i) => `${i + 1}. ${c.statement}`)
      : ["주요 내용을 추출하지 못했습니다. 스크립트를 붙여넣어 다시 시도하세요."];

  return {
    overview: [
      scriptMode
        ? `「${meta.title}」 스크립트 기준 주요 내용 요약입니다. (챕터 정보 없음)`
        : `「${meta.title}」 설명 기준 주요 내용 요약입니다. (챕터·스크립트 부족)`,
      ...bullets,
    ].join("\n"),
    summaryBullets: bullets,
    items: claims,
    reportType,
  };
}

function chapterOrderClaims(
  meta: SummaryMeta,
  body: string
): SummaryItem[] {
  if (meta.chapters.length >= 2) {
    return meta.chapters
      .filter((c) => !/인트로|outro|엔딩|구독/i.test(c.title))
      .map((c, idx) => {
        const built = specificFromChapter(c.title);
        return toItem(
          built.statement,
          "claim",
          true,
          meta.videoId,
          idx,
          c.timestamp,
          built.detail,
          built.checkGuide
        );
      });
  }
  return extractClaimsFromText(body, meta, "C");
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
  const focus = detail
    ? detail.replace(/\s+/g, " ").slice(0, 100)
    : "수치·시기·지명·인명의 1차 근거와 반론";
  return `다음 주장을 학술 연구·1차 사료·신뢰할 수 있는 기록으로 팩트체크해 주세요: 「${statement.replace(/\s+/g, " ").trim()}」 — ${focus}를 포함해 사실·과장·미확인을 구분하고 출처를 함께 제시해 주세요.`;
}

/** 스크립트/본문에서 검증 가능한 문장 추출 */
function extractClaimsFromText(
  text: string,
  meta: SummaryMeta,
  _reportType: ReportType
): SummaryItem[] {
  const sentences = pickDenseSentences(text, 20);
  const claimLike = sentences.filter((s) =>
    /\d|%|년|세기|주장|때문|원인|결과|퍼트|몰살|악마|서진|증가|감소|기록|사료|연구|인구|전쟁|정복|전파|성장|GDP|부채|수출|목표/.test(
      s
    )
  );

  const selected = (claimLike.length ? claimLike : sentences).slice(0, 8);
  if (!selected.length) return detailedChapterClaims(meta);

  return selected.map((s, idx) => {
    const statement = toAssertiveClaim(s);
    const detail = `본문 근거: 「${s}」. 이 진술의 수치·인과·인용 출처를 교차 확인해야 합니다.`;
    const checkGuide = aiPromptFor(statement, detail);
    return toItem(
      statement,
      "claim",
      true,
      meta.videoId,
      idx,
      undefined,
      detail,
      checkGuide
    );
  });
}

function pickDenseSentences(text: string, limit: number): string[] {
  const cleaned = cleanTranscript(text)
    .replace(/제목:|채널\/제작:|제작자 설명:|챕터\(목차\):/g, " ");
  const minLen = cleaned.length < 400 ? 18 : 32;
  const parts = cleaned
    .split(/(?<=[.。!?？])\s+|(?<=다)\s+(?=[가-힣A-Z0-9「])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= minLen && s.length <= 220)
    .filter((s) => !/^https?:\/\//i.test(s))
    .filter((s) => !isVagueClaim(s))
    .filter((s) => !isChatter(s))
    .filter(
      (s) =>
        /\d|%|년|세기|흑사병|페스트|몽골|칭기즈|훈족|유연|아바르|호레즘|인구|전쟁|정복|악마|전파|사료|연구|DNA|기록/.test(
          s
        )
    );

  const uniq: string[] = [];
  for (const p of parts) {
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
  return chapters.map((c, idx) => {
    const built = specificFromChapter(c.title);
    return toItem(
      built.statement,
      "claim",
      true,
      meta.videoId,
      idx,
      c.timestamp,
      built.detail,
      built.checkGuide
    );
  });
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
  type: "claim" | "info",
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
