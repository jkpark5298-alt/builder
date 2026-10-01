"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  HIGHLIGHT_COLORS,
  TEXT_COLORS,
  createInlineImage,
  editorShowsLeakedHtml,
  fillRichEditor,
  htmlToPlainText,
  nextSlotId,
  plainToHtml,
  renumberInlineImageSlots,
  sanitizeRichHtml,
  serializeLiveRichEditor,
  valueToEditorHtml,
  wrapRangeWithStyle,
} from "@/lib/rich-text";
import {
  applyPlainImages,
  htmlToPlainSlots,
  insertPlainSAtCursor,
  plainSlotsToBodyHtml,
} from "@/lib/plain-report-doc";
async function confirmAction(opts: {
  message: string;
  danger?: boolean;
  confirmLabel?: string;
}): Promise<boolean> {
  return window.confirm(opts.message);
}

type Props = {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
  minHeightClass?: string;
  disabled?: boolean;
  /** Upload pasted/picked images; return stored URL (or null). */
  onUploadImages?: (files: File[]) => Promise<string[]>;
  /** full = library 서식 툴바, images = 이미지 칸/+ 만 (서식은 상단 FormatToolbar) */
  toolbarMode?: "full" | "images";
  /** 섹션 인덱스 — 상단 서식 툴바가 본문을 찾을 때 사용 */
  sectionIdx?: number;
  /**
   * 긴 글 붙여넣기. true면 커서 삽입을 하지 않습니다.
   * 보고서 본문 전체 교체용.
   */
  onPastePlain?: (text: string) => boolean;
  /** 안내 문구·이미지 칸 버튼 숨김 (본문 다듬기) */
  hideHelp?: boolean;
  /** 유튜브·보관소: textarea 로 편집 (아이폰 HTML 누출 방지) */
  plainMode?: boolean;
  /** TEXT 모드 [S1]… 에 연결된 이미지 URL */
  plainSlotUrls?: string[];
  /** TEXT 모드에서 이미지 칸 URL 이 바뀌면 호출 */
  onPlainSlotUrlsChange?: (urls: string[]) => void;
};

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

function saveSelection(root: HTMLElement | null): Range | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !root) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  return range.cloneRange();
}

function rangeStillInEditor(root: HTMLElement, range: Range | null) {
  if (!range) return false;
  try {
    return root.contains(range.commonAncestorContainer);
  } catch {
    return false;
  }
}

/**
 * execCommand('insertText')는 아이폰·일부 PC 브라우저 contenteditable에서
 * preventDefault 이후 아무 것도 넣지 않습니다. DOM에 직접 삽입합니다.
 */
function insertPlainTextAtCaret(
  root: HTMLElement,
  text: string,
  fallbackRange?: Range | null,
) {
  root.focus();
  const sel = window.getSelection();
  let range: Range | null = null;
  if (sel && sel.rangeCount > 0) {
    const live = sel.getRangeAt(0);
    if (root.contains(live.commonAncestorContainer)) range = live;
  }
  if (
    !range &&
    fallbackRange &&
    rangeStillInEditor(root, fallbackRange)
  ) {
    range = fallbackRange.cloneRange();
    restoreSelection(range);
  }
  if (!range) {
    range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
    restoreSelection(range);
  }
  range.deleteContents();
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const frag = document.createDocumentFragment();
  lines.forEach((line, index) => {
    if (index > 0) frag.appendChild(document.createElement("br"));
    if (line) frag.appendChild(document.createTextNode(line));
  });
  const caretMark = document.createTextNode("");
  frag.appendChild(caretMark);
  range.insertNode(frag);
  const caret = document.createRange();
  caret.setStart(caretMark, 0);
  caret.collapse(true);
  const next = window.getSelection();
  next?.removeAllRanges();
  next?.addRange(caret);
}

function plainTextFromClipboard(data: DataTransfer | null): string {
  if (!data) return "";
  const plain =
    data.getData("text/plain") || data.getData("text/uri-list") || "";
  if (plain) return plain;
  const html = data.getData("text/html") || "";
  if (!html.trim()) return "";
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return (doc.body?.innerText || doc.body?.textContent || "").replace(
      /\u00a0/g,
      " ",
    );
  } catch {
    return "";
  }
}

