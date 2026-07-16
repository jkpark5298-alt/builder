import type {
  FactCheckResult,
  FactCheckVerdict,
  SummaryItem,
  TypedReport,
  VideoRecord,
} from "./types";
import { REPORT_TYPE_LABELS } from "./types";
import { normalizeImageUrls } from "./image-urls";
import {
  buildFactCheckPrompt,
  dedupeTexts,
  normalizeAiAnswer,
  verdictBadge,
} from "./text-format";

export { detectReportType } from "./report-detect";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 핵심 문장 노란색 형광 강조 */
export function highlightConclusion(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const m = clean.match(/^(.+?[.。!?？])\s*(.*)$/);
  if (m && m[1].length >= 12) {
    return `<p><mark class="hl-yellow">${escapeHtml(m[1])}</mark>${
      m[2] ? ` ${escapeHtml(m[2])}` : ""
    }</p>`;
  }
  return `<p><mark class="hl-yellow">${escapeHtml(clean)}</mark></p>`;
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}

export function reportBodyPlain(body: string, rich?: boolean): string {
  return rich ? stripHtml(body) : body;
}

function isYoutubeThumb(url?: string | null): boolean {
  if (!url) return false;
  return /i\.ytimg\.com|ytimg\.com\/vi\//i.test(url);
}

export type NarrativeSec = {
  title: string;
  details: string[];
  isConclusion?: boolean;
};

/** 요약 본문 → 논리 섹션 (번호·불릿·결론) */
export function parseOverviewNarrative(overview: string): {
  intro: string;
  sections: NarrativeSec[];
  conclusion: string;
} {
  const lines = overview
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const sections: NarrativeSec[] = [];
  let current: NarrativeSec | null = null;
  let intro = "";
  let conclusion = "";
  let inConclusion = false;

  for (const line of lines) {
    if (/^최종\s*결론/.test(line) || /^결론\s*[:：]?/.test(line)) {
      inConclusion = true;
      current = null;
      const rest = line.replace(/^최종\s*결론\s*[:：]?\s*/, "").replace(/^결론\s*[:：]?\s*/, "").trim();
      if (rest) conclusion = conclusion ? `${conclusion} ${rest}` : rest;
      continue;
    }
    if (inConclusion) {
      conclusion = conclusion ? `${conclusion} ${line}` : line;
      continue;
    }

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
    if (!current) {
      if (line.length >= 20) {
        intro = intro ? `${intro} ${line}` : line;
      }
      continue;
    }
    if (line.length >= 12) current.details.push(line);
  }

  // 번호 구조가 없으면 문단/문장 묶음으로 나눔
  if (!sections.length) {
    const chunks = overview
      .split(/\n{2,}/)
      .map((c) => c.replace(/\s+/g, " ").trim())
      .filter((c) => c.length >= 40);
    if (chunks.length >= 2) {
      for (const c of chunks.slice(0, 10)) {
        const title = c.slice(0, 48) + (c.length > 48 ? "…" : "");
        sections.push({ title, details: [c] });
      }
    } else {
      const sentences = overview
        .split(/(?<=[.。!?？])\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 30);
      const group = 2;
      for (let i = 0; i < Math.min(sentences.length, 12); i += group) {
        const part = sentences.slice(i, i + group);
        if (!part.length) continue;
        sections.push({
          title: part[0].slice(0, 48) + (part[0].length > 48 ? "…" : ""),
          details: part,
        });
      }
    }
  }

  if (!conclusion) {
    const last = sections[sections.length - 1];
    if (last && /결론|정리|요약하면|결국/.test(last.title + last.details.join(" "))) {
      conclusion = [last.title, ...last.details].join(" ");
      sections.pop();
    }
  }

  return {
    intro: intro.replace(/\s+/g, " ").trim(),
    sections: sections
      .map((s) => ({
        title: s.title.replace(/\s+/g, " ").trim(),
        details: s.details.map((d) => d.replace(/\s+/g, " ").trim()).filter(Boolean),
      }))
      .filter((s) => s.title.length >= 4)
      .slice(0, 14),
    conclusion: conclusion.replace(/\s+/g, " ").trim(),
  };
}

/** 매칭용 토큰 (한글·영·숫자 2자 이상) */
function tokens(text: string): Set<string> {
  const out = new Set<string>();
  const cleaned = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const w of cleaned.split(" ")) {
    if (w.length >= 2) out.add(w);
  }
  // 한글 바이그램
  const hangul = cleaned.replace(/[^가-힣]/g, "");
  for (let i = 0; i < hangul.length - 1; i++) {
    out.add(hangul.slice(i, i + 2));
  }
  return out;
}

function overlapScore(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let hit = 0;
  for (const t of ta) {
    if (tb.has(t)) hit += t.length >= 3 ? 2 : 1;
  }
  return hit / Math.sqrt(ta.size * tb.size);
}

type FcBundle = {
  item: SummaryItem;
  fc?: FactCheckResult;
  images: string[];
  textBlob: string;
};

