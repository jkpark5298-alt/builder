"use client";

import type { ReactNode } from "react";
import {
  Bold,
  ClipboardPaste,
  ImagePlus,
  Minus,
  PenLine,
  Plus,
  Redo2,
  Type,
  Underline,
  Undo2,
} from "lucide-react";
import {
  FONT_SIZES,
  HIGHLIGHT_COLORS,
  TEXT_COLORS,
} from "@/lib/report-editor-utils";

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

export function FormatToolbar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onFontSize,
  onFontSizeStep,
  onBold,
  onUnderline,
  onColor,
  onHighlight,
  onInsertChar,
  onImage,
  onPasteImage,
  onTextImage,
  onHandwriting,
  onBeforeFontSizeSelect,
}: {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onFontSize: (px: number) => void;
  onFontSizeStep: (delta: number) => void;
  onBold: () => void;
  onUnderline: () => void;
  onColor: (c: string) => void;
  onHighlight: (c: string) => void;
  onInsertChar: (ch: string) => void;
  onImage: () => void;
  onPasteImage: () => void;
  onTextImage: () => void;
  onHandwriting: () => void;
  onBeforeFontSizeSelect?: () => void;
}) {
  const keepSelection = (e: React.MouseEvent) => {
    e.preventDefault();
  };

  return (
    <div className="flex flex-wrap gap-1.5 items-center rounded-xl border border-ink-200 bg-ink-50 p-2 print:hidden">
      <ToolBtn
        onClick={onUndo}
        title="되돌리기 (Ctrl+Z)"
        disabled={!canUndo}
      >
        <Undo2 className="h-4 w-4" />
        <span className="text-xs">되돌리기</span>
      </ToolBtn>
      <ToolBtn
        onClick={onRedo}
        title="다시 실행 (Ctrl+Y)"
        disabled={!canRedo}
      >
        <Redo2 className="h-4 w-4" />
        <span className="text-xs">다시 실행</span>
      </ToolBtn>
      <span className="w-px h-6 bg-ink-200 mx-0.5" aria-hidden />
      <ToolBtn onClick={onBold} title="굵게" onMouseDown={keepSelection}>
        <Bold className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn onClick={onUnderline} title="밑줄" onMouseDown={keepSelection}>
        <Underline className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn
        onClick={() => onFontSizeStep(-1)}
        title="글자 작게"
        onMouseDown={keepSelection}
      >
        <Minus className="h-4 w-4" />
      </ToolBtn>
      <div className="inline-flex flex-wrap items-center gap-0.5 rounded-lg border border-ink-200 bg-white px-1 py-0.5">
        <span className="text-[10px] text-ink-400 px-1">크기</span>
        {FONT_SIZES.map((size) => (
          <button
            key={size}
            type="button"
            title={`${size}px`}
            onMouseDown={(e) => {
              e.preventDefault();
              onBeforeFontSizeSelect?.();
            }}
            onClick={() => onFontSize(size)}
            className="min-h-7 min-w-7 rounded-md px-1.5 text-[11px] font-medium text-ink-700 hover:bg-accent-muted hover:text-ink-900"
          >
            {size}
          </button>
        ))}
      </div>
      <ToolBtn
        onClick={() => onFontSizeStep(1)}
        title="글자 크게"
        onMouseDown={keepSelection}
      >
        <Plus className="h-4 w-4" />
      </ToolBtn>
      <span className="text-xs text-ink-400 px-1">글자</span>
      {TEXT_COLORS.map((c) => (
        <button
          key={c.id}
          type="button"
          title={c.label}
          onMouseDown={keepSelection}
          onClick={() => onColor(c.color)}
          className={`h-8 w-8 rounded-lg border shadow-sm ${
            c.id === "black" ? "border-ink-300" : "border-ink-200"
          }`}
          style={{ background: c.color }}
        />
      ))}
      <span className="text-xs text-ink-400 px-1">형광</span>
      {HIGHLIGHT_COLORS.map((c) => (
        <button
          key={`hl-${c.id}`}
          type="button"
          title={`${c.label} 형광`}
          onMouseDown={keepSelection}
          onClick={() => onHighlight(c.bg)}
          className="h-8 w-8 rounded-lg border border-ink-200"
          style={{ background: c.bg }}
        />
      ))}
      <div className="inline-flex flex-wrap items-center gap-0.5 rounded-lg border border-ink-200 bg-white px-1 py-0.5">
        <span className="text-[10px] text-ink-400 px-1">번호</span>
        {CIRCLED_NUMBERS.map((ch) => (
          <button
            key={ch}
            type="button"
            title={`${ch} 삽입`}
            onMouseDown={keepSelection}
            onClick={() => onInsertChar(ch)}
            className="min-h-7 min-w-7 rounded-md px-1 text-[13px] font-medium text-ink-800 hover:bg-accent-muted"
          >
            {ch}
          </button>
        ))}
      </div>
      <ToolBtn onClick={onImage} title="이미지 추가">
        <ImagePlus className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn onClick={onPasteImage} title="클립보드에서 붙여넣기 (아이폰)">
        <ClipboardPaste className="h-4 w-4" />
        <span className="text-xs">붙여넣기</span>
      </ToolBtn>
      <ToolBtn onClick={onTextImage} title="텍스트를 이미지로">
        <Type className="h-4 w-4" />
        <span className="text-xs">텍스트→이미지</span>
      </ToolBtn>
      <ToolBtn onClick={onHandwriting} title="손글씨">
        <PenLine className="h-4 w-4" />
        <span className="text-xs">손글씨</span>
      </ToolBtn>
    </div>
  );
}

function ToolBtn({
  children,
  onClick,
  title,
  disabled,
  onMouseDown,
}: {
  children: ReactNode;
  onClick: () => void;
  title: string;
  disabled?: boolean;
  onMouseDown?: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      onMouseDown={onMouseDown}
      disabled={disabled}
      className="inline-flex items-center gap-1 min-h-8 rounded-lg border border-ink-200 bg-white px-2 text-ink-700 hover:border-accent disabled:opacity-40 disabled:pointer-events-none"
    >
      {children}
    </button>
  );
}

