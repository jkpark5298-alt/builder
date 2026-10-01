/**
 * insta-fact-library 스타일 인라인 본문 이미지.
 * 레거시 trailing-S + imageRoom 슬롯을 인라인 HTML로 옮기고,
 * 보기/PDF에서 인라인·레거시를 함께 다룹니다.
 */

import {
  countTrailingSMarkers,
  parseBodySImageSlots,
} from "@/lib/report-body-s-slots";
import { orderedSlotUrls } from "@/lib/report-images";
import {
  INLINE_IMG_CLASS,
  INLINE_IMG_DEL_CLASS,
  INLINE_IMG_WRAP_CLASS,
  IMG_SLOT_CLASS,
  htmlToContentParts,
  inlineImageSrcs,
  nextSlotId,
  sanitizeRichHtml,
  stripInlineImageControls,
} from "@/lib/rich-text";
import type { ReportSectionBlock, TypedReport } from "@/lib/types";

export function bodyUsesInlineRichImages(html: string): boolean {
  return /rich-inline-img|rich-img-slot|data-img-slot=/i.test(html || "");
}

function escapeAttr(s: string) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function inlineImageHtml(src: string, alt: string, slotId?: string) {
  const slotAttr = slotId ? ` data-img-slot="${escapeAttr(slotId)}"` : "";
  return (
    `<span class="${INLINE_IMG_WRAP_CLASS}" contenteditable="false">` +
    `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" class="${INLINE_IMG_CLASS}"${slotAttr}>` +
    `<span class="${INLINE_IMG_DEL_CLASS}" role="button" aria-label="${escapeAttr(alt)} 삭제">×</span>` +
    `</span>`
  );
}

function emptySlotHtml(slotId: string) {
  return (
    `<span contenteditable="false" data-img-slot="${escapeAttr(slotId)}" class="${IMG_SLOT_CLASS}">` +
    `${escapeAttr(slotId)} 이미지</span>`
  );
}

/** trailing S + URL 배열 → 인라인 칸/이미지 HTML */
export function legacySSlotsToInlineHtml(
  body: string,
  imageUrls: string[]
): string {
  const raw = body || "";
  if (bodyUsesInlineRichImages(raw)) return raw;

  const { segments, slotCount, textOnlyHtml } = parseBodySImageSlots(raw);
  const urls = (imageUrls || []).map((u) => (u || "").trim());

  if (!slotCount) {
    const base = textOnlyHtml || raw || "";
    const filled = urls.filter(Boolean);
    if (!filled.length) return base;
    let html = base;
    filled.forEach((src, i) => {
      html += inlineImageHtml(src, `S${i + 1}`, `S${i + 1}`);
    });
    return html;
  }

  let imgIdx = 0;
  const parts: string[] = [];
  for (const seg of segments) {
    if (seg.html) parts.push(seg.html);
    if (seg.hasSlot) {
      const n = imgIdx + 1;
      const id = `S${n}`;
      const src = (urls[imgIdx++] || "").trim();
      parts.push(src ? inlineImageHtml(src, id, id) : emptySlotHtml(id));
    }
  }
  while (imgIdx < urls.length) {
    const src = (urls[imgIdx++] || "").trim();
    if (!src) continue;
    const id = `S${imgIdx}`;
    parts.push(inlineImageHtml(src, id, id));
  }
  return parts.join("") || "<p></p>";
}

/** 섹션 본문을 인라인 이미지 HTML로 한 번 이관 (이미 인라인이면 그대로) */
export function migrateSectionToInlineImages(
  sec: ReportSectionBlock,
  room: TypedReport["imageRoom"] | undefined
): ReportSectionBlock {
  const body = sec.body || "";
  if (bodyUsesInlineRichImages(body)) {
    return { ...sec, body, rich: true };
  }
  const slotCount = countTrailingSMarkers(body);
  const urls = orderedSlotUrls(sec, room, Math.max(slotCount, 0));
  if (!slotCount && !urls.some(Boolean) && !(sec.images?.length || sec.imageUrl)) {
    return sec;
  }
  const nextBody = legacySSlotsToInlineHtml(body, urls);
  if (nextBody === body) return { ...sec, rich: true };
  return {
    ...sec,
    body: nextBody,
    rich: true,
    // 이미지는 본문 HTML에 포함 — 슬롯 refs는 비움
    imageRefs: undefined,
    images: undefined,
    imageUrl: undefined,
  };
}

