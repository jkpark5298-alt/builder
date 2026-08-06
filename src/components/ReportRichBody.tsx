"use client";

import { useEffect, useRef } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle, FontSize } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import { normalizeStoredFcAnchors } from "@/lib/fc-markers";
import { FcAnchor } from "@/lib/report-tiptap-fc-anchor";
import { ReportSImage } from "@/lib/report-tiptap-s-image";
import {
  registerReportEditor,
  setActiveReportEditorKey,
  unregisterReportEditor,
} from "@/lib/report-editor-registry";
import {
  pastedHtmlLooksPlain,
  sanitizePastedHtml,
  wrapPlainPasteText,
} from "@/lib/report-editor-format";
import { extractImageFilesFromDataTransfer } from "@/lib/image-client";
import { countSSlotFigures } from "@/lib/report-body-s-slots";

function normalizeEditorHtml(html: string): string {
  const trimmed = normalizeStoredFcAnchors(html || "").trim();
  if (!trimmed || trimmed === "<p><br></p>" || trimmed === "<p></p>") {
    return "<p></p>";
  }
  return trimmed;
}

export function RichBody({
  id,
  editorKey,
  html,
  onChange,
  onFocus,
  onSaveSelection,
  onPasteImages,
  /** S 텍스트 입력 직후 figure HTML 로 바꿔 칸을 바로 보여 줌 */
  resolveSlotHtml,
  /** S 슬롯으로 쪼갠 연속 본문 — 테두리 없이 한 글처럼 보이게 */
  plainChrome = false,
}: {
  id?: string;
  /** 섹션별 TipTap 인스턴스 키 */
  editorKey: string;
  html: string;
  onChange: (html: string) => void;
  onFocus?: () => void;
  onSaveSelection?: () => void;
  /** 본문에 이미지 Ctrl+V 시 섹션 첨부로 넘김 */
  onPasteImages?: (files: File[]) => void;
  resolveSlotHtml?: (editorHtml: string) => string | null;
  plainChrome?: boolean;
}) {
  const editorRef = useRef<Editor | null>(null);
  const onChangeRef = useRef(onChange);
  const onFocusRef = useRef(onFocus);
  const onSaveSelectionRef = useRef(onSaveSelection);
  const onPasteImagesRef = useRef(onPasteImages);
  const resolveSlotHtmlRef = useRef(resolveSlotHtml);
  const lastEmittedRef = useRef(normalizeEditorHtml(html || "<p></p>"));
  const applyingSlotRef = useRef(false);
  onPasteImagesRef.current = onPasteImages;
  resolveSlotHtmlRef.current = resolveSlotHtml;

  onChangeRef.current = onChange;
  onFocusRef.current = onFocus;
  onSaveSelectionRef.current = onSaveSelection;

  const chromeClass = plainChrome
    ? "report-body min-h-[1.5rem] w-full max-w-full overflow-x-hidden bg-transparent px-0 py-1 text-sm outline-none leading-relaxed prose prose-sm max-w-none"
    : "report-body min-h-[120px] w-full max-w-full overflow-x-hidden rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 leading-relaxed prose prose-sm max-w-none";

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        code: false,
        blockquote: false,
        horizontalRule: false,
        // 문서 단위 히스토리(툴바·Ctrl+Z)와 충돌 방지
        undoRedo: false,
        // Underline은 StarterKit에 포함 (별도 등록 시 duplicate warn)
      }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      FontSize,
      FcAnchor,
      ReportSImage,
    ],
    content: normalizeEditorHtml(html || "<p></p>"),
    editorProps: {
      attributes: {
        ...(id ? { id } : {}),
        class: chromeClass,
      },
      handlePaste: (_view, event) => {
        const ed = editorRef.current;
        if (!ed) return false;

        const clipboard = event.clipboardData;
        // iOS: clipboardData 없으면 네이티브 붙여넣기에 맡김
        if (!clipboard) return false;

        const files = extractImageFilesFromDataTransfer(clipboard);
        const text =
          clipboard.getData("text/plain") ||
          clipboard.getData("text/uri-list") ||
          "";
        const rawHtml = clipboard.getData("text/html");
        // 스크린샷·이미지 복사는 HTML 조각이 같이 오는 경우가 많음 → 이미지 파일 우선
        const substantialText =
          text.replace(/\s+/g, " ").trim().length >= 40 &&
          !/^https?:\/\/\S+$/i.test(text.trim());

        if (files.length && !substantialText) {
          event.preventDefault();
          onPasteImagesRef.current?.(files);
          return true;
        }

        // Word/웹 HTML은 문장 중간 줄바꿈·레이아웃이 많아, 서식이 거의 없으면 plain 경로
        if (rawHtml?.trim()) {
          const plain = text.trim();
          if (plain && pastedHtmlLooksPlain(rawHtml)) {
            event.preventDefault();
            ed.commands.insertContent(wrapPlainPasteText(plain));
            return true;
          }
          const clean = sanitizePastedHtml(rawHtml);
          if (clean) {
            event.preventDefault();
            ed.commands.insertContent(clean);
            return true;
          }
          if (plain) {
            event.preventDefault();
            ed.commands.insertContent(wrapPlainPasteText(plain));
            return true;
          }
          // 읽은 내용이 비면 preventDefault 하지 않음 (아이폰 네이티브 경로)
          return false;
        }

        if (text.trim()) {
          event.preventDefault();
          ed.commands.insertContent(wrapPlainPasteText(text));
          return true;
        }

        return false;
      },
    },
    onCreate: ({ editor: ed }) => {
      editorRef.current = ed;
      lastEmittedRef.current = ed.getHTML();
    },
    onUpdate: ({ editor: ed }) => {
      if (applyingSlotRef.current) return;
      let next = ed.getHTML();
      // S / S1… 텍스트가 있으면 즉시 빈 이미지 칸(figure)으로 바꿈
      const resolved = resolveSlotHtmlRef.current?.(next);
      if (resolved && countSSlotFigures(resolved) > countSSlotFigures(next)) {
        applyingSlotRef.current = true;
        const from = ed.state.selection.from;
        ed.commands.setContent(normalizeEditorHtml(resolved), {
          emitUpdate: false,
        });
        next = ed.getHTML();
        try {
          const max = ed.state.doc.content.size;
          ed.commands.setTextSelection(Math.min(from, Math.max(1, max - 1)));
        } catch {
          /* ignore */
        }
        applyingSlotRef.current = false;
      }
      lastEmittedRef.current = next;
      onChangeRef.current(next);
    },
    onSelectionUpdate: () => {
      onSaveSelectionRef.current?.();
    },
    onFocus: () => {
      setActiveReportEditorKey(editorKey);
      onFocusRef.current?.();
      onSaveSelectionRef.current?.();
    },
  });

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    registerReportEditor(editorKey, editor);
    return () => unregisterReportEditor(editorKey, editor);
  }, [editor, editorKey]);

  useEffect(() => {
    if (!editor) return;
    const next = normalizeEditorHtml(html || "<p></p>");
    if (next === lastEmittedRef.current) return;
    const current = editor.getHTML();
    if (next === current) {
      lastEmittedRef.current = next;
      return;
    }
    // 포커스 중: figure 개수가 같을 땐 덮어쓰지 않음 (타이핑 보호)
    // 개수가 늘거나 줄면(S 추가·삭제·번호 재정렬) 반영
    if (editor.isFocused) {
      if (countSSlotFigures(next) === countSSlotFigures(current)) return;
    }
    const from = editor.state.selection.from;
    editor.commands.setContent(next, { emitUpdate: false });
    lastEmittedRef.current = editor.getHTML();
    if (editor.isFocused) {
      try {
        const max = editor.state.doc.content.size;
        editor.commands.setTextSelection(Math.min(from, Math.max(1, max - 1)));
      } catch {
        /* ignore */
      }
    }
  }, [html, editor]);

  return <EditorContent editor={editor} />;
}
