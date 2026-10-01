/**
 * 유튜브·보관소 TEXT 보고서: 본문에 [S1][S2]… 표시 + imageRoom 연결.
 * 보기·수정·편집 끝내기가 같은 저장본을 씁니다.
 */

import { bodyHtmlToPlainEditText, repairLeakedHtml } from "@/lib/rich-text";
import {
  bindSectionSlotUrls,
  normalizeRoomItems,
} from "@/lib/report-images";
import {
  headingLooksLikeBody,
  mergeReportSectionsToSingleBody,
  plainTextToHtml,
} from "@/lib/report";
import type { TypedReport } from "@/lib/types";

function attrSrc(tag: string): string {
  const m = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
  return (m?.[1] ?? m?.[2] ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .trim();
}

function nextSlotNumber(text: string): number {
  let max = 0;
  const re = /\[S(\d{1,2})\]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const n = Number(m[1]);
    if (n > max) max = n;
  }
  return max + 1;
}

/** 빈 칸·S1 이미지·단독 S 를 [S1][S2]… 로 맞춥니다. */
export function normalizePlainSlotMarks(text: string): {
  text: string;
  count: number;
} {
  let s = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  s = s.replace(/S\d{0,2}\s*이미지/gi, "[S]");
  s = s.replace(/\[S\d{0,2}\]/gi, "[S]");
  s = s.replace(/^[ \t]*[Ss]\d{0,2}\.?[ \t]*$/gm, "[S]");
  s = s.replace(
    /([.!?。．…가-힣)\]」』])[ \t]*[Ss]\d{0,2}\.?[ \t]*(?=\n|$)/g,
    "$1\n[S]",
  );
  let n = 0;
  s = s.replace(/\[S\]/g, () => {
    n += 1;
    return `[S${n}]`;
  });
  return { text: s.replace(/\n{3,}/g, "\n\n").trim(), count: n };
}

export function countPlainSlotMarks(text: string): number {
  return (String(text || "").match(/\[S\d{1,2}\]/gi) || []).length;
}

/** 평문 → 저장용 문단 HTML ([S1] 유지, 인라인 img 없음) */
export function plainSlotsToBodyHtml(text: string): string {
  const { text: marked } = normalizePlainSlotMarks(text);
  return marked.trim() ? plainTextToHtml(marked) : "<p></p>";
}

