import { collectFcMarkers, sectionBodyWithMarkers } from "@/lib/fc-markers";
import { headingLooksLikeBody } from "@/lib/report";
import {
  countTrailingSMarkers,
  htmlWithSImages,
} from "@/lib/report-body-s-slots";
import { prepareInlineBodyForView } from "@/lib/report-inline-images";
import {
  orderedSlotUrls,
  sectionSlotCapacity,
} from "@/lib/report-images";
import type { ReportSectionBlock, TypedReport } from "@/lib/types";

/** 섹션 S 슬롯 URL (보기·PDF·인쇄 공통) — refs→room 우선 */
export function sectionViewSlotUrls(
  sec: ReportSectionBlock,
  room: TypedReport["imageRoom"] | undefined,
  slotCount: number
): string[] {
  return orderedSlotUrls(sec, room, slotCount);
}

/** 보기 탭과 동일한 섹션 본문 HTML (FC 뱃지 + 인라인/S 이미지) */
export function buildSectionViewHtml(
  report: TypedReport,
  sectionIdx: number
): { html: string; unmatchedCount: number } {
  const sec = report.sections[sectionIdx];
  if (!sec) return { html: "", unmatchedCount: 0 };
  const markers = collectFcMarkers(report);
  const { html: markedHtml, unmatched } = sectionBodyWithMarkers(
    sec,
    sectionIdx,
    markers
  );

  const heading = sec.heading || "";
  const headingIsBody = headingLooksLikeBody(heading);
  const source = headingIsBody ? `${heading}${markedHtml}` : markedHtml;

  const reflowed = prepareInlineBodyForView(source);
  const slotCount = sectionSlotCapacity(
    sec,
    Math.max(
      countTrailingSMarkers(sec.body || ""),
      countTrailingSMarkers(source),
      countTrailingSMarkers(reflowed)
    )
  );
  let priorSlots = 0;
  for (let i = 0; i < sectionIdx; i += 1) {
    priorSlots += countTrailingSMarkers(report.sections[i]?.body || "");
  }
  const slotUrls = /<img\b/i.test(reflowed)
    ? []
    : orderedSlotUrls(sec, undefined, slotCount);
  const bodyHtml =
    slotUrls.some(Boolean) || countTrailingSMarkers(reflowed) > 0
      ? htmlWithSImages(reflowed, slotUrls, priorSlots)
      : reflowed;
  return {
    html: bodyHtml,
    unmatchedCount: unmatched.length,
  };
}

export function buildAllSectionsViewHtml(report: TypedReport): string {
  return report.sections
    .map((sec, idx) => {
      const { html } = buildSectionViewHtml(report, idx);
      if (!html.trim()) return "";
      return `<section class="report-section" data-section="${idx}">${html}</section>`;
    })
    .filter(Boolean)
    .join("\n");
}
