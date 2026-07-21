export const MIN_REPORT_FONT_PX = 8;
export const MAX_REPORT_FONT_PX = 28;
export const DEFAULT_REPORT_FONT_PX = 14;
/** 붙여넣기 시 자동으로 맞추는 글자 크기 */
export const PASTE_DEFAULT_FONT_PX = 12;
/** 붙여넣기 시 이 값보다 크면 PASTE_DEFAULT_FONT_PX 로 맞춤 */
export const PASTE_SOFT_MAX_FONT_PX = 16;

export function parseFontSizeToPx(size: string): number | null {
  const raw = size.trim().toLowerCase();
  const m = raw.match(/^([\d.]+)\s*(px|pt|em|rem|%)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = m[2] || "px";
  if (unit === "pt") return Math.round(n * (4 / 3));
  if (unit === "em" || unit === "rem") return Math.round(n * DEFAULT_REPORT_FONT_PX);
  if (unit === "%") return Math.round((n / 100) * DEFAULT_REPORT_FONT_PX);
  return Math.round(n);
}

export function clampFontPx(px: number): number {
  return Math.min(MAX_REPORT_FONT_PX, Math.max(MIN_REPORT_FONT_PX, px));
}

export function normalizePastedFontPx(px: number): number {
  if (px > PASTE_SOFT_MAX_FONT_PX) return PASTE_DEFAULT_FONT_PX;
  return clampFontPx(px);
}

export function findReportBodyEditor(node: Node | null): HTMLElement | null {
  let cur: Node | null = node;
  while (cur) {
    if (cur instanceof HTMLElement && cur.classList.contains("report-body")) {
      return cur;
    }
    cur = cur.parentNode;
  }
  return null;
}

export function rangeHasVisibleText(range: Range): boolean {
  const text =
    range.cloneContents().textContent?.replace(/\u00a0/g, " ").trim() ?? "";
  return text.length > 0;
}

function blockContainer(editor: HTMLElement, node: Node): HTMLElement | null {
  let cur: Node | null = node;
  if (cur.nodeType === Node.TEXT_NODE) cur = cur.parentNode;
  while (cur && cur !== editor) {
    if (cur instanceof HTMLElement) {
      const tag = cur.tagName;
      if (
        tag === "P" ||
        tag === "DIV" ||
        tag === "LI" ||
        tag === "H1" ||
        tag === "H2" ||
        tag === "H3" ||
        tag === "BLOCKQUOTE"
      ) {
        return cur;
      }
    }
    cur = cur.parentNode;
  }
  return null;
}

export function getBlockAtCursor(editor: HTMLElement): HTMLElement | null {
  const sel = window.getSelection();
  if (!sel?.rangeCount) return null;
  return blockContainer(editor, sel.getRangeAt(0).startContainer);
}

export function selectBlockContents(block: HTMLElement): Range | null {
  const text = block.textContent?.replace(/\u00a0/g, " ").trim() ?? "";
  if (!text) return null;
  const range = document.createRange();
  range.selectNodeContents(block);
  return range;
}

export type FontSizeTarget =
  | { mode: "selection"; range: Range }
  | { mode: "paragraph"; range: Range; block: HTMLElement };

export function resolveFontSizeTarget(
  editor: HTMLElement,
  savedRange: Range | null
): FontSizeTarget | null {
  const sel = window.getSelection();
  let range: Range | null = null;

  if (sel?.rangeCount && !sel.getRangeAt(0).collapsed) {
    range = sel.getRangeAt(0).cloneRange();
  } else if (savedRange && !savedRange.collapsed) {
    range = savedRange.cloneRange();
  }

  if (range && findReportBodyEditor(range.commonAncestorContainer) === editor) {
    if (rangeHasVisibleText(range)) {
      return { mode: "selection", range };
    }
  }

  const block = getBlockAtCursor(editor);
  if (block) {
    const blockRange = selectBlockContents(block);
    if (blockRange) {
      return { mode: "paragraph", range: blockRange, block };
    }
  }

  return null;
}

export function applyFontSizeToRange(range: Range, px: number): boolean {
  const size = clampFontPx(px);
  const span = document.createElement("span");
  span.style.fontSize = `${size}px`;

  try {
    const contents = range.extractContents();
    span.appendChild(contents);
    range.insertNode(span);
    range.setStartAfter(span);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    return true;
  } catch {
    return false;
  }
}

export type ApplyFontSizeResult =
  | { ok: true; editor: HTMLElement; mode: "selection" | "paragraph" }
  | { ok: false; hint: string };

export function applyFontSizeInEditor(
  editor: HTMLElement,
  px: number,
  savedRange: Range | null
): ApplyFontSizeResult {
  const target = resolveFontSizeTarget(editor, savedRange);
  if (!target) {
    return {
      ok: false,
      hint: "크기를 바꿀 글자를 드래그로 선택하거나, 커서를 문단 안에 두세요.",
    };
  }

  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(target.range);

  if (!applyFontSizeToRange(target.range, px)) {
    return {
      ok: false,
      hint: "글자 크기를 적용하지 못했습니다. 다시 선택해 주세요.",
    };
  }

  return { ok: true, editor, mode: target.mode };
}

/** 붙여넣기 HTML: 과도한 글자 크기·글꼴 정리 */
export function sanitizePastedHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const body = doc.body;

  const stripTags = new Set([
    "SCRIPT",
    "STYLE",
    "LINK",
    "META",
    "TITLE",
    "HEAD",
    "IFRAME",
    "OBJECT",
    "EMBED",
  ]);

  function normalizeElement(el: HTMLElement) {
    if (stripTags.has(el.tagName)) {
      el.remove();
      return;
    }

    if (el.tagName === "FONT") {
      const span = doc.createElement("span");
      span.innerHTML = el.innerHTML;
      const sizeAttr = el.getAttribute("size");
      if (sizeAttr) {
        const legacy = Math.min(7, Math.max(1, parseInt(sizeAttr, 10) || 3));
        const px = normalizePastedFontPx(10 + legacy * 2);
        span.style.fontSize = `${px}px`;
      }
      const color = el.getAttribute("color");
      if (color) span.style.color = color;
      el.replaceWith(span);
      Array.from(span.children).forEach((c) => {
        if (c instanceof HTMLElement) normalizeElement(c);
      });
      normalizeElement(span);
      return;
    }

    for (const attr of Array.from(el.attributes)) {
      if (
        attr.name.startsWith("class") &&
        /mso|Mso|WordSection/i.test(attr.value)
      ) {
        el.removeAttribute(attr.name);
      }
    }

    el.removeAttribute("class");
    el.removeAttribute("id");

    const style = el.style;
    if (style.fontSize) {
      const px = parseFontSizeToPx(style.fontSize);
      if (px !== null) {
        style.fontSize = `${normalizePastedFontPx(px)}px`;
      } else {
        style.removeProperty("font-size");
      }
    }

    style.removeProperty("font-family");
    style.removeProperty("line-height");
    style.removeProperty("letter-spacing");
    style.removeProperty("margin");
    style.removeProperty("margin-top");
    style.removeProperty("margin-bottom");
    style.removeProperty("width");
    style.removeProperty("height");
    style.removeProperty("min-height");

    if (el.getAttribute("style") === "") {
      el.removeAttribute("style");
    }

    Array.from(el.children).forEach((child) => {
      if (child instanceof HTMLElement) normalizeElement(child);
    });
  }

  Array.from(body.children).forEach((child) => {
    if (child instanceof HTMLElement) normalizeElement(child);
  });

  let out = body.innerHTML.trim();
  if (!out) return "";

  out = out
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<span>\s*<\/span>/gi, "")
    .replace(/\s*mso-[^:;"]+:[^;"]+;?/gi, "")
    .trim();

  return out || "";
}

export function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function wrapPlainPasteText(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  return lines
    .map((line) => {
      const safe = escapeHtmlText(line);
      if (!safe) return "<p><br></p>";
      return `<p><span style="font-size:${PASTE_DEFAULT_FONT_PX}px">${safe}</span></p>`;
    })
    .join("");
}
