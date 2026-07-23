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
  const editor = findReportBodyEditor(range.commonAncestorContainer);
  const sel = window.getSelection();
  if (!sel) return false;

  try {
    sel.removeAllRanges();
    sel.addRange(range);
  } catch {
    return false;
  }

  // 브라우저 기본 fontSize(1~7)로 감싼 뒤 px span으로 교체 — 부분 선택에도 안정적
  try {
    document.execCommand("styleWithCSS", false, "false");
    const ok = document.execCommand("fontSize", false, "7");
    if (!ok) {
      return applyFontSizeToRangeManual(range, size);
    }
  } catch {
    return applyFontSizeToRangeManual(range, size);
  }

  const root = editor ?? document.body;
  const fonts = Array.from(root.querySelectorAll('font[size="7"]'));
  if (!fonts.length) {
    const spans = Array.from(
      root.querySelectorAll(
        'span[style*="xx-large"], span[style*="xxx-large"], font[size]'
      )
    ).filter((el) => {
      // 방금 적용된 것만 — 루트 직전 선택 영역 우선
      return el.closest(".report-body") === root || root.contains(el);
    });
    if (!spans.length) return applyFontSizeToRangeManual(range, size);
    for (const el of spans) {
      // xx-large 등만 교체 (기존 다른 font 태그 보호)
      const fs = (el as HTMLElement).style?.fontSize || "";
      if (
        el.tagName === "FONT" ||
        /xx-large|xxx-large/i.test(fs)
      ) {
        replaceWithSizedSpan(el, size);
      }
    }
    return true;
  }

  for (const font of fonts) {
    replaceWithSizedSpan(font, size);
  }
  return true;
}

function replaceWithSizedSpan(el: Element, px: number) {
  const span = document.createElement("span");
  span.style.fontSize = `${px}px`;
  span.style.lineHeight = "1.45";
  while (el.firstChild) span.appendChild(el.firstChild);
  el.replaceWith(span);
  // 안쪽에도 다른 font-size가 있으면 통일
  span.querySelectorAll<HTMLElement>("[style]").forEach((child) => {
    if (child.style.fontSize) child.style.fontSize = `${px}px`;
  });
}

function applyFontSizeToRangeManual(range: Range, px: number): boolean {
  const span = document.createElement("span");
  span.style.fontSize = `${px}px`;
  span.style.lineHeight = "1.45";
  try {
    range.surroundContents(span);
  } catch {
    try {
      const contents = range.extractContents();
      contents.querySelectorAll?.("span").forEach((s) => {
        if (s instanceof HTMLElement && s.style.fontSize) {
          s.style.fontSize = `${px}px`;
        }
      });
      span.appendChild(contents);
      range.insertNode(span);
    } catch {
      return false;
    }
  }
  try {
    const sel = window.getSelection();
    const after = document.createRange();
    after.selectNodeContents(span);
    after.collapse(false);
    sel?.removeAllRanges();
    sel?.addRange(after);
  } catch {
    /* ignore */
  }
  return true;
}

export type ApplyFontSizeResult =
  | { ok: true; editor: HTMLElement; mode: "selection" | "paragraph" }
  | { ok: false; hint: string };

export function applyFontSizeInEditor(
  editor: HTMLElement,
  px: number,
  savedRange: Range | null
): ApplyFontSizeResult {
  editor.focus();

  const target = resolveFontSizeTarget(editor, savedRange);
  if (!target) {
    return {
      ok: false,
      hint: "크기를 바꿀 글자를 드래그로 선택하거나, 커서를 문단 안에 두세요.",
    };
  }

  try {
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(target.range);
  } catch {
    return {
      ok: false,
      hint: "선택이 풀렸습니다. 글자를 다시 드래그한 뒤 크기를 고르세요.",
    };
  }

  if (!applyFontSizeToRange(target.range, px)) {
    return {
      ok: false,
      hint: "글자 크기를 적용하지 못했습니다. 다시 선택해 주세요.",
    };
  }

  return { ok: true, editor, mode: target.mode };
}

