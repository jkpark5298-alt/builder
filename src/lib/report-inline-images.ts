/**
 * insta-fact-library 스타일 인라인 본문 이미지.
 * 레거시 trailing-S + imageRoom 슬롯을 인라인 HTML로 옮기고,
 * 보기/PDF에서 인라인·레거시를 함께 다룹니다.
 */

import {
  countTrailingSMarkers,
  parseBodySImageSlots,
} from "@/lib/report-body-s-slots";
import {
  bindSectionSlotUrls,
  normalizeRoomItems,
  orderedSlotUrls,
  orderedSlotUrlsWithRoomFallback,
} from "@/lib/report-images";
import { reflowFlattenedReportText, shouldReflowReportText } from "@/lib/paste";
import {
  htmlToPlainSlots,
  normalizePlainSlotMarks,
  plainSlotsToBodyHtml,
} from "@/lib/plain-report-doc";
import {
  headingLooksLikeBody,
  mergeReportSectionsToSingleBody,
} from "@/lib/report";
import {
  INLINE_IMG_CLASS,
  INLINE_IMG_DEL_CLASS,
  INLINE_IMG_WRAP_CLASS,
  IMG_SLOT_CLASS,
  fillEmptyRichSlotsInHtml,
  htmlToContentParts,
  hydrateSMarksInHtml,
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
    `<span class="${INLINE_IMG_WRAP_CLASS}" contenteditable="false"${slotAttr}>` +
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

function isProductItemLine(line: string): boolean {
  return /^\d{1,2}\)\s*\S/.test(line.trim());
}

function isRoutineBreakLine(line: string): boolean {
  const t = line.replace(/^\s*[-–—·•]\s*/, "").trim();
  if (!t) return false;
  if (/^\d+\s*단계\b/.test(t)) return true;
  if (/^(아침|저녁)\s*루틴\b/.test(t)) return true;
  if (/^한눈에/.test(t)) return true;
  if (/루틴\s*$/.test(t) && t.length <= 40) return true;
  return false;
}

/** 1) 2) 5) 제품 설명 뒤에 [S1][S2]… 를 넣습니다. 루틴/단계 앞에서 끊습니다. */
export function insertContentSMarks(text: string, imageCount: number): string {
  const want = Math.max(0, imageCount);
  if (want <= 0) return String(text || "");
  const { text: marked, count } = normalizePlainSlotMarks(text);
  if (count >= want) return marked;

  let src = marked
    .replace(/([^\n])(\d{1,2}\)\s*)/g, "$1\n$2")
    .replace(/([^\n])(\d+\s*단계\s*[:：]?)/g, "$1\n$2")
    .replace(/([^\n])((?:아침|저녁)\s*루틴\s*[:：])/g, "$1\n$2");
  const lines = src.split("\n");
  const out: string[] = [];
  let n = count;
  let pending = false;

  const flush = () => {
    if (!pending || n >= want) {
      pending = false;
      return;
    }
    n += 1;
    while (out.length && !out[out.length - 1]?.trim()) out.pop();
    out.push("");
    out.push(`[S${n}]`);
    out.push("");
    pending = false;
  };

  for (const line of lines) {
    if (/\[S\d{0,2}\]/i.test(line)) {
      pending = false;
      out.push(line);
      continue;
    }
    if (isProductItemLine(line)) {
      flush();
      out.push(line);
      pending = true;
      continue;
    }
    if (isRoutineBreakLine(line)) {
      flush();
      out.push(line);
      continue;
    }
    out.push(line);
  }
  flush();
  return normalizePlainSlotMarks(out.join("\n")).text;
}

/** 사진이 본문 끝에만 붙어 있으면 true (내용 사이에는 없음) */
export function imagesDumpedAtEnd(html: string): boolean {
  let s = String(html || "");
  const trailRe =
    /(?:<p\b[^>]*>\s*)?(?:<span\b[^>]*rich-inline-img-wrap[^>]*>[\s\S]*?<\/span>|<figure\b[^>]*>[\s\S]*?<\/figure>|<img\b[^>]*>)(?:\s*<\/p>)?\s*$/i;
  let trailing = 0;
  while (trailRe.test(s)) {
    s = s.replace(trailRe, "");
    trailing += 1;
  }
  if (trailing <= 0) return false;
  if ((s.match(/<img\b/gi) || []).length > 0) return false;
  return (s.match(/\d{1,2}\)/g) || []).length >= 2;
}