/** HTML·태그 글자 → 편집용 평문 + 슬롯 URL (문서 순서) */
export function htmlToPlainSlots(
  html: string,
  roomUrls: string[] = [],
): { text: string; urls: string[]; count: number } {
  const extracted: string[] = [];
  let s = repairLeakedHtml(html || "");

  s = s.replace(
    /<figure\b[^>]*>[\s\S]*?<\/figure>|<span\b[^>]*class=["'][^"']*rich-inline-img-wrap[^"']*["'][^>]*>[\s\S]*?<\/span>|<img\b[^>]*>|<span\b[^>]*rich-img-slot[^>]*>[\s\S]*?<\/span>/gi,
    (tag) => {
      const emptySlot =
        /rich-img-slot/i.test(tag) && !/<img\b/i.test(tag);
      extracted.push(emptySlot ? "" : attrSrc(tag));
      return "\n[S]\n";
    },
  );

  const marked = normalizePlainSlotMarks(bodyHtmlToPlainEditText(s));
  const urls = Array.from({ length: marked.count }, (_, i) => extracted[i] || "");
  const used = new Set(urls.filter(Boolean));
  const unused = roomUrls.filter((u) => u && !used.has(u));
  let ui = 0;
  for (let i = 0; i < urls.length; i += 1) {
    if (!urls[i] && unused[ui]) {
      urls[i] = unused[ui]!;
      ui += 1;
    }
  }
  return { text: marked.text, urls, count: marked.count };
}

/**
 * 문장 끝 S / s → 다음 [Sn] 표시.
 * 영문 단어 중간 s 는 건드리지 않습니다.
 */
export function insertPlainSAtCursor(
  text: string,
  cursor: number,
): { text: string; cursor: number; slot: number } | null {
  const t = String(text || "");
  if (cursor < 1 || cursor > t.length) return null;
  const ch = t[cursor - 1];
  if (ch !== "S" && ch !== "s") return null;

  const before = t.slice(0, cursor - 1);
  const after = t.slice(cursor);
  if (/\[S\d{0,2}$/i.test(before) && after.startsWith("]")) return null;
  if (/\[[Ss]\d*$/.test(before + ch)) return null;

  const prev = before.slice(-1);
  if (/[a-zA-Z]/.test(prev) && (ch === "S" || ch === "s")) return null;
  const atSentenceEnd =
    before.length === 0 ||
    /[\s.。！？!?…」』”"）\]\n]/.test(prev) ||
    /[가-힣0-9]$/.test(before);
  if (!atSentenceEnd) return null;

  const slot = nextSlotNumber(before + after);
  const insert = `\n\n[S${slot}]\n\n`;
  return {
    text: before + insert + after,
    cursor: before.length + insert.length,
    slot,
  };
}

/** 새 이미지를 빈 [Sn]에 넣고, 없으면 다음 번호를 붙입니다. */
export function applyPlainImages(
  text: string,
  currentUrls: string[],
  newUrls: string[],
): { text: string; urls: string[] } {
  const marked = normalizePlainSlotMarks(text);
  let nextText = marked.text;
  const urls = Array.from({ length: marked.count }, (_, i) =>
    (currentUrls[i] || "").trim(),
  );
  for (const src of newUrls.map((u) => u.trim()).filter(Boolean)) {
    const empty = urls.findIndex((u) => !u);
    if (empty >= 0) {
      urls[empty] = src;
      continue;
    }
    const slot = urls.length + 1;
    nextText = `${nextText.replace(/\s*$/, "")}\n\n[S${slot}]\n\n`;
    urls.push(src);
  }
  return { text: nextText.replace(/\n{3,}/g, "\n\n").trim(), urls };
}

export function removePlainSlotAt(
  text: string,
  urls: string[],
  index: number,
): { text: string; urls: string[] } {
  const marked = normalizePlainSlotMarks(text);
  const nextUrls = urls.filter((_, i) => i !== index);
  let n = 0;
  const nextText = marked.text
    .replace(/\[S\d{1,2}\]/gi, () => {
      const drop = n === index;
      n += 1;
      return drop ? "" : `[S]`;
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return normalizeApplied(nextText, nextUrls);
}

function normalizeApplied(
  text: string,
  urls: string[],
): { text: string; urls: string[] } {
  const marked = normalizePlainSlotMarks(text);
  return {
    text: marked.text,
    urls: Array.from({ length: marked.count }, (_, i) => urls[i] || ""),
  };
}

/** 제목-본문 혼입·슬롯 번호를 저장용 TEXT 로 맞춥니다. */
export function normalizePlainDocReport(
  report: TypedReport,
  opts?: { mergeSections?: boolean },
): TypedReport {
  const base = opts?.mergeSections
    ? mergeReportSectionsToSingleBody(report)
    : report;
  const roomUrls = normalizeRoomItems(base.imageRoom).map((it) => it.url);
  const converted = base.sections.map((sec) => {
    let heading = sec.heading || "";
    let body = sec.body || "";
    if (headingLooksLikeBody(heading)) {
      body = `${heading}${body}`;
      heading = "본문";
    }
    const slots = htmlToPlainSlots(body, []);
    return { sec, heading, ...slots };
  });

  let n = 0;
  const allUrls: string[] = [];
  const numbered = converted.map((c) => {
    const text = c.text.replace(/\[S\d{0,2}\]/gi, () => {
      n += 1;
      return `[S${n}]`;
    });
    allUrls.push(...c.urls);
    return { ...c, text, count: (text.match(/\[S\d{1,2}\]/gi) || []).length };
  });

  const used = new Set(allUrls.filter(Boolean));
  const unused = roomUrls.filter((u) => u && !used.has(u));
  let ui = 0;
  for (let i = 0; i < allUrls.length; i += 1) {
    if (!allUrls[i] && unused[ui]) {
      allUrls[i] = unused[ui]!;
      ui += 1;
    }
  }

  let urlIdx = 0;
  let nextRoom = base.imageRoom;
  const sections = numbered.map(({ sec, heading, text, count }) => {
    const slotUrls = allUrls.slice(urlIdx, urlIdx + count);
    urlIdx += count;
    const bound = bindSectionSlotUrls(sec, nextRoom, slotUrls, {
      heading,
      body: plainSlotsToBodyHtml(text),
      rich: true,
    });
    nextRoom = bound.room;
    return bound.section;
  });

  return { ...base, imageRoom: nextRoom, sections };
}