export function migrateReportToInlineImages(report: TypedReport): TypedReport {
  return {
    ...report,
    sections: report.sections.map((sec) =>
      migrateSectionToInlineImages(sec, report.imageRoom)
    ),
  };
}

/** 빈 칸을 채우거나 본문 끝에 인라인 이미지 추가 */
export function appendInlineImagesToHtml(
  html: string,
  urls: string[]
): string {
  const filled = (urls || []).map((u) => (u || "").trim()).filter(Boolean);
  if (!filled.length) return html || "";
  if (typeof document === "undefined") {
    let out = html || "";
    for (const src of filled) {
      const id = nextSlotId(out);
      out += inlineImageHtml(src, id, id);
    }
    return out;
  }
  const root = document.createElement("div");
  root.innerHTML = html || "";
  let ui = 0;
  const emptySlots = Array.from(
    root.querySelectorAll(`.${IMG_SLOT_CLASS}[data-img-slot]`)
  ).filter((el) => !el.classList.contains(INLINE_IMG_WRAP_CLASS));
  for (const slot of emptySlots) {
    if (ui >= filled.length) break;
    const id = slot.getAttribute("data-img-slot") || nextSlotId(root.innerHTML);
    const wrap = document.createElement("span");
    wrap.innerHTML = inlineImageHtml(filled[ui++]!, id, id);
    const node = wrap.firstElementChild;
    if (node) slot.replaceWith(node);
    else slot.remove();
  }
  while (ui < filled.length) {
    const id = nextSlotId(root.innerHTML);
    const wrap = document.createElement("span");
    wrap.innerHTML = inlineImageHtml(filled[ui++]!, id, id);
    const node = wrap.firstElementChild;
    if (node) root.appendChild(node);
  }
  return root.innerHTML;
}

/** 보기/PDF용: 삭제 버튼·빈 칸 제거 */
export function prepareInlineBodyForView(html: string): string {
  let out = stripInlineImageControls(html || "");
  out = out.replace(
    /<span\b[^>]*class=["'][^"']*rich-img-slot[^"']*["'][^>]*>[\s\S]*?<\/span>/gi,
    ""
  );
  if (typeof document !== "undefined") {
    out = sanitizeRichHtml(out);
    out = stripInlineImageControls(out);
  }
  return out;
}

export function inlineBodyContentParts(html: string) {
  return htmlToContentParts(prepareInlineBodyForView(html));
}

export function collectInlineBodyImageSrcs(html: string): string[] {
  return inlineImageSrcs(html || "");
}

export type InlineBodyPart =
  | { type: "html"; html: string }
  | { type: "image"; src: string; alt: string };

function attrFromTag(tag: string, name: string) {
  const m = tag.match(
    new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i")
  );
  return (m?.[1] ?? m?.[2] ?? "").trim();
}

/** 보기·읽기·PDF: 서식 HTML 조각과 이미지를 문서 순서로 분리 */
export function splitPreparedBodyParts(html: string): InlineBodyPart[] {
  const value = prepareInlineBodyForView(html);
  if (!value.trim()) return [];
  const parts: InlineBodyPart[] = [];
  const re = /<img\b[^>]*>/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value))) {
    const before = value.slice(last, m.index);
    if (before.trim()) parts.push({ type: "html", html: before });
    const src = attrFromTag(m[0], "src");
    const alt = attrFromTag(m[0], "alt") || "이미지";
    if (src) parts.push({ type: "image", src, alt });
    last = m.index + m[0].length;
  }
  const rest = value.slice(last);
  if (rest.trim()) parts.push({ type: "html", html: rest });
  return parts;
}