function collectFcBundles(
  items: SummaryItem[],
  factChecks: FactCheckResult[]
): FcBundle[] {
  const fcMap = new Map(factChecks.map((f) => [f.itemId, f]));
  return items
    .filter((i) => i.needsFactCheck)
    .map((item) => {
      const fc = fcMap.get(item.id);
      const images = [
        ...normalizeImageUrls(item.imageUrl, item.imageUrls),
        ...normalizeImageUrls(fc?.answerImageUrl, fc?.answerImageUrls),
      ].filter((u) => !isYoutubeThumb(u));
      const textBlob = [
        item.statement,
        item.detail ?? "",
        fc?.explanation && !/^다음 주장을/.test(fc.explanation)
          ? fc.explanation
          : "",
      ].join(" ");
      return { item, fc, images: Array.from(new Set(images)), textBlob };
    });
}

/** FC를 요약 섹션에 규칙 매칭 (1:1 우선, 점수 낮은 것은 잔여) */
function matchBundlesToSections(
  sections: NarrativeSec[],
  bundles: FcBundle[]
): { bySection: FcBundle[][]; leftover: FcBundle[] } {
  const bySection: FcBundle[][] = sections.map(() => []);
  const used = new Set<string>();
  const leftover: FcBundle[] = [];

  // 각 섹션에 최고 점수 FC 배정 (라운드 로빈 느낌으로 섹션 우선)
  const candidates: Array<{
    si: number;
    bi: number;
    score: number;
  }> = [];

  for (let si = 0; si < sections.length; si++) {
    const secText = [sections[si].title, ...sections[si].details].join(" ");
    for (let bi = 0; bi < bundles.length; bi++) {
      const score = overlapScore(secText, bundles[bi].textBlob);
      if (score > 0.08) candidates.push({ si, bi, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  for (const c of candidates) {
    const id = bundles[c.bi].item.id;
    if (used.has(id)) continue;
    // 섹션당 최대 3개 FC
    if (bySection[c.si].length >= 3) continue;
    bySection[c.si].push(bundles[c.bi]);
    used.add(id);
  }

  for (const b of bundles) {
    if (!used.has(b.item.id)) leftover.push(b);
  }

  // 잔여: 가장 덜 찬 섹션에 약매칭으로라도 배치 (이미지 고아 방지)
  const still: FcBundle[] = [];
  for (const b of leftover) {
    let bestSi = -1;
    let bestScore = -1;
    for (let si = 0; si < sections.length; si++) {
      if (bySection[si].length >= 3) continue;
      const secText = [sections[si].title, ...sections[si].details].join(" ");
      const score = overlapScore(secText, b.textBlob);
      if (score > bestScore) {
        bestScore = score;
        bestSi = si;
      }
    }
    if (bestSi >= 0 && (bestScore > 0.03 || sections.length === 1)) {
      bySection[bestSi].push(b);
    } else if (bestSi >= 0 && bySection.every((x) => x.length === 0)) {
      bySection[bestSi].push(b);
    } else {
      still.push(b);
    }
  }

  return { bySection, leftover: still };
}

function sectionBodyHtml(
  title: string,
  details: string[],
  matched: FcBundle[]
): string {
  const paras: string[] = [];
  const lead = details.length
    ? details.join(" ")
    : title;
  paras.push(`<p>${escapeHtml(lead)}</p>`);

  for (const m of matched) {
    const v = (m.fc?.verdict ?? "pending") as FactCheckVerdict;
    const badge = verdictBadge(v);
    const guide =
      m.fc?.explanation && !/^다음 주장을/.test(m.fc.explanation)
        ? normalizeAiAnswer(m.fc.explanation).slice(0, 420)
        : "";
    paras.push(
      `<p><strong>관련 검증 · ${escapeHtml(badge.label)}</strong> — ${escapeHtml(
        m.item.statement
      )}${guide ? `<br/><span class="fc-note">${escapeHtml(guide)}</span>` : ""}</p>`
    );
  }
  return paras.join("");
}

/**
 * 요약 논리 흐름 기준 보고서.
 * 각 소주제 = 요약 텍스트 + 매칭된 이미지 + 관련 팩트체크
 */
export function buildTypedReport(
  video: Pick<
    VideoRecord,
    | "title"
    | "channel"
    | "youtubeUrl"
    | "overview"
    | "summaryBullets"
    | "items"
    | "factChecks"
    | "reportType"
    | "updatedAt"
    | "createdAt"
    | "thumbnailUrl"
    | "videoId"
  >
): TypedReport {
  const writtenAt = new Date(video.updatedAt || video.createdAt).toLocaleString(
    "ko-KR"
  );
  const fcMap = new Map(video.factChecks.map((f) => [f.itemId, f]));
  const parsed = parseOverviewNarrative(video.overview || "");
  const bundles = collectFcBundles(video.items, video.factChecks);
  const { bySection, leftover } = matchBundlesToSections(
    parsed.sections,
    bundles
  );

  const conclusionText =
    parsed.conclusion ||
    video.summaryBullets?.[0] ||
    parsed.sections[0]?.details[0] ||
    parsed.intro ||
    video.overview.split(/[.。!?？\n]/).find((s) => s.trim().length > 20)?.trim() ||
    video.overview.slice(0, 160);

  const sections: TypedReport["sections"] = [];

  // 1) 결론 — 요약의 결론만 (이미지 몰아넣기 없음)
  sections.push({
    heading: "결론",
    body: highlightConclusion(conclusionText),
    rich: true,
    imageUrl: undefined,
    images: undefined,
  });

  // 2) 도입 (있을 때만)
  if (parsed.intro && parsed.intro.length >= 40) {
    sections.push({
      heading: "도입",
      body: `<p>${escapeHtml(parsed.intro)}</p>`,
      rich: true,
    });
  }

  // 3) 요약 소주제별 TEXT + 매칭 이미지 + FC
  parsed.sections.forEach((sec, si) => {
    const matched = bySection[si] ?? [];
    const images = matched.flatMap((m) => m.images);
    sections.push({
      heading: sec.title.slice(0, 80),
      body: sectionBodyHtml(sec.title, sec.details, matched),
      rich: true,
      images: images.length ? Array.from(new Set(images)) : undefined,
      entries: matched.map((m) => ({
        itemId: m.item.id,
        text: m.item.statement,
        // 이미지는 섹션(images)에만 — 카드마다 중복 표시 방지
        imageUrl: undefined,
        answerImageUrl: undefined,
        answerImageUrls: undefined,
      })),
    });
  });

  // 4) 매칭 안 된 FC·이미지
  if (leftover.length) {
    const images = leftover.flatMap((m) => m.images);
    sections.push({
      heading: "추가 검증",
      body: `<p>${escapeHtml(
        "아래는 요약 소주제와 직접 묶이지 않은 검증 항목입니다."
      )}</p>${sectionBodyHtml("추가 검증", [], leftover)}`,
      rich: true,
      images: images.length ? Array.from(new Set(images)) : undefined,
      entries: leftover.map((m) => ({
        itemId: m.item.id,
        text: m.item.statement,
        answerImageUrl: undefined,
        answerImageUrls: undefined,
      })),
    });
  }

  // 소주제가 전혀 없으면 구형 폴백: 요약 본문 + FC 목록(이미지 분산)
  if (!parsed.sections.length) {
    sections.length = 0;
    sections.push({
      heading: "결론",
      body: highlightConclusion(conclusionText),
      rich: true,
    });
    sections.push({
      heading: "요약",
      body: `<p>${escapeHtml(video.overview || "")}</p>`,
      rich: true,
    });
    // FC를 순서대로 소섹션처럼 펼치되 이미지는 항목에만
    for (const b of bundles) {
      sections.push({
        heading: b.item.statement.slice(0, 60),
        body: sectionBodyHtml(b.item.statement, [], [b]),
        rich: true,
        images: b.images.length ? b.images : undefined,
        entries: [
          {
            itemId: b.item.id,
            text: b.item.statement,
          },
        ],
      });
    }
  }

  const fcItems = video.items.filter((i) => i.needsFactCheck);
  const inlineFactChecks = fcItems.map((i) => {
    const fc = fcMap.get(i.id);
    const raw = fc?.explanation?.trim() ?? "";
    const isPrompt =
      !raw || (/^다음 주장을/.test(raw) && /팩트체크/.test(raw));
    return {
      itemId: i.id,
      statement: i.statement,
      verdict: fc?.verdict ?? ("pending" as const),
      checkGuide: isPrompt ? "" : normalizeAiAnswer(raw),
      answerImageUrl: normalizeImageUrls(fc?.answerImageUrl, fc?.answerImageUrls)[0],
      answerImageUrls: normalizeImageUrls(fc?.answerImageUrl, fc?.answerImageUrls),
    };
  });

  const summaryExcerpt = dedupeTexts([
    `결론: ${conclusionText}`,
    ...parsed.sections.slice(0, 6).map((s, i) => `${i + 1}. ${s.title}`),
  ]).join("\n");

  return {
    meta: {
      title: video.title,
      channel: video.channel,
      url: video.youtubeUrl,
      writtenAt,
    },
    reportType: video.reportType,
    reportTypeLabel: "일반 보고서",
    format: "general_v4" as const,
    sections,
    summaryExcerpt,
    factChecks: inlineFactChecks.map((f) => ({
      itemId: f.itemId,
      statement: f.statement,
      checkGuide: f.checkGuide,
      verdict: f.verdict,
      answerImageUrl: f.answerImageUrl,
      answerImageUrls: f.answerImageUrls,
    })),
  };
}

/** API·파이프라인 공용 */
export function factCheckGuideForItem(item: SummaryItem): string {
  const fromEvidence = item.evidence.find(
    (e) => e.sourceHint === "factcheck-guide"
  )?.text;
  if (fromEvidence && !fromEvidence.includes("본문 근거")) {
    return fromEvidence;
  }
  return buildFactCheckPrompt(item.statement, item.detail);
}
