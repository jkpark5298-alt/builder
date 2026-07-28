import type { ReportEntry, ReportSectionBlock, TypedReport } from "./types";
import { normalizeImageUrls } from "./image-urls";

export type FcMarker = {
  n: number;
  key: string;
  sectionIdx: number;
  entryIdx: number;
  entry: ReportEntry;
};

const YT_THUMB = /i\.ytimg\.com|ytimg\.com\/vi\//i;

/** 본문에 고정 저장하는 FC 앵커 속성 (itemId) */
export const FC_ITEM_ATTR = "data-fc-item";

/** 팩트체크 entry(+선택적 FC)에서 이미지만 수집 — 텍스트 제외 */
export function collectEntryImages(
  entry: ReportEntry,
  fc?: {
    answerImageUrl?: string;
    answerImageUrls?: string[];
    answerParts?: Array<{ imageUrls?: string[] }>;
  } | null
): string[] {
  const fromParts = [
    ...(entry.answerParts ?? []).flatMap((p) => p.imageUrls ?? []),
    ...(fc?.answerParts ?? []).flatMap((p) => p.imageUrls ?? []),
  ];
  return Array.from(
    new Set(
      [
        ...normalizeImageUrls(entry.answerImageUrl, entry.answerImageUrls),
        ...normalizeImageUrls(fc?.answerImageUrl, fc?.answerImageUrls),
        ...fromParts,
      ].filter((u) => Boolean(u) && !YT_THUMB.test(u))
    )
  );
}

/** 소주제 연결 팩트체크 이미지 전부 (순서 유지, 중복 제거) */
export function collectSectionFcImages(
  sec: ReportSectionBlock,
  fcByItem?: Map<
    string,
    {
      answerImageUrl?: string;
      answerImageUrls?: string[];
      answerParts?: Array<{ imageUrls?: string[] }>;
    }
  >
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of sec.entries ?? []) {
    const fc = entry.itemId ? fcByItem?.get(entry.itemId) : undefined;
    for (const src of collectEntryImages(entry, fc)) {
      if (seen.has(src)) continue;
      seen.add(src);
      out.push(src);
    }
  }
  return out;
}

/** 보고서 전체 entries를 F1…Fn 순번으로 평탄화 */
export function collectFcMarkers(report: TypedReport): FcMarker[] {
  const out: FcMarker[] = [];
  let n = 1;
  report.sections.forEach((sec, sectionIdx) => {
    (sec.entries ?? []).forEach((entry, entryIdx) => {
      out.push({
        n,
        key: entry.itemId ?? `s${sectionIdx}-e${entryIdx}`,
        sectionIdx,
        entryIdx,
        entry,
      });
      n += 1;
    });
  });
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 저장용 앵커 래퍼 (보기용 뱃지 없음) */
export function wrapFcAnchor(itemId: string, innerHtml: string): string {
  return `<span class="fc-anchor" ${FC_ITEM_ATTR}="${escapeHtml(itemId)}">${innerHtml}</span>`;
}

export function wrapFcAnchorText(itemId: string, text: string): string {
  return wrapFcAnchor(itemId, escapeHtml(text));
}

export function hasFcAnchor(html: string, itemId: string): boolean {
  if (!html || !itemId) return false;
  const esc = escapeHtml(itemId);
  return (
    html.includes(`${FC_ITEM_ATTR}="${esc}"`) ||
    html.includes(`${FC_ITEM_ATTR}='${esc}'`) ||
    html.includes(`${FC_ITEM_ATTR}="${itemId}"`)
  );
}

/**
 * 보기용 뱃지·임시 data-fc-key/n 을 제거하고 저장형 fc-anchor 로 정규화.
 * TipTap 로드·저장 전에 호출.
 */
export function normalizeStoredFcAnchors(html: string): string {
  if (!html?.trim()) return html || "";

  let out = html.replace(
    /<button\b[^>]*\bfc-badge\b[^>]*>[\s\S]*?<\/button>/gi,
    ""
  );

  out = out.replace(/<span\b([^>]*)>/gi, (full, rawAttrs: string) => {
    const attrs = rawAttrs || "";
    const isFc =
      /\bfc-(?:target|anchor)\b/i.test(attrs) ||
      /\bdata-fc-(?:item|key)\s*=/i.test(attrs);
    if (!isFc) return full;

    const itemMatch =
      attrs.match(/\bdata-fc-item\s*=\s*"([^"]*)"/i) ||
      attrs.match(/\bdata-fc-item\s*=\s*'([^']*)'/i) ||
      attrs.match(/\bdata-fc-key\s*=\s*"([^"]*)"/i) ||
      attrs.match(/\bdata-fc-key\s*=\s*'([^']*)'/i);
    if (!itemMatch?.[1]) return full;

    return `<span class="fc-anchor" ${FC_ITEM_ATTR}="${escapeHtml(itemMatch[1])}">`;
  });

  // 보기용으로만 감쌌던 바깥 <u> 한 겹 제거 (앵커 직계 자식)
  out = out.replace(
    new RegExp(
      `(<span\\b[^>]*\\b${FC_ITEM_ATTR}=[^>]*>)\\s*<u>([\\s\\S]*?)<\\/u>\\s*(<\\/span>)`,
      "gi"
    ),
    "$1$2$3"
  );

  return out;
}

