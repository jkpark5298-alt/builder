import type {
  FactCheckResult,
  ReportType,
  SummaryItem,
  TypedReport,
  VideoRecord,
} from "./types";
import { REPORT_TYPE_LABELS, REPORT_TYPE_STRUCTURE } from "./types";
import {
  buildFactCheckPrompt,
  dedupeTexts,
  normalizeAiAnswer,
} from "./text-format";

export { detectReportType } from "./report-detect";

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
      !raw ||
      (/^다음 주장을/.test(raw) && /팩트체크/.test(raw));
    return {
      itemId: i.id,
      statement: i.statement,
      verdict: fc?.verdict ?? ("pending" as const),
      checkGuide: isPrompt ? "" : normalizeAiAnswer(raw),
      answerImageUrl: fc?.answerImageUrl ?? i.imageUrl,
    };
  });

  const sections = fillTypeSections(
    video.reportType,
    video.overview,
    bullets,
    fcItems,
    fcMap,
    video.thumbnailUrl
  );

  return {
    meta: {
      title: video.title,
      channel: video.channel,
      url: video.youtubeUrl,
      writtenAt,
    },
    reportType: video.reportType,
    reportTypeLabel: REPORT_TYPE_LABELS[video.reportType],
    sections,
    summaryExcerpt: dedupeTexts([video.overview, ...bullets.map((b) => `· ${b}`)]).join(
      "\n"
    ),
    factChecks: inlineFactChecks.map((f) => ({
      itemId: f.itemId,
      statement: f.statement,
      checkGuide: f.checkGuide,
      verdict: f.verdict,
      answerImageUrl: f.answerImageUrl,
    })),
  };
}

function entryForItem(
  item: SummaryItem,
  fc: FactCheckResult | undefined
): { itemId: string; text: string; imageUrl?: string } {
  const raw = fc?.explanation?.trim() ?? "";
  const isPrompt =
    !raw || (/^다음 주장을/.test(raw) && /팩트체크/.test(raw));
  return {
    itemId: item.id,
    text: item.statement,
    imageUrl: item.imageUrl ?? fc?.answerImageUrl,
  };
}

function fillTypeSections(
  type: ReportType,
  overview: string,
  bullets: string[],
  fcItems: SummaryItem[],
  fcMap: Map<string, FactCheckResult>,
  heroImage?: string
): Array<{ heading: string; body: string; imageUrl?: string; entries?: Array<{ itemId?: string; text: string; imageUrl?: string }> }> {
  const headings = REPORT_TYPE_STRUCTURE[type];
  const uniqueBullets = dedupeTexts(bullets);
  const claimEntries = fcItems.map((i) => entryForItem(i, fcMap.get(i.id)));

  const chunk = (parts: string[]) =>
    dedupeTexts(parts.filter(Boolean)).join("\n\n") || overview;

  if (type === "H") {
    return [
      {
        heading: headings[0],
        body: chunk([
          overview,
          uniqueBullets[0] ? `관련 배경: ${uniqueBullets[0]}` : "",
        ]),
        imageUrl: heroImage,
      },
      {
        heading: headings[1],
        body: chunk([]),
        entries: claimEntries.slice(0, 4),
      },
      {
        heading: headings[2],
        body: chunk([
          uniqueBullets.slice(1, 3).join("\n") ||
            "영상에서 제시한 결과·영향을 팩트체크와 함께 검토해야 합니다.",
        ]),
      },
    ];
  }

  if (type === "S") {
    return [
      {
        heading: headings[0],
        body: chunk([overview, uniqueBullets[0] ?? ""]),
        imageUrl: heroImage,
      },
      {
        heading: headings[1],
        body: chunk(uniqueBullets.slice(1, 3).map((b) => `· ${b}`)),
        entries: claimEntries.slice(0, 3),
      },
      {
        heading: headings[2],
        body: chunk([
          uniqueBullets.slice(-1)[0] ||
            "투자 판단 전 지표·리스크를 교차 확인하세요.",
        ]),
      },
    ];
  }

  if (type === "P") {
    return [
      {
        heading: headings[0],
        body: chunk([overview, uniqueBullets[0] ? `핵심 배경: ${uniqueBullets[0]}` : ""]),
        imageUrl: heroImage,
      },
      {
        heading: headings[1],
        body: chunk([]),
        entries: claimEntries,
      },
      {
        heading: headings[2],
        body: chunk([
          uniqueBullets.slice(-2).join("\n") ||
            "향후 전개는 추가 보도·공식 발표를 확인하세요.",
        ]),
      },
    ];
  }

  // C — 교양: 핵심 메시지 중복 제거
  const coreMessage = chunk([
    overview,
    ...uniqueBullets.slice(0, 2).map((b) => `· ${b}`),
  ]);

  return [
    {
      heading: headings[0],
      body: coreMessage,
      imageUrl: heroImage,
    },
    {
      heading: headings[1],
      body: chunk([
        uniqueBullets.slice(2).join("\n") ||
          "핵심 메시지를 일상에 적용할 때 과장·단정은 걸러 보세요.",
      ]),
      entries: claimEntries.slice(0, 4),
    },
  ];
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