/** trailing S + URL 배열 → 인라인 칸/이미지 HTML */
export function legacySSlotsToInlineHtml(
  body: string,
  imageUrls: string[],
  opts?: { appendExtra?: boolean }
): string {
  const raw = body || "";
  const appendExtra = opts?.appendExtra !== false;
  if (bodyUsesInlineRichImages(raw) && !/\[S\d{0,2}\]/i.test(raw)) {
    if (/<img\b/i.test(raw)) return raw;
    return fillEmptyRichSlotsInHtml(raw, imageUrls);
  }

  const { segments, slotCount } = parseBodySImageSlots(raw);
  const urls = (imageUrls || []).map((u) => (u || "").trim());

  if (!slotCount) {
    const base = raw || "";
    const filled = urls.filter(Boolean);
    if (!filled.length || !appendExtra) return base;
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
  if (appendExtra) {
    while (imgIdx < urls.length) {
      const src = (urls[imgIdx++] || "").trim();
      if (!src) continue;
      const id = `S${imgIdx}`;
      parts.push(inlineImageHtml(src, id, id));
    }
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
  return sanitizeRichHtml(root.innerHTML);
}

/** 한 덩어리로 붙은 본문·이스케이프된 태그를 번호·불릿 기준으로 다시 나눔 */
export function reflowReportBodyHtml(html: string): string {
  const raw = html || "";
  const { text, urls } = htmlToPlainSlots(raw, []);
  if (!text.trim()) return raw;
  const split = shouldReflowReportText(text)
    ? reflowFlattenedReportText(text)
    : text;
  const next = plainSlotsToBodyHtml(split) || raw;
  return urls.some(Boolean) ? legacySSlotsToInlineHtml(next, urls) : next;
}

function sectionPhotoUrls(
  sec: ReportSectionBlock,
  room: TypedReport["imageRoom"] | undefined,
  body: string,
  priorSlots = 0,
): string[] {
  const roomUrls = normalizeRoomItems(room).map((it) => it.url);
  const parsed = htmlToPlainSlots(body, roomUrls);
  const slotCount = Math.max(
    parsed.count,
    countTrailingSMarkers(body),
    roomUrls.length,
  );
  const urls = orderedSlotUrlsWithRoomFallback(sec, room, slotCount, priorSlots);
  return Array.from(
    { length: Math.max(urls.length, parsed.urls.length, roomUrls.length) },
    (_, i) => (urls[i] || parsed.urls[i] || roomUrls[i] || "").trim(),
  ).filter(Boolean);
}

/** 붙은 글을 문단으로 나누고, 없는 사진은 저장된 그림으로 채웁니다. */
export function visualBodyHtml(
  sec: ReportSectionBlock,
  room?: TypedReport["imageRoom"],
  priorSlots = 0,
): string {
  let heading = sec.heading || "";
  let body = sec.body || "";
  if (headingLooksLikeBody(heading)) {
    body = `${heading}${body}`;
  }
  const filled = sectionPhotoUrls(sec, room, body, priorSlots);
  const hasRealImgs = /<img\b/i.test(body);
  const dumped = hasRealImgs && imagesDumpedAtEnd(body);
  if (hasRealImgs && !dumped) {
    let next = body;
    if (/\[S\d{0,2}\]/i.test(next)) next = hydrateSMarksInHtml(next, filled);
    if (/rich-img-slot/i.test(next)) next = fillEmptyRichSlotsInHtml(next, filled);
    return next;
  }
  const parsed = htmlToPlainSlots(body, filled);
  const pCount = (body.match(/<p\b/gi) || []).length;
  const needsReflow = pCount < 3 && shouldReflowReportText(parsed.text);
  let text = parsed.text;
  const withoutTailMarks = text.replace(/(?:\n*\[S\d{0,2}\]\s*)+$/gi, "").trim();
  const marksOnlyAtEnd =
    /\[S\d{0,2}\]/i.test(text) &&
    !/\[S\d{0,2}\]/i.test(withoutTailMarks) &&
    (withoutTailMarks.match(/\d{1,2}\)/g) || []).length >= 2;
  if (dumped || marksOnlyAtEnd) text = withoutTailMarks;
  if (needsReflow || ((dumped || marksOnlyAtEnd) && shouldReflowReportText(text))) {
    text = reflowFlattenedReportText(text);
  }
  const markCount = (text.match(/\[S\d{0,2}\]/gi) || []).length;
  if (filled.length && markCount < filled.length) {
    text = insertContentSMarks(text, filled.length);
  }
  if (needsReflow || dumped || marksOnlyAtEnd || /\[S\d{0,2}\]/i.test(text)) {
    const textHtml = plainSlotsToBodyHtml(text);
    return filled.length
      ? legacySSlotsToInlineHtml(textHtml, filled, { appendExtra: false })
      : textHtml;
  }
  return body;
}

/** 제목에 본문이 들어 있으면 본문 칸으로만 옮깁니다. 내용·사진은 바꾸지 않습니다. */
export function promoteHeadingBody(report: TypedReport): TypedReport {
  let changed = false;
  const sections = report.sections.map((sec) => {
    const heading = sec.heading || "";
    if (!headingLooksLikeBody(heading)) return sec;
    changed = true;
    return {
      ...sec,
      heading: "본문",
      body: `${heading}${sec.body || ""}`,
      rich: true,
    };
  });
  return changed ? { ...report, sections } : report;
}

/** 수정 화면용: 제목-본문 합치고, 본문에 있는 사진만 유지합니다. */
export function preparePlainDocForVisualEdit(
  report: TypedReport,
  opts?: { mergeSections?: boolean },
): TypedReport {
  const base = opts?.mergeSections
    ? mergeReportSectionsToSingleBody(report)
    : report;
  let room = base.imageRoom;
  const sections = base.sections.map((sec, idx) => {
    let heading = sec.heading || "";
    let body = sec.body || "";
    if (headingLooksLikeBody(heading)) {
      body = `${heading}${body}`;
      heading = "본문";
    }
    let prior = 0;
    for (let i = 0; i < idx; i += 1) {
      prior += countTrailingSMarkers(base.sections[i]?.body || "");
    }
    const visual = visualBodyHtml({ ...sec, heading, body }, room, prior);
    const srcs = collectInlineBodyImageSrcs(visual);
    const bound = bindSectionSlotUrls(sec, room, srcs, {
      heading,
      body: visual,
      rich: true,
    });
    room = bound.room;
    return bound.section;
  });
  return { ...base, imageRoom: room, sections };
}

/** 보기용: 삭제 버튼·빈 칸만 빼고 본문·사진은 그대로 둡니다. */
export function prepareInlineBodyForView(html: string): string {
  let out = stripInlineImageControls(html || "");
  out = out.replace(
    /<span\b[^>]*class=["'][^"']*rich-img-slot[^"']*["'][^>]*>[\s\S]*?<\/span>/gi,
    "",
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

/** 표지 후보: 본문·이미지 룸·입력 글에 있는 그림 */
export function collectCoverCandidates(video: {
  inputBodyHtml?: string;
  articleImages?: string[];
  report?: {
    sections?: Array<{ body?: string }>;
    imageRoom?: Array<string | { url?: string }>;
  } | null;
}): string[] {
  const urls: string[] = [];
  const push = (raw?: string) => {
    const u = (raw || "").trim();
    if (!u) return;
    if (urls.includes(u)) return;
    urls.push(u);
  };
  for (const sec of video.report?.sections ?? []) {
    for (const src of collectInlineBodyImageSrcs(sec.body || "")) push(src);
  }
  for (const item of video.report?.imageRoom ?? []) {
    push(typeof item === "string" ? item : item.url);
  }
  for (const u of video.articleImages ?? []) push(u);
  if (video.inputBodyHtml) {
    for (const src of collectInlineBodyImageSrcs(video.inputBodyHtml)) push(src);
  }
  return urls;
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
