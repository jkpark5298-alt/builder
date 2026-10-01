/** Rich caption helpers — HTML subset for bold/underline/color/highlight/images */

import { reflowFlattenedReportText, shouldReflowReportText } from "@/lib/paste";


const ALLOWED_TAGS = new Set([
  "B",
  "STRONG",
  "I",
  "EM",
  "U",
  "SPAN",
  "BR",
  "DIV",
  "P",
  "IMG",
]);

export function looksLikeHtml(value: string) {
  return /<\/?[a-z][\s\S]*>/i.test(String(value || "").trim());
}

const LEAKED_TAG_RE = /<\/?(?:p|div|span|br|strong|em|u|b|i)\b/i;

/** 본문에 태그가 글자로 들어간 경우(&lt;p&gt; 또는 화면에 보이는 &lt;p&gt;)를 실제 HTML 로 되돌립니다. */
export function repairLeakedHtml(raw: string): string {
  let s = String(raw || "");
  if (!s.trim()) return s;
  for (let i = 0; i < 4; i += 1) {
    if (!/&(?:amp;)*lt;\/?[a-z]/i.test(s)) break;
    s = s
      .replace(/&amp;/g, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/g, '"');
  }
  let asPlain = htmlToPlainText(s);
  for (let i = 0; i < 3 && LEAKED_TAG_RE.test(asPlain); i += 1) {
    s = sanitizeRichHtml(asPlain);
    asPlain = htmlToPlainText(s);
  }
  return s;
}

