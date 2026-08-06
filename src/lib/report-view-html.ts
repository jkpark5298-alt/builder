import { collectFcMarkers, sectionBodyWithMarkers } from "@/lib/fc-markers";
import {
  countTrailingSMarkers,
  htmlWithSImages,
} from "@/lib/report-body-s-slots";
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

/** 보기 탭과 동일한 섹션 본문 HTML (FC 뱃지 + S 이미지) */
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
  const sSlotCount = countTrailingSMarkers(sec.body || "");
  const slotUrls = sectionViewSlotUrls(
    sec,
    report.imageRoom,
    sectionSlotCapacity(sec, sSlotCount)
  );
  return {
    html: htmlWithSImages(markedHtml, slotUrls),
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