/** 붙여넣기 HTML: 과도한 글자 크기·글꼴·레이아웃(밖으로 삐져나감) 정리 */
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

  /** 본문 밖으로 밀어내는 스타일 — 전부 제거 */
  const LAYOUT_PROPS = [
    "margin",
    "margin-top",
    "margin-right",
    "margin-bottom",
    "margin-left",
    "padding",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "text-indent",
    "position",
    "left",
    "right",
    "top",
    "bottom",
    "inset",
    "transform",
    "translate",
    "float",
    "clear",
    "width",
    "height",
    "min-width",
    "min-height",
    "max-width",
    "max-height",
    "letter-spacing",
    "line-height",
    "font-family",
    "white-space",
    "overflow",
    "overflow-x",
    "overflow-y",
  ] as const;

  function stripLayoutStyles(style: CSSStyleDeclaration) {
    for (const prop of LAYOUT_PROPS) {
      style.removeProperty(prop);
    }
    // shorthand / vendor
    style.removeProperty("margin-inline");
    style.removeProperty("margin-block");
    style.removeProperty("padding-inline");
    style.removeProperty("padding-block");
    style.removeProperty("text-align-last");
  }

  function normalizeElement(el: HTMLElement) {
    if (stripTags.has(el.tagName)) {
      el.remove();
      return;
    }

    // 목록은 들여쓰기·마커 때문에 박스를 자주 뚫음 → 문단으로 평탄화
    if (el.tagName === "UL" || el.tagName === "OL") {
      const frag = doc.createDocumentFragment();
      Array.from(el.children).forEach((li) => {
        if (!(li instanceof HTMLElement)) return;
        const p = doc.createElement("p");
        const raw = (li.textContent || "").trim();
        p.textContent = raw ? `- ${raw.replace(/^[-•·▪◦]\s*/, "")}` : "";
        if (!p.textContent) p.innerHTML = "<br>";
        frag.appendChild(p);
      });
      el.replaceWith(frag);
      return;
    }

    if (el.tagName === "LI") {
      const p = doc.createElement("p");
      const raw = (el.textContent || "").trim();
      p.textContent = raw ? `- ${raw.replace(/^[-•·▪◦]\s*/, "")}` : "";
      if (!p.textContent) p.innerHTML = "<br>";
      el.replaceWith(p);
      normalizeElement(p);
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
    el.removeAttribute("align");
    el.removeAttribute("width");
    el.removeAttribute("height");
    el.removeAttribute("dir");

    const style = el.style;
    if (style.fontSize) {
      const px = parseFontSizeToPx(style.fontSize);
      if (px !== null) {
        style.fontSize = `${normalizePastedFontPx(px)}px`;
      } else {
        style.removeProperty("font-size");
      }
    }

    stripLayoutStyles(style);

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
  // 중첩 ul 치환 후 남은 노드도 한 번 더
  Array.from(body.querySelectorAll("ul, ol, li")).forEach((n) => {
    if (n instanceof HTMLElement && body.contains(n)) normalizeElement(n);
  });

  let out = body.innerHTML.trim();
  if (!out) return "";

  out = out
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<span>\s*<\/span>/gi, "")
    .replace(/\s*mso-[^:;"]+:[^;"]+;?/gi, "")
    .replace(/\s*(margin|padding|text-indent)\s*:[^;"]*;?/gi, "")
    .trim();

  return out || "";
}

/**
 * 편집 중(엔터·붙여넣기 후) 본문 DOM에 남은 레이아웃 스타일을 제거해
 * 글자가 contentEditable 박스 밖으로 나가지 않게 함.
 */
export function containReportBodyLayout(editor: HTMLElement): boolean {
  let changed = false;
  const LAYOUT_RE =
    /(?:^|;)\s*(?:margin(?:-(?:left|right|top|bottom|inline|block))?|padding(?:-(?:left|right|top|bottom|inline|block))?|text-indent|position|left|right|top|bottom|inset|transform|float|width|min-width|max-width)\s*:/i;

  editor.querySelectorAll<HTMLElement>("*").forEach((el) => {
    // FC 뱃지 등은 유지
    if (el.classList.contains("fc-badge") || el.classList.contains("fc-target")) {
      return;
    }

    if (el.tagName === "UL" || el.tagName === "OL") {
      const parent = el.parentNode;
      if (!parent) return;
      const items = Array.from(el.children);
      for (const li of items) {
        const p = document.createElement("p");
        const raw = (li.textContent || "").trim();
        p.textContent = raw ? `- ${raw.replace(/^[-•·▪◦]\s*/, "")}` : "";
        if (!p.textContent) p.innerHTML = "<br>";
        parent.insertBefore(p, el);
      }
      el.remove();
      changed = true;
      return;
    }

    const styleAttr = el.getAttribute("style");
    if (styleAttr && LAYOUT_RE.test(styleAttr)) {
      const style = el.style;
      [
        "margin",
        "marginTop",
        "marginRight",
        "marginBottom",
        "marginLeft",
        "padding",
        "paddingTop",
        "paddingRight",
        "paddingBottom",
        "paddingLeft",
        "textIndent",
        "position",
        "left",
        "right",
        "top",
        "bottom",
        "transform",
        "float",
        "width",
        "minWidth",
        "maxWidth",
      ].forEach((k) => {
        if ((style as unknown as Record<string, string>)[k]) {
          style.removeProperty(
            k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
          );
          changed = true;
        }
      });
      // JS style 속성명으로도 제거
      style.margin = "";
      style.marginLeft = "";
      style.marginRight = "";
      style.padding = "";
      style.paddingLeft = "";
      style.paddingRight = "";
      style.textIndent = "";
      style.position = "";
      style.left = "";
      style.right = "";
      style.float = "";
      style.width = "";
      if (el.getAttribute("style") === "") el.removeAttribute("style");
      changed = true;
    }

    if (el.getAttribute("align")) {
      el.removeAttribute("align");
      changed = true;
    }
  });

  return changed;
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
