export const MIN_REPORT_FONT_PX = 8;
export const MAX_REPORT_FONT_PX = 28;
export const DEFAULT_REPORT_FONT_PX = 14;

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
        const px = clampFontPx(10 + legacy * 2);
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

    el.removeAttribute("class");
    el.removeAttribute("id");

    const style = el.style;
    if (style.fontSize) {
      const px = parseFontSizeToPx(style.fontSize);
      if (px !== null) {
        style.fontSize = `${clampFontPx(px)}px`;
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

  // Word/Office 잔여 주석·빈 span 정리
  out = out
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<span>\s*<\/span>/gi, "")
    .trim();

  return out || "";
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
