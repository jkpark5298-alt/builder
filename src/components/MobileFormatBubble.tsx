"use client";

import { useEffect, useState } from "react";
import { Bold, Minus, Plus, Underline } from "lucide-react";
import { HIGHLIGHT_COLORS, TEXT_COLORS } from "@/lib/report-editor-utils";

const CIRCLED_NUMBERS = [
  "①",
  "②",
  "③",
  "④",
  "⑤",
  "⑥",
  "⑦",
  "⑧",
  "⑨",
  "⑩",
] as const;

type Pos = { top: number; left: number };

function selectionAnchorRect(): DOMRect | null {
  const sel = window.getSelection();
  if (!sel?.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const node =
    range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? (range.commonAncestorContainer as Element)
      : range.commonAncestorContainer.parentElement;
  if (
    !node?.closest?.(
      ".ProseMirror.report-body, .report-body.ProseMirror, .ProseMirror"
    )
  ) {
    return null;
  }
  const rects = range.getClientRects();
  if (rects.length) {
    return rects[rects.length - 1]!;
  }
  const r = range.getBoundingClientRect();
  if (r.width === 0 && r.height === 0 && r.top === 0 && r.left === 0) {
    return null;
  }
  return r;
}

/**
 * 아이폰 등: 커서/선택 바로 위에 붙는 글자 서식 바.
 */
export function MobileFormatBubble({
  active,
  onBold,
  onUnderline,
  onFontSizeStep,
  onInsertChar,
  onColor,
  onHighlight,
}: {
  active: boolean;
  onBold: () => void;
  onUnderline: () => void;
  onFontSizeStep: (delta: number) => void;
  onInsertChar: (ch: string) => void;
  onColor: (c: string) => void;
  onHighlight: (c: string) => void;
}) {
  const [pos, setPos] = useState<Pos | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!active) {
      setVisible(false);
      setPos(null);
      return;
    }

    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const rect = selectionAnchorRect();
        if (!rect) {
          setVisible(false);
          return;
        }
        const barW = Math.min(360, window.innerWidth - 16);
        const barH = 44;
        const gap = 8;
        let top = rect.top - barH - gap;
        const vv = window.visualViewport;
        const viewTop = vv?.offsetTop ?? 0;
        const viewBottom = viewTop + (vv?.height ?? window.innerHeight);
        if (top < viewTop + 8) {
          top = rect.bottom + gap;
        }
        if (top + barH > viewBottom - 8) {
          top = Math.max(viewTop + 8, viewBottom - barH - 8);
        }
        let left = rect.left + rect.width / 2 - barW / 2;
        left = Math.max(8, Math.min(left, window.innerWidth - barW - 8));
        setPos({ top, left });
        setVisible(true);
      });
    };

    update();
    document.addEventListener("selectionchange", update);
    window.addEventListener("scroll", update, true);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("selectionchange", update);
      window.removeEventListener("scroll", update, true);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    };
  }, [active]);

  if (!active || !visible || !pos) return null;

  const keep = (e: React.MouseEvent) => {
    e.preventDefault();
  };

  const barW = Math.min(360, window.innerWidth - 16);

  return (
    <div
      className="md:hidden fixed z-[80] print:hidden"
      style={{ top: pos.top, left: pos.left, width: barW }}
      onMouseDown={keep}
    >
      <div className="flex items-center gap-1 overflow-x-auto rounded-xl border border-ink-200 bg-white/95 px-1.5 py-1 shadow-lg backdrop-blur-md">
        <BubbleBtn onClick={onBold} title="굵게" onMouseDown={keep}>
          <Bold className="h-4 w-4" />
        </BubbleBtn>
        <BubbleBtn onClick={onUnderline} title="밑줄" onMouseDown={keep}>
          <Underline className="h-4 w-4" />
        </BubbleBtn>
        <BubbleBtn
          onClick={() => onFontSizeStep(-1)}
          title="글자 작게"
          onMouseDown={keep}
        >
          <Minus className="h-4 w-4" />
        </BubbleBtn>
        <BubbleBtn
          onClick={() => onFontSizeStep(1)}
          title="글자 크게"
          onMouseDown={keep}
        >
          <Plus className="h-4 w-4" />
        </BubbleBtn>
        <span className="w-px h-5 bg-ink-200 shrink-0" aria-hidden />
        <div className="flex items-center gap-0.5 shrink-0">
          {CIRCLED_NUMBERS.map((ch) => (
            <button
              key={ch}
              type="button"
              title={`${ch} 삽입`}
              onMouseDown={keep}
              onClick={() => onInsertChar(ch)}
              className="min-h-8 min-w-7 rounded-md px-0.5 text-[13px] font-medium text-ink-800 hover:bg-accent-muted"
            >
              {ch}
            </button>
          ))}
        </div>
        <span className="w-px h-5 bg-ink-200 shrink-0" aria-hidden />
        {TEXT_COLORS.map((c) => (
          <button
            key={c.id}
            type="button"
            title={c.label}
            onMouseDown={keep}
            onClick={() => onColor(c.color)}
            className="h-7 w-7 shrink-0 rounded-full border border-ink-200"
            style={{ background: c.color }}
          />
        ))}
        <span className="w-px h-5 bg-ink-200 shrink-0" aria-hidden />
        {HIGHLIGHT_COLORS.map((c) => (
          <button
            key={`hl-${c.id}`}
            type="button"
            title={`${c.label} 형광`}
            onMouseDown={keep}
            onClick={() => onHighlight(c.bg)}
            className="h-7 w-7 shrink-0 rounded-md border border-ink-200"
            style={{ background: c.bg }}
          />
        ))}
      </div>
    </div>
  );
}

function BubbleBtn({
  children,
  onClick,
  title,
  onMouseDown,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  onMouseDown?: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={onMouseDown}
      onClick={onClick}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-700 hover:bg-accent-muted"
    >
      {children}
    </button>
  );
}
