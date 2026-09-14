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
  htmlToPlainText,
  nextSlotId,
  plainToHtml,
  sanitizeRichHtml,
  wrapRangeWithStyle,
} from "@/lib/rich-text";
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

export function RichTextEditor({
  value,
  onChange,
  placeholder = "텍스트를 입력하세요",
  className = "",
  minHeightClass = "min-h-[10rem]",
  disabled = false,
  onUploadImages,
}: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const savedRange = useRef<Range | null>(null);
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const applyingRef = useRef(false);
  const slotAwaitRef = useRef<string | null>(null);
  const [slotAwait, setSlotAwait] = useState<string | null>(null);
  const [inlineImages, setInlineImages] = useState<
    { src: string; alt: string }[]
  >([]);
  const [focused, setFocused] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const uid = useId();

  const refreshInlineImages = useCallback(() => {
    const el = editorRef.current;
    if (!el) {
      setInlineImages([]);
      return;
    }
    setInlineImages(
      Array.from(el.querySelectorAll("img.rich-inline-img")).map((img) => ({
        src: img.getAttribute("src") || "",
        alt: img.getAttribute("alt") || "이미지",
      })),
    );
  }, []);

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
    emitHtml(el.innerHTML, true);
    refreshInlineImages();
  }, [emitHtml, refreshInlineImages]);

  useLayoutEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const incoming = plainToHtml(value);
    const current = sanitizeRichHtml(el.innerHTML);
    if (incoming === current) return;
    if (document.activeElement === el && focused) return;
    applyingRef.current = true;
    el.innerHTML = incoming || "";
    applyingRef.current = false;
    savedRange.current = null;
    if (historyRef.current.length === 0) {
      historyRef.current = [incoming];
      historyIndexRef.current = 0;
    }
    refreshInlineImages();
  }, [value, focused, refreshInlineImages]);

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
  const handleEditorPointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (disabled) return;
    const target = event.target as HTMLElement | null;
    if (
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
      if (wrap) removeImageWrap(wrap);
      return;
    }
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
    el.innerHTML = html;
    applyingRef.current = false;
    onChange(html);
    refreshInlineImages();
  };

  const insertImageAtSlotOrCaret = async (files: File[]) => {
    if (!onUploadImages || files.length === 0) return;
    const urls = await onUploadImages(files);
    if (!urls.length) return;
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
          const extra = createInlineImage(
            urls[i],
            `S${slotId.replace(/\D/g, "") || "1"}-${i + 1}`,
          );
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
      const wrap = createInlineImage(url, "이미지");
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
    keepRange();
  };

  /** Sentence-end S / s / ㄴ → image slot */
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
    if (ch !== "S" && ch !== "s" && ch !== "ㄴ") {
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
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageFiles = items
      .filter((item) => item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((f): f is File => Boolean(f));
    if (imageFiles.length > 0) {
      e.preventDefault();
      void insertImageAtSlotOrCaret(imageFiles);
      return;
    }
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    restoreSelection(savedRange.current);
    try {
      document.execCommand("insertText", false, text);
    } catch {
      /* ignore */
    }
    syncFromEditor();
  };

  const empty = !htmlToPlainText(value) && !looksLikeEmptyWithSlots(value);

  return (
    <div className={`min-w-0 space-y-2 ${className}`}>
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-stone-200 bg-stone-100/90 px-2 py-2">
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
          className="touch-btn flex h-9 w-9 items-center justify-center rounded-lg border border-stone-300 bg-white text-lg font-semibold text-stone-600 disabled:opacity-50"
        >
          +
        </button>
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

        <span className="ml-1 text-[11px] font-medium text-slate-500">글자</span>
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

        <span className="ml-1 text-[11px] font-medium text-slate-500">형광</span>
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
      </div>

      <div
        ref={editorRef}
        role="textbox"
        aria-multiline="true"
        aria-placeholder={placeholder}
        contentEditable={!disabled}
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          syncFromEditor();
        }}
        onKeyUp={keepRange}
        onMouseUp={keepRange}
        onInput={handleInput}
        onPaste={handlePaste}
        onPointerDownCapture={handleEditorPointerDown}
        onClickCapture={handleEditorClick}
        className={`rich-editor w-full rounded-xl border border-stone-300 bg-[#fcfbf9] px-3 py-3 text-[15px] leading-relaxed outline-none focus:border-stone-500 md:text-sm ${minHeightClass} ${
          empty ? "is-empty" : ""
        }`}
      />

      {inlineImages.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {inlineImages.map((img, index) => (
            <button
              key={`${img.alt}-${index}`}
              type="button"
              disabled={disabled}
              onClick={() => {
                const node =
                  editorRef.current?.querySelectorAll("img.rich-inline-img")[
                    index
                  ];
                const wrap = node?.closest(".rich-inline-img-wrap");
                if (wrap instanceof HTMLElement) removeImageWrap(wrap);
              }}
              className="touch-btn inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-800 disabled:opacity-50"
            >
              {img.alt} 삭제
              <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
      ) : null}

      <p className="text-[11px] text-stone-500">
        문장 끝에 <b>S</b> / <b>s</b> / <b>ㄴ</b> 입력 → 이미지 칸(S1…) 생성 후
        붙여넣기 또는 「이미지」. 빈 칸·붙여넣은 이미지는 오른쪽 <b>×</b>로
        삭제.{" "}
        <b>글자를 선택한 뒤</b> 굵게·밑줄·글자색·형광. ● · √ 는 커서 위치에 넣습니다.
        {slotAwait ? (
          <span className="ml-1 font-semibold text-[#c45c26]">
            {slotAwait}에 이미지를 붙여넣으세요.
          </span>
        ) : null}
      </p>
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