function inlineImageMarkup(src: string, id: string): string {
  const safe = src.replace(/"/g, "&quot;");
  if (typeof document !== "undefined") {
    return createInlineImage(src, id, id).outerHTML;
  }
  return (
    `<span class="${INLINE_IMG_WRAP_CLASS}" contenteditable="false" data-img-slot="${id}">` +
    `<img src="${safe}" alt="${id}" class="${INLINE_IMG_CLASS}" data-img-slot="${id}">` +
    `</span>`
  );
}

/** 빈 S칸에 이미 고른 사진 URL을 넣습니다. 서식 HTML은 그대로 둡니다. */
export function fillEmptyRichSlotsInHtml(html: string, urls: string[] = []): string {
  const used = new Set(inlineImageSrcs(html));
  const pool = (urls || [])
    .map((u) => (u || "").trim())
    .filter((u) => u && !used.has(u));
  let i = 0;
  return String(html || "").replace(
    /<span\b[^>]*rich-img-slot[^>]*>[\s\S]*?<\/span>/gi,
    (tag) => {
      if (/<img\b/i.test(tag)) return tag;
      const src = pool[i] || "";
      i += 1;
      if (!src) return tag;
      const id =
        /data-img-slot=["']([^"']+)["']/i.exec(tag)?.[1] || `S${i}`;
      return inlineImageMarkup(src, id);
    },
  );
}

/** [S1][S2]… 글자를 실제 인라인 사진(또는 빈 칸)으로 바꿉니다. */
export function hydrateSMarksInHtml(html: string, urls: string[] = []): string {
  const list = (urls || []).map((u) => (u || "").trim());
  let i = 0;
  return String(html || "").replace(/\[S\d{0,2}\]/gi, () => {
    const src = list[i] || "";
    i += 1;
    const id = `S${i}`;
    if (src) return inlineImageMarkup(src, id);
    return "";
  });
}

/** 편집기 value → 실제 렌더 HTML (이스케이프된 태그·평문을 모두 처리) */
export function valueToEditorHtml(value: string, slotUrls: string[] = []): string {
  const repaired = repairLeakedHtml(value);
  let html = looksLikeHtml(repaired) ? sanitizeRichHtml(repaired) : plainToHtml(repaired);
  if (/&(?:amp;)*lt;\/?[a-z]/i.test(html)) {
    html = sanitizeRichHtml(repairLeakedHtml(html));
  }
  let plain = htmlToPlainText(html);
  if (LEAKED_TAG_RE.test(plain)) {
    html = sanitizeRichHtml(plain);
    plain = htmlToPlainText(html);
  }
  const structured =
    (html.match(/<p\b/gi) || []).length >= 2 || /<img\b/i.test(html);
  if (structured) return html;
  const srcs = [...inlineImageSrcs(html)];
  for (const u of slotUrls) {
    const url = (u || "").trim();
    if (url && !srcs.includes(url)) srcs.push(url);
  }
  if (/rich-img-slot/i.test(html) && srcs.some(Boolean)) {
    html = fillEmptyRichSlotsInHtml(html, srcs);
    plain = htmlToPlainText(html);
  }
  const hasMarks = /\[S\d{0,2}\]/i.test(html) || /\[S\d{0,2}\]/i.test(plain);
  if (typeof document !== "undefined" && (shouldReflowReportText(plain) || hasMarks)) {
    if (shouldReflowReportText(plain)) {
      html = sanitizeRichHtml(
        textToBlockHtml(reflowFlattenedReportText(plain)) || html,
      );
    }
    html = hydrateSMarksInHtml(html, srcs);
  }
  return html;
}

function stripTagsAsText(s: string): string {
  return String(s || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|h[1-6]|blockquote|ul|ol)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 저장된 HTML·태그 글자 → 편집용 평문 (아이폰 textarea) */
export function bodyHtmlToPlainEditText(html: string): string {
  let s = String(html || "");
  for (let i = 0; i < 4; i += 1) {
    if (!/&(?:amp;)*lt;\/?[a-z]/i.test(s)) break;
    s = s
      .replace(/&amp;/g, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/g, '"');
  }
  if (/<\/?[a-z][\s\S]*>/i.test(s)) {
    s = stripTagsAsText(s);
  } else {
    s = htmlToPlainText(repairLeakedHtml(s));
    if (LEAKED_TAG_RE.test(s) || /<\/?[a-z][^>]*>/i.test(s)) {
      s = stripTagsAsText(s);
    }
  }
  if (
    shouldReflowReportText(s) ||
    /\d+[.)]/.test(s) ||
    /언제\s*:/.test(s) ||
    /[-–—]\s/.test(s)
  ) {
    s = reflowFlattenedReportText(s);
  }
  s = s.replace(/S(\d{1,2})\s*이미지/gi, "[S$1]");
  return s.replace(/\n{3,}/g, "\n\n").trim();
}

/** 평문 → 저장용 문단 HTML (이미지 URL 은 뒤에 유지) */
export function plainEditTextToBodyHtml(
  text: string,
  keepImagesFromHtml = "",
): string {
  let t = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (LEAKED_TAG_RE.test(t) || /<\/?[a-z][^>]*>/i.test(t)) {
    t = bodyHtmlToPlainEditText(t);
  } else if (
    shouldReflowReportText(t) ||
    /\d+[.)]/.test(t) ||
    /언제\s*:/.test(t)
  ) {
    t = reflowFlattenedReportText(t);
  }
  let html = textToBlockHtml(t) || "<p></p>";
  const srcs = inlineImageSrcs(keepImagesFromHtml);
  if (typeof document !== "undefined") {
    for (const src of srcs) {
      const id = nextSlotId(html);
      html += createInlineImage(src, id, id).outerHTML;
    }
  }
  return html;
}

export function editorShowsLeakedHtml(root: HTMLElement): boolean {
  const text = (root.innerText || root.textContent || "").slice(0, 8000);
  return LEAKED_TAG_RE.test(text);
}

function parseHtmlFragment(html: string): ChildNode[] {
  const tmp = document.createElement("template");
  tmp.innerHTML = html || "";
  return Array.from(tmp.content.childNodes);
}

function replaceEditorChildren(el: HTMLElement, nodes: ChildNode[]) {
  while (el.firstChild) el.removeChild(el.firstChild);
  for (const node of nodes) el.appendChild(node);
}

/**
 * contenteditable 에 innerHTML 을 직접 넣으면 iOS 가 태그를 글자로 보여 줍니다.
 * template 에서 파싱한 노드만 옮깁니다.
 */