export function RichTextEditor({
  value,
  onChange,
  placeholder = "텍스트를 입력하세요",
  className = "",
  minHeightClass = "min-h-[10rem]",
  disabled = false,
  onUploadImages,
  toolbarMode = "full",
  sectionIdx,
  onPastePlain,
  hideHelp = false,
  plainMode = false,
  plainSlotUrls,
  onPlainSlotUrlsChange,
}: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const savedRange = useRef<Range | null>(null);
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const applyingRef = useRef(false);
  const skipBlurSyncRef = useRef(false);
  const slotAwaitRef = useRef<string | null>(null);
  const [slotAwait, setSlotAwait] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [plainText, setPlainText] = useState(() => htmlToPlainSlots(value).text);
  const plainFocusedRef = useRef(false);
  const plainTextRef = useRef(plainText);
  plainTextRef.current = plainText;
  const plainAreaRef = useRef<HTMLTextAreaElement>(null);
  const plainUrlsRef = useRef<string[]>(plainSlotUrls ?? []);
  plainUrlsRef.current = plainSlotUrls ?? htmlToPlainSlots(value).urls;
  const [canUndo, setCanUndo] = useState(false);
  const uid = useId();

  const emitHtml = useCallback(
    (html: string, pushHistory = true) => {
      const cleaned = sanitizeRichHtml(html);
      if (pushHistory) {
        const hist = historyRef.current.slice(0, historyIndexRef.current + 1);
        if (hist[hist.length - 1] !== cleaned) {
          hist.push(cleaned);
          if (hist.length > 40) hist.shift();
          historyRef.current = hist;
          historyIndexRef.current = hist.length - 1;
          setCanUndo(historyIndexRef.current > 0);
        }
      }
      onChange(cleaned);
    },
    [onChange],
  );

  const syncFromEditor = useCallback(() => {
    const el = editorRef.current;
    if (!el || applyingRef.current) return;
    renumberInlineImageSlots(el);
    emitHtml(serializeLiveRichEditor(el), true);
  }, [emitHtml]);

  useLayoutEffect(() => {
    if (plainMode) return;
    const el = editorRef.current;
    if (!el) return;
    const incoming = valueToEditorHtml(value, plainSlotUrls);
    const leaked = editorShowsLeakedHtml(el);
    const current = sanitizeRichHtml(el.innerHTML);
    if (!leaked && incoming === current) return;
    if (!leaked && document.activeElement === el && focused) return;
    applyingRef.current = true;
    fillRichEditor(el, value, plainSlotUrls);
    applyingRef.current = false;
    savedRange.current = null;
    if (historyRef.current.length === 0) {
      historyRef.current = [incoming];
      historyIndexRef.current = 0;
    }
  }, [value, focused, plainMode, plainSlotUrls]);

  const emitPlain = useCallback(
    (text: string, urls: string[], pushHistory = true) => {
      const html = plainSlotsToBodyHtml(text);
      emitHtml(html, pushHistory);
      onPlainSlotUrlsChange?.(urls);
    },
    [emitHtml, onPlainSlotUrlsChange],
  );

  useEffect(() => {
    if (!plainMode) return;
    const slots = htmlToPlainSlots(value, plainUrlsRef.current);
    if (!plainFocusedRef.current || /<\/?[a-z][^>]*>/i.test(plainTextRef.current)) {
      setPlainText(slots.text);
    }
  }, [value, plainMode]);

  const repairIfLeaked = useCallback(() => {
    const el = editorRef.current;
    if (!el || applyingRef.current || !editorShowsLeakedHtml(el)) return;
    applyingRef.current = true;
    fillRichEditor(el, el.innerText || value);
    applyingRef.current = false;
  }, [value]);

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const t1 = window.setTimeout(repairIfLeaked, 40);
    const t2 = window.setTimeout(repairIfLeaked, 200);
    el.addEventListener("focus", repairIfLeaked);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      el.removeEventListener("focus", repairIfLeaked);
    };
  }, [repairIfLeaked, value]);

  // Keep last in-editor selection even when toolbar focus steals it (iOS/Android).
  useEffect(() => {
    const onSelChange = () => {
      const next = saveSelection(editorRef.current);
      if (next && !next.collapsed) savedRange.current = next;
    };
    document.addEventListener("selectionchange", onSelChange);
    return () => document.removeEventListener("selectionchange", onSelChange);
  }, []);

  const keepRange = () => {
    const next = saveSelection(editorRef.current);
    // Never wipe a good selection with an empty/outside one (toolbar taps).
    if (next) savedRange.current = next;
  };

  const removeImageSlot = (slot: HTMLElement) => {
    const id = slot.getAttribute("data-img-slot") || "이미지 칸";
    void confirmAction({
      message: `${id} 칸을 지울까요?`,
      danger: true,
      confirmLabel: "삭제",
    }).then((ok) => {
      if (!ok) return;
      slot.remove();
      if (slotAwaitRef.current && slotAwaitRef.current === id) {
        slotAwaitRef.current = null;
        setSlotAwait(null);
      }
      syncFromEditor();
    });
  };
  const removeImageWrap = (wrap: HTMLElement) => {
    const img = wrap.querySelector("img");
    const alt =
      img?.getAttribute("alt") ||
      img?.getAttribute("data-img-slot") ||
      "이미지";
    void confirmAction({
      message: `${alt} 이미지를 지울까요?`,
      danger: true,
      confirmLabel: "삭제",
    }).then((ok) => {
      if (!ok) return;
      wrap.remove();
      syncFromEditor();
    });
  };
  const selectImageWrap = (wrap: HTMLElement) => {
    const root = editorRef.current;
    if (!root) return;
    root.querySelectorAll(".rich-inline-img-wrap.is-selected").forEach((node) => {
      if (node !== wrap) node.classList.remove("is-selected");
    });
    wrap.classList.add("is-selected");
  };
  const clearImageSelection = () => {
    editorRef.current
      ?.querySelectorAll(".rich-inline-img-wrap.is-selected")
      .forEach((node) => node.classList.remove("is-selected"));
  };
  const handleEditorPointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (disabled) return;
    const target = event.target as HTMLElement | null;
    if (
      target?.closest?.(".rich-inline-img-wrap") ||
      target?.closest?.(".rich-inline-img-del") ||
      target?.closest?.(".rich-img-slot")
    ) {
      event.preventDefault();
    }
  };
  const handleEditorClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (disabled) return;
    const target = event.target as HTMLElement | null;
    const del = target?.closest?.(".rich-inline-img-del") as HTMLElement | null;
    if (del && editorRef.current?.contains(del)) {
      event.preventDefault();
      event.stopPropagation();
      const wrap = del.closest(".rich-inline-img-wrap") as HTMLElement | null;
      if (wrap?.classList.contains("is-selected")) removeImageWrap(wrap);
      else if (wrap) selectImageWrap(wrap);
      return;
    }
    const wrap = target?.closest?.(".rich-inline-img-wrap") as HTMLElement | null;
    if (wrap && editorRef.current?.contains(wrap)) {
      event.preventDefault();
      event.stopPropagation();
      selectImageWrap(wrap);
      return;
    }
    clearImageSelection();
    const slot = target?.closest?.(".rich-img-slot") as HTMLElement | null;
    if (!slot || slot.classList.contains("rich-inline-img-wrap")) return;
    event.preventDefault();
    event.stopPropagation();
    removeImageSlot(slot);
  };

  const runCommand = (command: string, arg?: string) => {
    const el = editorRef.current;
    if (!el || disabled) return;
    el.focus();
    restoreSelection(savedRange.current);
    try {
      document.execCommand("styleWithCSS", false, "true");
    } catch {
      /* ignore */
    }
    try {
      document.execCommand(command, false, arg);
    } catch {
      /* ignore */
    }
    syncFromEditor();
    keepRange();
  };

  const applyInlineStyle = (style: {
    color?: string;
    backgroundColor?: string;
    bold?: boolean;
    underline?: boolean;
  }) => {
    const el = editorRef.current;
    if (!el || disabled) return;
    el.focus();
    const live = saveSelection(el);
    const range =
      live && !live.collapsed
        ? live
        : rangeStillInEditor(el, savedRange.current)
          ? savedRange.current!.cloneRange()
          : null;
    if (!range || range.collapsed) return;
    restoreSelection(range);
    const next = wrapRangeWithStyle(el, range, style);
    if (next) {
      restoreSelection(next);
      savedRange.current = next.cloneRange();
    }
    syncFromEditor();
    keepRange();
  };

  const insertSymbol = (symbol: string) => {
    const el = editorRef.current;
    if (!el || disabled) return;
    el.focus();
    const live = saveSelection(el);
    const range =
      live ||
      (rangeStillInEditor(el, savedRange.current)
        ? savedRange.current!.cloneRange()
        : null);
    if (range) restoreSelection(range);
    try {
      document.execCommand("insertText", false, symbol);
    } catch {
      /* ignore */
    }
    syncFromEditor();
    keepRange();
  };

  const undo = () => {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    setCanUndo(historyIndexRef.current > 0);
    const html = historyRef.current[historyIndexRef.current] || "";
    const el = editorRef.current;
    if (!el) return;
    applyingRef.current = true;
    fillRichEditor(el, html);
    applyingRef.current = false;
    onChange(html);
  };

  const insertImageAtSlotOrCaret = async (files: File[]) => {
    if (!onUploadImages || files.length === 0) return;
    const urls = await onUploadImages(files);
    if (!urls.length) return;
    if (plainMode) {
      const added = applyPlainImages(
        plainTextRef.current,
        plainUrlsRef.current,
        urls,
      );
      setPlainText(added.text);
      emitPlain(added.text, added.urls, true);
      return;
    }
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    restoreSelection(savedRange.current);

    const slotId = slotAwaitRef.current;
    if (slotId) {
      const slot = el.querySelector(
        `.rich-img-slot[data-img-slot="${slotId}"]`,
      );
      if (slot) {
        const wrap = createInlineImage(urls[0], slotId, slotId);
        slot.replaceWith(wrap);
        let last: HTMLElement = wrap;
        for (let i = 1; i < urls.length; i += 1) {
          const extraId = nextSlotId(el.innerHTML);
          const extra = createInlineImage(urls[i], extraId, extraId);
          last.after(extra);
          last = extra;
        }
        slotAwaitRef.current = null;
        setSlotAwait(null);
        syncFromEditor();
        return;
      }
    }

    restoreSelection(savedRange.current);
    for (const url of urls) {
      const id = nextSlotId(el.innerHTML);
      const wrap = createInlineImage(url, id, id);
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(wrap);
        range.setStartAfter(wrap);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      } else {
        el.appendChild(wrap);
      }
    }
    syncFromEditor();
  };

  const insertEmptySlot = () => {
    if (plainMode) {
      const added = applyPlainImages(
        plainTextRef.current,
        plainUrlsRef.current,
        [],
      );
      const slot = added.urls.length + 1;
      const next = `${plainTextRef.current.replace(/\s*$/, "")}\n\n[S${slot}]\n\n`;
      const urls = [...plainUrlsRef.current.slice(0, slot - 1), ""];
      setPlainText(next);
      emitPlain(next, urls, true);
      return;
    }
    const el = editorRef.current;
    if (!el || disabled) return;
    el.focus();
    restoreSelection(savedRange.current);
    const id = nextSlotId(el.innerHTML);
    const slot = document.createElement("span");
    slot.setAttribute("data-img-slot", id);
    slot.setAttribute("contenteditable", "false");
    slot.className = "rich-img-slot";
    slot.textContent = `${id} 이미지`;
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(slot);
      const after = document.createTextNode(" ");
      slot.after(after);
      range.setStartAfter(after);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      el.appendChild(slot);
    }
    slotAwaitRef.current = id;
    setSlotAwait(id);
    syncFromEditor();
    const liveId = slot.getAttribute("data-img-slot") || id;
    slotAwaitRef.current = liveId;
    setSlotAwait(liveId);
    keepRange();
  };

  /** Sentence-end S / s → image slot */
  const handleInput = () => {
    const el = editorRef.current;
    if (!el) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      syncFromEditor();
      return;
    }
    const range = sel.getRangeAt(0);
    if (!range.collapsed) {
      syncFromEditor();
      return;
    }
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) {
      syncFromEditor();
      return;
    }
    const text = node.textContent || "";
    const offset = range.startOffset;
    if (offset < 1) {
      syncFromEditor();
      return;
    }
    const ch = text[offset - 1];
    if (ch !== "S" && ch !== "s") {
      syncFromEditor();
      return;
    }
    const before = text.slice(0, offset - 1);
    const after = text.slice(offset);
    const prev = before.slice(-1);
    const atSentenceEnd =
      before.length === 0 ||
      /[\s.。！？!?…」』”"）\]]/.test(prev) ||
      /[가-힣a-zA-Z0-9]$/.test(before);

    if (!atSentenceEnd) {
      syncFromEditor();
      return;
    }

    // Prefer end-of-clause: trigger when previous char is punctuation/space OR Hangul/word end
    // and we're not mid-word English (except lone S/s)
    if (/[a-zA-Z]/.test(prev) && (ch === "S" || ch === "s")) {
      syncFromEditor();
      return;
    }

    node.textContent = before + after;
    const id = nextSlotId(el.innerHTML);
    const slot = document.createElement("span");
    slot.setAttribute("data-img-slot", id);
    slot.setAttribute("contenteditable", "false");
    slot.className = "rich-img-slot";
    slot.textContent = `${id} 이미지`;

    const insertRange = document.createRange();
    insertRange.setStart(node, before.length);
    insertRange.collapse(true);
    insertRange.insertNode(slot);
    const spacer = document.createTextNode(after ? "" : " ");
    slot.after(spacer);
    const caret = document.createRange();
    caret.setStartAfter(spacer);
    caret.collapse(true);
    sel.removeAllRanges();
    sel.addRange(caret);

    slotAwaitRef.current = id;
    setSlotAwait(id);
    syncFromEditor();
    const liveId = slot.getAttribute("data-img-slot") || id;
    slotAwaitRef.current = liveId;
    setSlotAwait(liveId);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const data = e.clipboardData;
    if (!data) return;

    const text = plainTextFromClipboard(data);
    const imageFiles = Array.from(data.items || [])
      .filter((item) => item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((f): f is File => Boolean(f));

    // 글이 있으면 글 우선 (이미지+텍스트가 같이 오는 Word/웹 복사 대응)
    if (text) {
      e.preventDefault();
      e.stopPropagation();
      const el = e.currentTarget;
      if (onPastePlain?.(text)) {
        skipBlurSyncRef.current = true;
        el.blur();
        return;
      }
      insertPlainTextAtCaret(el, text, savedRange.current);
      syncFromEditor();
      keepRange();
      return;
    }

    if (imageFiles.length > 0) {
      e.preventDefault();
      e.stopPropagation();
      void insertImageAtSlotOrCaret(imageFiles);
    }
  };

  const empty = !htmlToPlainText(value) && !looksLikeEmptyWithSlots(value);
  const imagesOnly = toolbarMode === "images";

  return (
    <div className={`min-w-0 space-y-2 ${className}`}>
      {hideHelp && imagesOnly ? (
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-ink-200 bg-ink-50 px-2 py-2">
        <button
          type="button"
          disabled={disabled}
          title="이미지 칸 추가"
          onPointerDown={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            keepRange();
            insertEmptySlot();
          }}
          className="touch-btn flex h-9 w-9 items-center justify-center rounded-lg border border-ink-200 bg-white text-lg font-semibold text-ink-600 disabled:opacity-50"
        >
          +
        </button>
        <button
          type="button"
          disabled={disabled || !onUploadImages}
          title="이미지 파일"
          onPointerDown={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            keepRange();
            fileRef.current?.click();
          }}
          className="touch-btn rounded-lg border border-sky-600 bg-sky-600 px-2.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          이미지
        </button>
      </div>
      ) : (
      <div
        className={`flex flex-wrap items-center gap-1.5 rounded-xl border px-2 py-2 ${
          imagesOnly
            ? "border-ink-200 bg-ink-50"
            : "border-stone-200 bg-stone-100/90"
        }`}
      >
        <button
          type="button"
          disabled={disabled}
          title="이미지 칸 추가"
          onPointerDown={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            keepRange();
            insertEmptySlot();
          }}
          className="touch-btn flex h-9 w-9 items-center justify-center rounded-lg border border-ink-200 bg-white text-lg font-semibold text-ink-600 disabled:opacity-50"
        >
          +
        </button>
        {!imagesOnly ? (
          <button
            type="button"
            disabled={disabled || !canUndo}
            title="되돌리기"
            onPointerDown={(e) => e.preventDefault()}
            onMouseDown={(e) => e.preventDefault()}
            onClick={undo}
            className="touch-btn rounded-lg border border-stone-300 bg-white px-2.5 text-xs font-semibold text-stone-700 disabled:opacity-40"
          >
            되돌리기
          </button>
        ) : null}
        {!imagesOnly ? (
          <>
            <button
              type="button"
              disabled={disabled}
              title="굵게"
              aria-label="굵게"
              onPointerDown={(e) => e.preventDefault()}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applyInlineStyle({ bold: true })}
              className="touch-btn flex h-9 w-9 items-center justify-center rounded-lg border border-stone-300 bg-white text-sm font-bold text-stone-800 disabled:opacity-50"
            >
              B
            </button>
            <button
              type="button"
              disabled={disabled}
              title="밑줄"
              aria-label="밑줄"
              onPointerDown={(e) => e.preventDefault()}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applyInlineStyle({ underline: true })}
              className="touch-btn flex h-9 w-9 items-center justify-center rounded-lg border border-stone-300 bg-white text-sm font-semibold text-stone-800 underline disabled:opacity-50"
            >
              U
            </button>
            <button
              type="button"
              disabled={disabled}
              title="● 넣기"
              aria-label="검은 동그라미 넣기"
              onPointerDown={(e) => e.preventDefault()}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insertSymbol("●")}
              className="touch-btn flex h-9 w-9 items-center justify-center rounded-lg border border-stone-300 bg-white text-sm font-semibold text-stone-800 disabled:opacity-50"
            >
              ●
            </button>
            <button
              type="button"
              disabled={disabled}
              title="√ 넣기"
              aria-label="체크 넣기"
              onPointerDown={(e) => e.preventDefault()}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insertSymbol("√")}
              className="touch-btn flex h-9 w-9 items-center justify-center rounded-lg border border-stone-300 bg-white text-sm font-semibold text-stone-800 disabled:opacity-50"
            >
              √
            </button>

            <span className="ml-1 text-[11px] font-medium text-slate-500">
              글자
            </span>
            {TEXT_COLORS.map((color) => (
              <button
                key={color.id}
                type="button"
                disabled={disabled}
                title={color.label}
                aria-label={color.label}
                onPointerDown={(e) => e.preventDefault()}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applyInlineStyle({ color: color.value })}
                className="touch-btn h-8 w-8 rounded-lg border border-stone-300 shadow-sm disabled:opacity-50"
                style={{ backgroundColor: color.value }}
              />
            ))}

            <span className="ml-1 text-[11px] font-medium text-slate-500">
              형광
            </span>
            {HIGHLIGHT_COLORS.map((color) => (
              <button
                key={color.id}
                type="button"
                disabled={disabled}
                title={color.label}
                aria-label={color.label}
                onPointerDown={(e) => e.preventDefault()}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() =>
                  applyInlineStyle({ backgroundColor: color.value })
                }
                className="touch-btn h-8 w-8 rounded-lg border border-stone-300 shadow-sm disabled:opacity-50"
                style={{ backgroundColor: color.value }}
              />
            ))}
          </>
        ) : (
          hideHelp ? null : (
          <span className="text-[11px] text-ink-500">
            이미지 칸 · 서식은 위 툴바
          </span>
          )
        )}

        {hideHelp ? null : (
        <button
          type="button"
          disabled={disabled || !onUploadImages}
          title="이미지 파일"
          onPointerDown={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            keepRange();
            fileRef.current?.click();
          }}
          className="touch-btn ml-auto rounded-lg border border-sky-600 bg-sky-600 px-2.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          이미지
        </button>
        )}
      </div>
      )}
      <input
        ref={fileRef}
        id={`${uid}-img`}
        type="file"
        accept="image/*,.heic,.heif,.jpeg,.jpg,.png,.webp"
        multiple
        className="sr-only"
        onChange={(e) => {
          const files = e.target.files ? Array.from(e.target.files) : [];
          e.target.value = "";
          void insertImageAtSlotOrCaret(files);
        }}
      />

      {plainMode ? (
      <textarea
        ref={plainAreaRef}
        className={`rich-editor w-full resize-y rounded-xl border border-ink-200 bg-white px-3 py-3 text-[15px] leading-relaxed outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 md:text-sm ${minHeightClass}`}
        data-section-idx={
          typeof sectionIdx === "number" ? String(sectionIdx) : undefined
        }
        data-plain-body="1"
        disabled={disabled}
        placeholder={placeholder}
        value={
          /<\/?[a-z][^>]*>/i.test(plainText)
            ? htmlToPlainSlots(plainText).text
            : plainText
        }
        onFocus={() => {
          plainFocusedRef.current = true;
          setFocused(true);
        }}
        onBlur={() => {
          plainFocusedRef.current = false;
          setFocused(false);
          emitPlain(plainTextRef.current, plainUrlsRef.current, true);
        }}
        onPaste={(e) => {
          const text = e.clipboardData?.getData("text/plain") || "";
          if (text) return;
          const imageFiles = Array.from(e.clipboardData?.items || [])
            .filter((item) => item.type.startsWith("image/"))
            .map((item) => item.getAsFile())
            .filter((f): f is File => Boolean(f));
          if (imageFiles.length > 0) {
            e.preventDefault();
            void insertImageAtSlotOrCaret(imageFiles);
          }
        }}
        onChange={(e) => {
          const cursor = e.target.selectionStart ?? e.target.value.length;
          const inserted = insertPlainSAtCursor(e.target.value, cursor);
          if (inserted) {
            setPlainText(inserted.text);
            const urls = [...plainUrlsRef.current];
            while (urls.length < inserted.slot) urls.push("");
            emitPlain(inserted.text, urls, true);
            const el = e.target;
            requestAnimationFrame(() => {
              el.setSelectionRange(inserted.cursor, inserted.cursor);
            });
            return;
          }
          const next = e.target.value;
          setPlainText(next);
          emitPlain(next, plainUrlsRef.current, true);
        }}
      />
      ) : (
      <div
        ref={editorRef}
        role="textbox"
        aria-multiline="true"
        aria-placeholder={placeholder}
        contentEditable={!disabled}
        suppressContentEditableWarning
        data-placeholder={placeholder}
        data-section-idx={
          typeof sectionIdx === "number" ? String(sectionIdx) : undefined
        }
        onFocus={() => {
          setFocused(true);
          repairIfLeaked();
        }}
        onBlur={() => {
          setFocused(false);
          if (skipBlurSyncRef.current) {
            skipBlurSyncRef.current = false;
            return;
          }
          syncFromEditor();
        }}
        onKeyUp={keepRange}
        onMouseUp={keepRange}
        onInput={handleInput}
        onPaste={handlePaste}
        onPointerDownCapture={handleEditorPointerDown}
        onClickCapture={handleEditorClick}
        className={`rich-editor w-full rounded-xl border border-ink-200 bg-white px-3 py-3 text-[15px] leading-relaxed outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 md:text-sm ${minHeightClass} ${
          empty ? "is-empty" : ""
        }`}
      />
      )}

      {plainMode ? (
      <p className="text-[11px] text-ink-500">
        문장 끝에 <b>S</b> / <b>s</b> 입력 → 본문에 [S1] [S2]…
        순서로 칸이 생깁니다. 「이미지」또는 붙여넣기로 넣습니다.
      </p>
      ) : hideHelp ? null : (
      <p className="text-[11px] text-ink-500">
        문장 끝에 <b>S</b> / <b>s</b> 입력 → 이미지 칸(S1…) 생성 후
        붙여넣기 또는 「이미지」. 그림은 눌러 선택한 뒤 <b>삭제</b>.
        {imagesOnly ? (
          <>
            {" "}
            글자 서식(굵게·색·크기·①⑩)은 <b>위 서식 툴바</b>를 사용하세요.
          </>
        ) : (
          <>
            {" "}
            <b>글자를 선택한 뒤</b> 굵게·밑줄·글자색·형광. ● · √ 는 커서 위치에
            넣습니다.
          </>
        )}
        {slotAwait ? (
          <span className="ml-1 font-semibold text-[#c45c26]">
            {slotAwait}에 이미지를 붙여넣으세요.
          </span>
        ) : null}
      </p>
      )}
    </div>
  );
}

function looksLikeEmptyWithSlots(html: string) {
  return /data-img-slot|rich-inline-img|<img/i.test(html);
}

/** Read-only rich caption (or FactCheck fallback for plain). */
export function RichCaptionView({
  html,
  className = "",
}: {
  html: string;
  className?: string;
}) {
  const cleaned = plainToHtml(html);
  if (!cleaned) {
    return <p className={className}>(텍스트 없음)</p>;
  }
  return (
    <div
      className={`rich-editor rich-view whitespace-pre-wrap text-[15px] leading-relaxed text-stone-800 md:text-base ${className}`}
      dangerouslySetInnerHTML={{ __html: cleaned }}
    />
  );
}
