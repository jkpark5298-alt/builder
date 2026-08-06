import { collectFcMarkers, sectionBodyWithMarkers } from "@/lib/fc-markers";
import {
  countTrailingSMarkers,
  htmlWithSImages,
} from "@/lib/report-body-s-slots";
import { normalizeRoomItems } from "@/lib/report-images";
import type { ReportSectionBlock, TypedReport } from "@/lib/types";

/** 섹션 S 슬롯 URL (보기·PDF·인쇄 공통) */
export function sectionViewSlotUrls(
  sec: ReportSectionBlock,
  room: TypedReport["imageRoom"] | undefined,
  slotCount: number
): string[] {
  const out: string[] = Array.from({ length: slotCount }, () => "");
  const stored = sec.images;
  if (stored && stored.length) {
    for (let i = 0; i < slotCount; i++) {
      out[i] = (stored[i] || "").trim();
    }
    return out;
  }
  const items = normalizeRoomItems(room);
  const byId = new Map(items.map((it) => [it.id, it.url]));
  const refs = sec.imageRefs ?? [];
  for (let i = 0; i < slotCount; i++) {
    const id = refs[i];
    out[i] = (id && byId.get(id)) || "";
  }
  return out;
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
    Math.max(sSlotCount, (sec.images || []).length)
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