/**
 * 본문에서 claim 텍스트를 찾아 저장형 itemId 앵커로 감쌈.
 * 이미 앵커가 있으면 그대로 반환.
 */
export function injectFcAnchorIntoHtml(
  html: string,
  claim: string,
  itemId: string
): string | null {
  if (!itemId) return null;
  if (hasFcAnchor(html, itemId)) return html;

  const needle = claim.trim();
  if (!needle || needle.length < 4) return null;

  const snippet = needle.length > 80 ? needle.slice(0, 80) : needle;
  const plain = html.replace(/<[^>]+>/g, "");
  if (!plain.includes(snippet)) return null;

  let result = "";
  let i = 0;
  let inTag = false;
  let matched = false;

  while (i < html.length) {
    const ch = html[i];
    if (ch === "<") {
      inTag = true;
      result += ch;
      i += 1;
      continue;
    }
    if (ch === ">") {
      inTag = false;
      result += ch;
      i += 1;
      continue;
    }
    if (!inTag && !matched && html.startsWith(snippet, i)) {
      result += wrapFcAnchor(itemId, snippet);
      i += snippet.length;
      matched = true;
      continue;
    }
    result += ch;
    i += 1;
  }

  return matched ? result : null;
}

/** 섹션 본문의 entry claim을 itemId 앵커로 고정 */
export function stabilizeSectionFcAnchors(
  html: string,
  entries: ReportEntry[]
): string {
  let out = normalizeStoredFcAnchors(html || "");
  for (const entry of entries) {
    const id = entry.itemId;
    if (!id) continue;
    const next = injectFcAnchorIntoHtml(out, entry.text, id);
    if (next) out = next;
  }
  return out;
}

/** 보고서 전 섹션 본문에 FC 앵커 고정 */
export function stabilizeReportFcAnchors(report: TypedReport): TypedReport {
  return {
    ...report,
    sections: report.sections.map((sec) => ({
      ...sec,
      body: stabilizeSectionFcAnchors(sec.body || "", sec.entries ?? []),
    })),
  };
}

function stripInnerViewChrome(inner: string): string {
  return inner
    .replace(/<button\b[^>]*\bfc-badge\b[^>]*>[\s\S]*?<\/button>/gi, "")
    .replace(/^<u>([\s\S]*)<\/u>$/i, "$1")
    .trim();
}

