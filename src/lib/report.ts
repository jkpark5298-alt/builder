import type {
  SummaryItem,
  TypedReport,
  VideoRecord,
} from "./types";
import { REPORT_TYPE_LABELS } from "./types";
import {
  buildFactCheckPrompt,
  dedupeTexts,
  normalizeAiAnswer,
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
  // 첫 문장(또는 전체)을 결론으로 강조
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
  const bullets = dedupeTexts(
    video.summaryBullets?.length
      ? video.summaryBullets
      : video.items.slice(0, 6).map((i) => i.statement)
  );

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
      answerImageUrl: fc?.answerImageUrl,
    };
  });

  // 연역법: 결론 먼저
  const conclusionText =
    bullets[0] ||
    video.overview.split(/[.。!?？\n]/).find((s) => s.trim().length > 20)?.trim() ||
    video.overview.slice(0, 120);

  const summaryLines = dedupeTexts([
    video.overview,
    ...bullets.slice(0, 5).map((b, i) => `${i + 1}. ${b}`),
  ]);

  // overview와 bullet 중복 제거된 요약
  const overviewNorm = video.overview.replace(/\s+/g, " ").trim();
  const summaryUnique = summaryLines.filter((line) => {
    const n = line.replace(/^\d+\.\s*/, "").replace(/\s+/g, " ").trim();
    if (!n) return false;
    if (n === overviewNorm) return false;
    if (overviewNorm.includes(n) && n.length > 40) return false;
    return true;
  });

  // 팩트체크에 직접 첨부한 이미지만 (유튜브 대표/프레임 제외)
  const attachedImages = Array.from(
    new Set(
      fcItems
        .flatMap((item) => {
          const fc = fcMap.get(item.id);
          return [fc?.answerImageUrl].filter(Boolean) as string[];
        })
        .filter((u) => !isYoutubeThumb(u))
    )
  ).slice(0, 4);

  const sections = [
    {
      heading: "결론",
      body: highlightConclusion(conclusionText),
      rich: true,
      // 대표 이미지 1회만
      imageUrl: video.thumbnailUrl,
      images: attachedImages,
    },
    {
      heading: "요약",
      body: summaryUnique.length
        ? summaryUnique.map((l) => escapeHtml(l)).join("<br/>")
        : escapeHtml(video.overview),
      rich: true,
    },
    {
      heading: "팩트체크",
      body: "",
      rich: true,
      entries: fcItems.map((item) => {
        const fc = fcMap.get(item.id);
        const attached =
          fc?.answerImageUrl && !isYoutubeThumb(fc.answerImageUrl)
            ? fc.answerImageUrl
            : undefined;
        return {
          itemId: item.id,
          text: item.statement,
          // 유튜브 썸네일은 항목에 반복 넣지 않음
          imageUrl: undefined,
          answerImageUrl: attached,
        };
      }),
    },
  ];

  return {
    meta: {
      title: video.title,
      channel: video.channel,
      url: video.youtubeUrl,
      writtenAt,
    },
    reportType: video.reportType,
    reportTypeLabel: "일반 보고서",
    format: "general_v3" as const,
    sections,
    summaryExcerpt: dedupeTexts([
      `결론: ${conclusionText}`,
      ...bullets.slice(0, 4).map((b) => `· ${b}`),
    ]).join("\n"),
    factChecks: inlineFactChecks.map((f) => ({
      itemId: f.itemId,
      statement: f.statement,
      checkGuide: f.checkGuide,
      verdict: f.verdict,
      answerImageUrl: f.answerImageUrl,
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
