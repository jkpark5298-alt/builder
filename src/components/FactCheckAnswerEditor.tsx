"use client";

import { useEffect, useRef } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import { Bold, Strikethrough, Underline as UnderlineIcon, Undo2 } from "lucide-react";
import {
  HIGHLIGHT_COLORS,
  TEXT_COLORS,
} from "@/lib/report-editor-utils";
import {
  htmlToPlainText,
  toAnswerEditorHtml,
} from "@/lib/text-format";
import {
  sanitizePastedHtml,
  wrapPlainPasteText,
} from "@/lib/report-editor-format";

export function FactCheckAnswerEditor({
  value,
  onChange,
  onBlur,
  disabled,
  placeholder,
}: {
  value: string;
  onChange: (html: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const onChangeRef = useRef(onChange);
  const onBlurRef = useRef(onBlur);
  const lastEmitted = useRef(toAnswerEditorHtml(value));
  onChangeRef.current = onChange;
  onBlurRef.current = onBlur;

  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        code: false,
        blockquote: false,
        horizontalRule: false,
      }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      // Underline은 StarterKit에 포함 (별도 등록 시 duplicate)
    ],
    content: toAnswerEditorHtml(value),
    editorProps: {
      attributes: {
        class:
          "fc-answer-editor min-h-[10rem] w-full max-w-full overflow-x-hidden rounded-xl border border-ink-200 bg-white px-3 py-3 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 leading-relaxed",
        "data-placeholder": placeholder || "",
      },
      handlePaste: (_view, event) => {
        const ed = editorRef.current;
        if (!ed) return false;
        const clipboard = event.clipboardData;
        if (!clipboard) return false;
        const rawHtml = clipboard.getData("text/html");
        const text = clipboard.getData("text/plain");
        if (rawHtml?.trim()) {
          event.preventDefault();
          const clean = sanitizePastedHtml(rawHtml);
          ed.commands.insertContent(clean || wrapPlainPasteText(text || ""));
          return true;
        }
        if (text) {
          event.preventDefault();
          ed.commands.insertContent(wrapPlainPasteText(text));
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      const html = ed.getHTML();
      lastEmitted.current = html;
      onChangeRef.current(html);
    },
    onBlur: () => {
      onBlurRef.current?.();
    },
  });

  const editorRef = useRef<Editor | null>(null);
  editorRef.current = editor;

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [editor, disabled]);

  useEffect(() => {
    if (!editor) return;
    const next = toAnswerEditorHtml(value);
    if (next === lastEmitted.current) return;
    if (htmlToPlainText(next) === htmlToPlainText(editor.getHTML())) return;
    lastEmitted.current = next;
    editor.commands.setContent(next, { emitUpdate: false });
  }, [editor, value]);

  const keep = (e: React.MouseEvent) => {
    e.preventDefault();
  };

  if (!editor) {
    return (
      <div className="min-h-[10rem] rounded-xl border border-ink-200 bg-ink-50 animate-pulse" />
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5 items-center rounded-xl border border-ink-200 bg-ink-50 p-2">
        <button
          type="button"
          title="되돌리기 (Ctrl+Z)"
          disabled={!editor.can().undo()}
          onMouseDown={keep}
          onClick={() => editor.chain().focus().undo().run()}
          className="inline-flex items-center gap-1 min-h-8 rounded-lg border border-ink-200 bg-white px-2 text-ink-700 hover:border-accent disabled:opacity-40"
        >
          <Undo2 className="h-4 w-4" />
          <span className="text-xs">되돌리기</span>
        </button>
        <span className="w-px h-6 bg-ink-200 mx-0.5" aria-hidden />
        <button
          type="button"
          title="굵게"
          onMouseDown={keep}
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={`inline-flex items-center justify-center min-h-8 min-w-8 rounded-lg border px-2 ${
            editor.isActive("bold")
              ? "border-accent bg-accent-muted text-ink-900"
              : "border-ink-200 bg-white text-ink-700"
          }`}
        >
          <Bold className="h-4 w-4" />
        </button>
        <button
          type="button"
          title="밑줄"
          onMouseDown={keep}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          className={`inline-flex items-center justify-center min-h-8 min-w-8 rounded-lg border px-2 ${
            editor.isActive("underline")
              ? "border-accent bg-accent-muted text-ink-900"
              : "border-ink-200 bg-white text-ink-700"
          }`}
        >
          <UnderlineIcon className="h-4 w-4" />
        </button>
        <button
          type="button"
          title="줄긋기"
          onMouseDown={keep}
          onClick={() => editor.chain().focus().toggleStrike().run()}
          className={`inline-flex items-center justify-center min-h-8 min-w-8 rounded-lg border px-2 ${
            editor.isActive("strike")
              ? "border-accent bg-accent-muted text-ink-900"
              : "border-ink-200 bg-white text-ink-700"
          }`}
        >
          <Strikethrough className="h-4 w-4" />
        </button>
        <span className="text-xs text-ink-400 px-1">글자</span>
        {TEXT_COLORS.map((c) => (
          <button
            key={c.id}
            type="button"
            title={c.label}
            onMouseDown={keep}
            onClick={() => editor.chain().focus().setColor(c.color).run()}
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
            onMouseDown={keep}
            onClick={() =>
              editor.chain().focus().toggleHighlight({ color: c.bg }).run()
            }
            className="h-8 w-8 rounded-lg border border-ink-200"
            style={{ background: c.bg }}
          />
        ))}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}

export function answerPlainLength(htmlOrText: string): number {
  return htmlToPlainText(htmlOrText).trim().length;
}