function decorateExistingAnchors(
  html: string,
  markers: FcMarker[]
): { html: string; matchedKeys: Set<string> } {
  const matchedKeys = new Set<string>();
  let result = html;

  for (const m of markers) {
    const id = escapeHtml(m.key);
    const re = new RegExp(
      `<span\\b([^>]*\\b${FC_ITEM_ATTR}\\s*=\\s*"${escapeRegExp(id)}"[^>]*)>([\\s\\S]*?)<\\/span>`,
      "i"
    );
    if (!re.test(result)) {
      // try unescaped id (legacy)
      const re2 = new RegExp(
        `<span\\b([^>]*\\b${FC_ITEM_ATTR}\\s*=\\s*"${escapeRegExp(m.key)}"[^>]*)>([\\s\\S]*?)<\\/span>`,
        "i"
      );
      if (!re2.test(result)) continue;
      result = result.replace(re2, (_full, _attrs, inner: string) => {
        matchedKeys.add(m.key);
        const content = stripInnerViewChrome(inner);
        return viewDecoratedAnchor(m.key, m.n, content);
      });
      continue;
    }
    result = result.replace(re, (_full, _attrs, inner: string) => {
      matchedKeys.add(m.key);
      const content = stripInnerViewChrome(inner);
      return viewDecoratedAnchor(m.key, m.n, content);
    });
  }

  return { html: result, matchedKeys };
}

function viewDecoratedAnchor(key: string, n: number, innerHtml: string): string {
  const k = escapeHtml(key);
  return `<span class="fc-target fc-anchor" ${FC_ITEM_ATTR}="${k}" data-fc-key="${k}" data-fc-n="${n}"><u>${innerHtml}</u><button type="button" class="fc-badge" data-fc-key="${k}" data-fc-n="${n}" aria-label="팩트체크 F${n}">F${n}</button></span>`;
}

/**
 * 본문 HTML에서 claim 텍스트를 찾아 보기용 밑줄 + F 뱃지로 감쌈.
 * 못 찾으면 null. (레거시 폴백 — 가능하면 itemId 앵커를 우선)
 */
export function injectFcMarkerIntoHtml(
  html: string,
  claim: string,
  n: number,
  key: string
): string | null {
  const needle = claim.trim();
  if (!needle || needle.length < 4) return null;
  if (hasFcAnchor(html, key) || html.includes(`data-fc-key="${escapeHtml(key)}"`)) {
    return html;
  }

  const snippet = needle.length > 80 ? needle.slice(0, 80) : needle;
  const plain = html.replace(/<[^>]+>/g, "");
  if (!plain.includes(snippet)) return null;

  let result = "";
  let i = 0;
  let inTag = false;
  let matched = false;

  while (i < html.length) {
    const ch = html[i];
    if (ch === "<") {
      inTag = true;
      result += ch;
      i += 1;
      continue;
    }
    if (ch === ">") {
      inTag = false;
      result += ch;
      i += 1;
      continue;
    }
    if (!inTag && !matched && html.startsWith(snippet, i)) {
      result += viewDecoratedAnchor(key, n, snippet);
      i += snippet.length;
      matched = true;
      continue;
    }
    result += ch;
    i += 1;
  }

  return matched ? result : null;
}

/**
 * 보기 모드용: itemId 앵커를 우선 장식하고, 없으면 문장 매칭 폴백.
 */
export function sectionBodyWithMarkers(
  sec: ReportSectionBlock,
  sectionIdx: number,
  markers: FcMarker[]
): { html: string; unmatched: FcMarker[] } {
  const mine = markers.filter((m) => m.sectionIdx === sectionIdx);
  let html = normalizeStoredFcAnchors(sec.body || "");
  const unmatched: FcMarker[] = [];

  const decorated = decorateExistingAnchors(html, mine);
  html = decorated.html;

  for (const m of mine) {
    if (decorated.matchedKeys.has(m.key)) continue;
    const next = injectFcMarkerIntoHtml(html, m.entry.text, m.n, m.key);
    if (next) html = next;
    else unmatched.push(m);
  }

  return { html, unmatched };
}