export function fillRichEditor(el: HTMLElement, html: string, slotUrls: string[] = []) {
  const safe = valueToEditorHtml(html, slotUrls);
  const wasEditable = el.getAttribute("contenteditable");
  el.removeAttribute("contenteditable");
  replaceEditorChildren(el, parseHtmlFragment(safe));
  if (editorShowsLeakedHtml(el)) {
    const leaked = (el.innerText || el.textContent || "").trim();
    replaceEditorChildren(el, parseHtmlFragment(valueToEditorHtml(leaked)));
  }
  if (wasEditable != null) el.setAttribute("contenteditable", wasEditable);
}

export const INLINE_IMG_CLASS = "rich-inline-img";
export const INLINE_IMG_WRAP_CLASS = "rich-inline-img-wrap";
export const INLINE_IMG_DEL_CLASS = "rich-inline-img-del";
export const IMG_SLOT_CLASS = "rich-img-slot";

export function stripInlineImageControls(html: string) {
  return String(html || "").replace(
    /<span\b[^>]*class=["'][^"']*rich-inline-img-del[^"']*["'][^>]*>[\s\S]*?<\/span>/gi,
    "",
  );
}

export function htmlToPlainText(html: string) {
  const value = stripInlineImageControls(html);
  if (!value) return "";
  if (typeof document === "undefined") {
    return value
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .trim();
  }
  const el = document.createElement("div");
  el.innerHTML = value;
  el.querySelectorAll(`.${INLINE_IMG_DEL_CLASS}`).forEach((node) => node.remove());
  el.querySelectorAll(`.${INLINE_IMG_WRAP_CLASS}`).forEach((wrap) => {
    const img = wrap.querySelector("img");
    if (img) wrap.replaceWith(img);
    else wrap.remove();
  });
  el.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  el.querySelectorAll("img").forEach((img) => {
    const alt = img.getAttribute("alt") || "이미지";
    img.replaceWith(`[${alt}]`);
  });
  el.querySelectorAll("[data-img-slot]").forEach((slot) => {
    const id = slot.getAttribute("data-img-slot") || "S";
    slot.replaceWith(`[${id}]`);
  });
  return (el.innerText || el.textContent || "")
    .replace(/\u00a0/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Normalize #hex / rgb(a) to #rrggbb for sanitize + editor tools. */
export function toHexColor(value: string): string | null {
  const v = String(value || "").trim();
  const hex = v.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    const body = hex[1];
    if (body.length === 3) {
      return `#${body
        .split("")
        .map((ch) => `${ch}${ch}`)
        .join("")
        .toLowerCase()}`;
    }
    return `#${body.slice(0, 6).toLowerCase()}`;
  }
  const rgb = v.match(
    /^rgba?\(\s*(\d+)\s*[,/\s]\s*(\d+)\s*[,/\s]\s*(\d+)/i,
  );
  if (rgb) {
    const h = (n: number) =>
      Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
    return `#${h(Number(rgb[1]))}${h(Number(rgb[2]))}${h(Number(rgb[3]))}`;
  }
  return null;
}

export type InlineStyleOpts = {
  color?: string;
  backgroundColor?: string;
  bold?: boolean;
  underline?: boolean;
  fontSize?: string;
};

function styleFromInlineAttrs(style: InlineStyleOpts) {
  const parts: string[] = [];
  const colorHex = style.color ? toHexColor(style.color) : null;
  const bgHex = style.backgroundColor
    ? toHexColor(style.backgroundColor)
    : null;
  if (colorHex) parts.push(`color:${colorHex}`);
  if (bgHex) parts.push(`background-color:${bgHex}`);
  if (style.bold) parts.push("font-weight:700");
  if (style.underline) parts.push("text-decoration:underline");
  if (style.fontSize && /^\d+(\.\d+)?px$/i.test(style.fontSize.trim())) {
    parts.push(`font-size:${style.fontSize.trim()}`);
  }
  return parts.join(";");
}

/**
 * Wrap a live selection in a styled span (bold/underline/color/highlight).
 * More reliable than execCommand when the toolbar steals focus.
 */
export function wrapRangeWithStyle(
  root: HTMLElement,
  range: Range,
  style: InlineStyleOpts,
): Range | null {
  if (!root.contains(range.commonAncestorContainer)) return null;
  if (range.collapsed) return null;

  const css = styleFromInlineAttrs(style);
  if (!css) return null;

  // Prefer semantic tags when only bold or only underline is requested.
  let wrapper: HTMLElement;
  if (
    style.bold &&
    !style.underline &&
    !style.color &&
    !style.backgroundColor &&
    !style.fontSize
  ) {
    wrapper = document.createElement("b");
  } else if (
    style.underline &&
    !style.bold &&
    !style.color &&
    !style.backgroundColor &&
    !style.fontSize
  ) {
    wrapper = document.createElement("u");
  } else {
    wrapper = document.createElement("span");
    wrapper.setAttribute("style", css);
  }

  try {
    range.surroundContents(wrapper);
  } catch {
    const contents = range.extractContents();
    wrapper.appendChild(contents);
    range.insertNode(wrapper);
  }

  const next = document.createRange();
  next.selectNodeContents(wrapper);
  return next;
}

function sanitizeStyle(style: string) {
  const out: string[] = [];
  const color = style.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i)?.[1]?.trim();
  const bg =
    style.match(/(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/i)?.[1]?.trim();
  const weight = style.match(/(?:^|;)\s*font-weight\s*:\s*([^;]+)/i)?.[1]?.trim();
  const decoration = style
    .match(/(?:^|;)\s*text-decoration(?:-line)?\s*:\s*([^;]+)/i)?.[1]
    ?.trim();
  const fontSize = style.match(/(?:^|;)\s*font-size\s*:\s*([^;]+)/i)?.[1]?.trim();
  const colorHex = color ? toHexColor(color) : null;
  const bgHex = bg ? toHexColor(bg) : null;
  if (colorHex) out.push(`color:${colorHex}`);
  if (bgHex) out.push(`background-color:${bgHex}`);
  if (weight && /^(bold|700|800|900)$/i.test(weight)) out.push("font-weight:700");
  if (decoration && /underline/i.test(decoration)) {
    out.push("text-decoration:underline");
  }
  if (fontSize && /^\d+(\.\d+)?px$/i.test(fontSize)) {
    out.push(`font-size:${fontSize}`);
  }
  return out.join(";");
}

/**
 * contenteditable 은 텍스트 노드의 \\n 을 줄바꿈으로 보여 주지만,
 * innerHTML 로 다시 파싱하면 브라우저가 그 개행을 공백으로 합칩니다.
 * 태그 사이 공백 개행은 버리고, 글 안의 개행만 <br> 로 남깁니다.
 */
export function newlinesToBrInText(html: string): string {
  const src = String(html || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!src.includes("\n")) return src;
  let out = "";
  let i = 0;
  while (i < src.length) {
    if (src[i] === "<") {
      const end = src.indexOf(">", i);
      if (end < 0) {
        out += src.slice(i);
        break;
      }
      out += src.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    const next = src.indexOf("<", i);
    const text = next < 0 ? src.slice(i) : src.slice(i, next);
    if (/^\s*$/.test(text)) {
      out += text.replace(/\n+/g, "");
    } else {
      out += text.replace(/\n/g, "<br>");
    }
    i = next < 0 ? src.length : next;
  }
  return out;
}

export function sanitizeRichHtml(html: string) {
  const value = newlinesToBrInText(String(html || ""));
  if (!value || typeof document === "undefined") return value;
  const root = document.createElement("div");
  root.innerHTML = value;

  const walk = (node: Node) => {
    const children = Array.from(node.childNodes);
    for (const child of children) {
      if (child.nodeType === Node.TEXT_NODE) continue;
      if (child.nodeType !== Node.ELEMENT_NODE) {
        child.parentNode?.removeChild(child);
        continue;
      }
      const el = child as HTMLElement;
      const tag = el.tagName.toUpperCase();
      if (tag === "FONT" || tag === "MARK") {
        const color =
          toHexColor(el.getAttribute("color") || "") ||
          toHexColor(el.style.color || "");
        const bg =
          toHexColor(el.style.backgroundColor || "") ||
          toHexColor(el.style.background || "") ||
          (tag === "MARK" ? "#fef08a" : null);
        const span = document.createElement("span");
        const css = styleFromInlineAttrs({
          color: color || undefined,
          backgroundColor: bg || undefined,
        });
        if (css) span.setAttribute("style", css);
        while (el.firstChild) span.appendChild(el.firstChild);
        el.replaceWith(span);
        walk(node);
        return;
      }
      if (!ALLOWED_TAGS.has(tag)) {
        const frag = document.createDocumentFragment();
        while (el.firstChild) frag.appendChild(el.firstChild);
        el.replaceWith(frag);
        walk(node);
        return;
      }
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        if (name === "style") {
          const cleaned = sanitizeStyle(attr.value);
          if (cleaned) el.setAttribute("style", cleaned);
          else el.removeAttribute("style");
          continue;
        }
        if (tag === "IMG" && (name === "src" || name === "alt")) {
          const src = el.getAttribute("src") || "";
          if (
            !src.startsWith("/") &&
            !src.startsWith("https://") &&
            !src.startsWith("http://") &&
            !src.startsWith("data:image/")
          ) {
            el.remove();
          }
          continue;
        }
        if (
          name === "data-img-slot" ||
          name === "data-fc-item" ||
          name === "data-fc-key" ||
          name === "data-fc-n" ||
          name === "class" ||
          name === "contenteditable"
        ) {
          continue;
        }
        if (name === "role" || name === "aria-label") continue;
        el.removeAttribute(attr.name);
      }
      if (el.classList.contains(INLINE_IMG_WRAP_CLASS)) {
        el.setAttribute("contenteditable", "false");
        el.classList.remove(IMG_SLOT_CLASS);
        walk(el);
        continue;
      }
      if (tag === "IMG") {
        if (!el.parentNode) continue;
        el.setAttribute("contenteditable", "false");
        el.classList.add(INLINE_IMG_CLASS);
        el.classList.remove(IMG_SLOT_CLASS);
        ensureInlineImageWrap(el as HTMLImageElement);
        continue;
      }
      if (el.getAttribute("data-img-slot")) {
        el.setAttribute("contenteditable", "false");
        el.classList.add(IMG_SLOT_CLASS);
      }
      walk(el);
    }
  };

  walk(root);
  unwrapFontSizeOnlySpans(root);
  replaceTextNewlinesWithBr(root);
  renumberInlineImageSlots(root);
  return root.innerHTML;
}

/** 붙여넣기용 font-size 껍질은 저장·편집에 태그를 남기므로 벗깁니다. */
function unwrapFontSizeOnlySpans(root: ParentNode) {
  const spans = Array.from(root.querySelectorAll("span"));
  for (const span of spans) {
    if ((span.className || "").trim()) continue;
    if (
      span.hasAttribute("data-img-slot") ||
      span.hasAttribute("data-fc-item") ||
      span.hasAttribute("data-fc-key")
    ) {
      continue;
    }
    const style = (span.getAttribute("style") || "").trim();
    if (!style || /^font-size:\s*[\d.]+px;?$/i.test(style)) {
      const frag = document.createDocumentFragment();
      while (span.firstChild) frag.appendChild(span.firstChild);
      span.replaceWith(frag);
    }
  }
}

/** contenteditable 에만 보이던 텍스트 줄바꿈(\n)을 보기용 <br> 로 바꿉니다. */
function replaceTextNewlinesWithBr(root: ParentNode) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let cur: Node | null;
  while ((cur = walker.nextNode())) {
    if (cur.nodeValue && /[\r\n]/.test(cur.nodeValue)) {
      nodes.push(cur as Text);
    }
  }
  for (const text of nodes) {
    if (text.parentElement?.closest("pre")) continue;
    const parts = text.nodeValue!.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    if (parts.length < 2) continue;
    const frag = document.createDocumentFragment();
    parts.forEach((part, i) => {
      if (part) frag.appendChild(document.createTextNode(part));
      if (i < parts.length - 1) frag.appendChild(document.createElement("br"));
    });
    text.replaceWith(frag);
  }
}

export function plainToHtml(text: string) {
  const value = String(text || "");
  if (!value) return "";
  if (looksLikeHtml(value)) return sanitizeRichHtml(value);
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}

export const TEXT_COLORS = [
  { id: "ink", label: "검정", value: "#1e293b" },
  { id: "orange", label: "주황", value: "#c45c26" },
  { id: "blue", label: "파랑", value: "#2563eb" },
  { id: "red", label: "빨강", value: "#dc2626" },
  { id: "green", label: "녹색", value: "#15803d" },
] as const;

export const HIGHLIGHT_COLORS = [
  { id: "yellow", label: "노랑 형광", value: "#fef08a" },
  { id: "sky", label: "파랑 형광", value: "#bfdbfe" },
  { id: "pink", label: "빨강 형광", value: "#fecaca" },
  { id: "mint", label: "녹색 형광", value: "#bbf7d0" },
] as const;

function ensureDeleteControl(wrap: HTMLElement, img: HTMLImageElement) {
  let del = wrap.querySelector(`:scope > .${INLINE_IMG_DEL_CLASS}`) as HTMLElement | null;
  if (!del) {
    del = document.createElement("span");
    del.className = INLINE_IMG_DEL_CLASS;
    wrap.appendChild(del);
  }
  const alt = img.getAttribute("alt") || "이미지";
  del.setAttribute("contenteditable", "false");
  del.setAttribute("role", "button");
  del.setAttribute("aria-label", `${alt} 삭제`);
  del.textContent = "삭제";
}

function applySlotIdToWrap(wrap: HTMLElement, img: HTMLImageElement) {
  const slotId = img.getAttribute("data-img-slot");
  if (slotId) wrap.setAttribute("data-img-slot", slotId);
  else wrap.removeAttribute("data-img-slot");
}

/** Wrap a pasted/inline image so the editor can show a delete control. */
export function ensureInlineImageWrap(img: HTMLImageElement) {
  const parent = img.parentElement;
  if (parent?.classList.contains(INLINE_IMG_WRAP_CLASS)) {
    parent.setAttribute("contenteditable", "false");
    parent.classList.remove(IMG_SLOT_CLASS);
    applySlotIdToWrap(parent, img);
    ensureDeleteControl(parent, img);
    return parent;
  }
  const wrap = document.createElement("span");
  wrap.className = INLINE_IMG_WRAP_CLASS;
  wrap.setAttribute("contenteditable", "false");
  img.replaceWith(wrap);
  wrap.appendChild(img);
  applySlotIdToWrap(wrap, img);
  ensureDeleteControl(wrap, img);
  return wrap;
}

export function createInlineImage(src: string, alt: string, slotId?: string) {
  const img = document.createElement("img");
  img.src = src;
  img.alt = alt;
  img.className = INLINE_IMG_CLASS;
  img.setAttribute("contenteditable", "false");
  if (slotId) img.setAttribute("data-img-slot", slotId);
  return ensureInlineImageWrap(img);
}

function escapeText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function countRichBreaks(html: string): number {
  return (htmlToPlainText(html).match(/\n/g) || []).length;
}

function textToBlockHtml(text: string) {
  const parts = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.replace(/^\n+|\n+$/g, ""))
    .filter((p) => p.length > 0);
  if (!parts.length) return "";
  return parts
    .map((p) => `<p>${escapeText(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function collectLiveImages(root: HTMLElement) {
  return Array.from(root.querySelectorAll("img")).filter((img) =>
    (img.getAttribute("src") || "").trim()
  );
}

function placeImagesInHtml(html: string, imgs: HTMLImageElement[]) {
  let out = html;
  for (const img of imgs) {
    const src = (img.getAttribute("src") || "").trim();
    if (!src) continue;
    const slot = (img.getAttribute("data-img-slot") || "").trim();
    const alt = (img.getAttribute("alt") || slot || "이미지").trim();
    const piece = createInlineImage(src, alt, slot || undefined).outerHTML;
    const tokens = [slot, alt, slot ? `[${slot}]` : "", alt ? `[${alt}]` : ""].filter(
      (t) => t && t !== "이미지",
    );
    let placed = false;
    for (const token of tokens) {
      const safe = escapeText(token).replace(/[[\]]/g, "\\$&");
      const re = new RegExp(
        `(?:<br\\s*/?>|</p>\\s*<p>)?\\s*(?:${safe}|${token.replace(/[[\]]/g, "\\$&")})\\s*(?:<br\\s*/?>)?`,
        "i"
      );
      if (re.test(out)) {
        out = out.replace(re, piece);
        placed = true;
        break;
      }
    }
    if (!placed && /\[S\d{1,2}\]/i.test(out)) {
      out = out.replace(/\[S\d{1,2}\]/i, piece);
      placed = true;
    }
    if (!placed) out += piece;
  }
  return out;
}

/**
 * iPhone Safari 는 contenteditable innerHTML 에서 줄바꿈을 빼 버립니다.
 * 화면(DOM·innerText)에 보이는 줄을 기준으로 HTML 을 다시 만듭니다.
 */
export function serializeLiveRichEditor(root: HTMLElement): string {
  const raw = String(root.innerHTML || "");
  const leakedText = (root.innerText || "").replace(/\u00a0/g, " ");
  const liveImgs = collectLiveImages(root);
  if (!LEAKED_TAG_RE.test(leakedText)) {
    return sanitizeRichHtml(raw);
  }
  if (LEAKED_TAG_RE.test(leakedText)) {
    let html = valueToEditorHtml(leakedText);
    const plain = htmlToPlainText(html);
    if (shouldReflowReportText(plain) || liveImgs.length) {
      html = sanitizeRichHtml(
        placeImagesInHtml(
          shouldReflowReportText(plain)
            ? textToBlockHtml(reflowFlattenedReportText(plain))
            : html,
          liveImgs
        )
      );
    }
    return html;
  }

  const parts: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const raw = node.textContent || "";
      if (!raw) return;
      if (LEAKED_TAG_RE.test(raw)) {
        parts.push(sanitizeRichHtml(raw));
        return;
      }
      parts.push(escapeText(raw).replace(/\n/g, "<br>"));
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.classList.contains(INLINE_IMG_DEL_CLASS)) return;
    const tag = node.tagName;
    if (tag === "BR") {
      parts.push("<br>");
      return;
    }
    if (tag === "IMG" || node.classList.contains(INLINE_IMG_WRAP_CLASS)) {
      const img =
        tag === "IMG"
          ? (node as HTMLImageElement)
          : node.querySelector("img");
      const src = (img?.getAttribute("src") || "").trim();
      if (src && img) {
        const slot = img.getAttribute("data-img-slot") || undefined;
        const alt = img.getAttribute("alt") || slot || "이미지";
        parts.push(createInlineImage(src, alt, slot).outerHTML);
      }
      return;
    }
    if (node.classList.contains(IMG_SLOT_CLASS)) {
      parts.push(node.outerHTML);
      return;
    }
    const block = /^(DIV|P|LI|H[1-6]|BLOCKQUOTE)$/.test(tag);
    for (const child of Array.from(node.childNodes)) walk(child);
    if (block) parts.push("<br>");
  };
  for (const child of Array.from(root.childNodes)) walk(child);

  let html = parts.join("").replace(/(?:<br>\s*){3,}/g, "<br><br>");
  html = sanitizeRichHtml(html);

  let liveText = (root.innerText || "").replace(/\u00a0/g, " ");
  if (/<\/?(?:p|div|span|br|strong)\b/i.test(liveText)) {
    html = sanitizeRichHtml(liveText);
    liveText = htmlToPlainText(html);
  }
  const liveBreaks = (liveText.match(/\n/g) || []).length;
  const htmlBreaks = countRichBreaks(html);
  if (liveBreaks > htmlBreaks + 1) {
    html = sanitizeRichHtml(
      placeImagesInHtml(textToBlockHtml(liveText), liveImgs)
    );
  }
  const plain = htmlToPlainText(html);
  if (shouldReflowReportText(plain) && liveImgs.length === 0) {
    html = sanitizeRichHtml(
      placeImagesInHtml(
        textToBlockHtml(reflowFlattenedReportText(plain)),
        liveImgs
      )
    );
  } else if (liveImgs.length && !/<img\b/i.test(html)) {
    html = sanitizeRichHtml(placeImagesInHtml(html, liveImgs));
  }
  return html;
}

/** 같은 글인데 줄만 사라진 저장본이면 true (아이폰 blur 후 평탄화) */
export function isFlattenedRichHtml(prev: string, next: string): boolean {
  const a = htmlToPlainText(prev).replace(/\s+/g, " ").trim();
  const b = htmlToPlainText(next).replace(/\s+/g, " ").trim();
  if (!a || a !== b) return false;
  return countRichBreaks(next) + 2 < countRichBreaks(prev);
}

export function collectUsedSlotNumbers(html: string) {
  const used = new Set<number>();
  const re = /data-img-slot\s*=\s*(?:["']S(\d+)["']|S(\d+))/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    used.add(Number(m[1] || m[2]));
  }
  return used;
}

export function nextSlotId(html: string) {
  const used = collectUsedSlotNumbers(html);
  let n = 1;
  while (used.has(n)) n += 1;
  return `S${n}`;
}

/** 문서 순서대로 빈 칸·이미지를 S1·S2… 로 다시 매깁니다. */
export function renumberInlineImageSlots(root: ParentNode) {
  const nodes = Array.from(
    root.querySelectorAll(
      `img.${INLINE_IMG_CLASS}, span.${IMG_SLOT_CLASS}:not(.${INLINE_IMG_WRAP_CLASS})`,
    ),
  );
  nodes.forEach((el, index) => {
    const id = `S${index + 1}`;
    el.setAttribute("data-img-slot", id);
    if (el instanceof HTMLImageElement) {
      el.setAttribute("alt", id);
      const wrap = el.closest(`.${INLINE_IMG_WRAP_CLASS}`);
      if (wrap instanceof HTMLElement) {
        wrap.setAttribute("data-img-slot", id);
        const del = wrap.querySelector(`.${INLINE_IMG_DEL_CLASS}`);
        if (del) del.setAttribute("aria-label", `${id} 삭제`);
      }
      return;
    }
    if (el instanceof HTMLElement) {
      const label = (el.textContent || "").trim();
      if (!label || /^S\d+\s*이미지/i.test(label)) {
        el.textContent = `${id} 이미지`;
      }
    }
  });
}

export type RichContentPart =
  | { type: "text"; value: string }
  | { type: "image"; src: string; alt: string };

function decodeBasicEntities(value: string) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function attrFromTag(tag: string, name: string) {
  const m = tag.match(
    new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"),
  );
  return (m?.[1] ?? m?.[2] ?? "").trim();
}

function htmlTextFragment(html: string) {
  return decodeBasicEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div)>/gi, "\n")
      .replace(/<(p|div)[^>]*>/gi, "")
      .replace(/<[^>]+>/g, ""),
  ).replace(/\u00a0/g, " ");
}

function pushTextPart(parts: RichContentPart[], html: string) {
  const value = htmlTextFragment(html);
  if (!value) return;
  const last = parts[parts.length - 1];
  if (last?.type === "text") last.value += value;
  else parts.push({ type: "text", value });
}

/** Split caption HTML into text and inline images, preserving document order. */
export function htmlToContentParts(html: string): RichContentPart[] {
  const value = stripInlineImageControls(html);
  if (!value.trim()) return [];
  const parts: RichContentPart[] = [];
  const re =
    /<img\b[^>]*>|<span\b[^>]*data-img-slot=["'][^"']+["'][^>]*>[\s\S]*?<\/span>/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value))) {
    pushTextPart(parts, value.slice(last, m.index));
    const tag = m[0];
    if (/^<img\b/i.test(tag)) {
      const src = attrFromTag(tag, "src");
      const alt = attrFromTag(tag, "alt") || "이미지";
      if (src) parts.push({ type: "image", src, alt });
      else pushTextPart(parts, `[${alt}]`);
    } else {
      const id = attrFromTag(tag, "data-img-slot") || "S";
      pushTextPart(parts, `[${id}]`);
    }
    last = m.index + tag.length;
  }
  pushTextPart(parts, value.slice(last));
  return parts;
}

export function inlineImageSrcs(html: string): string[] {
  return htmlToContentParts(html)
    .filter(
      (part): part is Extract<RichContentPart, { type: "image" }> =>
        part.type === "image",
    )
    .map((part) => part.src);
}
