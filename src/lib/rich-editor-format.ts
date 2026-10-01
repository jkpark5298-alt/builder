import {
  sanitizeRichHtml,
  wrapRangeWithStyle,
  type InlineStyleOpts,
} from "@/lib/rich-text";

let lastRichSelection: { el: HTMLElement; range: Range } | null = null;

export function getFocusedRichEditor(): HTMLElement | null {
  const active = document.activeElement;
  if (active instanceof HTMLElement) {
    const hit = active.closest(".rich-editor");
    if (hit instanceof HTMLElement) return hit;
  }
  const sel = window.getSelection();
  if (!sel?.rangeCount) return null;
  const node = sel.getRangeAt(0).commonAncestorContainer;
  const el =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node.parentElement;
  const hit = el?.closest?.(".rich-editor");
  return hit instanceof HTMLElement ? hit : null;
}

export function getRichEditorBySectionIdx(idx: number): HTMLElement | null {
  const el = document.querySelector(
    `.rich-editor[data-section-idx="${idx}"]`
  );
  return el instanceof HTMLElement ? el : null;
}

/** 툴바가 포커스를 뺏기 전에 본문 선택을 기억 */
export function rememberRichSelection() {
  const root = getFocusedRichEditor();
  if (!root) return;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return;
  try {
    lastRichSelection = { el: root, range: range.cloneRange() };
  } catch {
    /* ignore */
  }
}

function restoreSelection(range: Range | null) {
  if (!range) return false;
  try {
    const sel = window.getSelection();
    if (!sel) return false;
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  } catch {
    return false;
  }
}

function saveSelection(root: HTMLElement): Range | null {
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    if (root.contains(range.commonAncestorContainer)) {
      return range.cloneRange();
    }
  }
  if (lastRichSelection?.el === root) {
    try {
      return lastRichSelection.range.cloneRange();
    } catch {
      return null;
    }
  }
  return null;
}

/** 커서만 있으면 문단(또는 블록) 전체로 확장 */
export function expandRichSelectionToBlock(
  root: HTMLElement,
  range: Range
): { range: Range; mode: "selection" | "paragraph" | "none" } {
  if (!range.collapsed) {
    return { range: range.cloneRange(), mode: "selection" };
  }
  let node: Node | null = range.startContainer;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  if (!(node instanceof Element) || !root.contains(node)) {
    return { range: range.cloneRange(), mode: "none" };
  }
  const block =
    node.closest("p, div, li, h1, h2, h3, h4") ||
    (node === root ? null : node);
  if (!block || !root.contains(block) || block === root) {
    // 에디터 루트에 직접 텍스트만 있는 경우
    if ((root.textContent || "").replace(/\u00a0/g, " ").trim()) {
      const next = document.createRange();
      next.selectNodeContents(root);
      return { range: next, mode: "paragraph" };
    }
    return { range: range.cloneRange(), mode: "none" };
  }
  const text = (block.textContent || "").replace(/\u00a0/g, " ").trim();
  if (!text) return { range: range.cloneRange(), mode: "none" };
  const next = document.createRange();
  next.selectNodeContents(block);
  return { range: next, mode: "paragraph" };
}

export type RichFormatResult = {
  html: string;
  sectionIdx: number;
  mode: "selection" | "paragraph" | "none";
};

/**
 * 포커스된(또는 지정) rich-editor 선택에 서식 적용 후 sanitize HTML 반환.
 */
export function applyFormatToRichEditor(
  opts: {
    root?: HTMLElement | null;
    sectionIdx?: number;
    style?: InlineStyleOpts;
    insertText?: string;
    expandParagraph?: boolean;
  }
): RichFormatResult | null {
  const root =
    opts.root ||
    getFocusedRichEditor() ||
    (opts.sectionIdx != null
      ? getRichEditorBySectionIdx(opts.sectionIdx)
      : null);
  if (!root) return null;

  const sectionIdx = Number(
    root.getAttribute("data-section-idx") ?? opts.sectionIdx ?? NaN
  );
  if (!Number.isFinite(sectionIdx)) return null;

  root.focus();
  let live = saveSelection(root);
  if (!live) {
    const fallback = document.createRange();
    fallback.selectNodeContents(root);
    fallback.collapse(false);
    live = fallback;
    restoreSelection(live);
  }

  const expand = opts.expandParagraph !== false;
  let mode: "selection" | "paragraph" | "none" = "selection";
  let range = live;

  if (opts.insertText != null) {
    restoreSelection(range);
    try {
      document.execCommand("insertText", false, opts.insertText);
    } catch {
      /* ignore */
    }
    return {
      html: sanitizeRichHtml(root.innerHTML),
      sectionIdx,
      mode: "selection",
    };
  }

  if (expand) {
    const expanded = expandRichSelectionToBlock(root, range);
    range = expanded.range;
    mode = expanded.mode;
    if (mode === "none") {
      return { html: sanitizeRichHtml(root.innerHTML), sectionIdx, mode };
    }
  } else if (range.collapsed) {
    return { html: sanitizeRichHtml(root.innerHTML), sectionIdx, mode: "none" };
  }

  restoreSelection(range);
  if (opts.style) {
    const next = wrapRangeWithStyle(root, range, opts.style);
    if (next) restoreSelection(next);
  }

  return {
    html: sanitizeRichHtml(root.innerHTML),
    sectionIdx,
    mode,
  };
}
