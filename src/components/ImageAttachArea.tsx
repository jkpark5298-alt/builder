"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ClipboardPaste, Loader2, Type, X } from "lucide-react";
import {
  compressDataUrls,
  compressImageFiles,
  extractImageFilesFromDataTransfer,
  readImagesFromClipboard,
} from "@/lib/image-client";
import { TextToImageModal } from "@/components/TextToImageModal";

type Props = {
  images: string[];
  onChange: (images: string[]) => void | Promise<void>;
  busy?: boolean;
  label?: string;
  hint?: string;
  maxImages?: number;
  /** 붙여넣기·드래그 활성화 */
  pasteEnabled?: boolean;
  /** 텍스트→이미지 버튼 */
  textImageEnabled?: boolean;
  initialText?: string;
};

export function ImageAttachArea({
  images,
  onChange,
  busy = false,
  label = "이미지 추가",
  hint = "PC: Ctrl+V · 아이폰: 「붙여넣기」 · 텍스트→이미지",
  maxImages = 12,
  pasteEnabled = true,
  textImageEnabled = true,
  initialText = "",
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pasteRef = useRef<HTMLTextAreaElement>(null);
  const [textModal, setTextModal] = useState(false);
  const [pasteArmed, setPasteArmed] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const addDataUrls = useCallback(
    async (dataUrls: string[]) => {
      if (!dataUrls.length) return;
      const remaining = maxImages - images.length;
      if (remaining <= 0) {
        alert(`이미지는 최대 ${maxImages}장까지 추가할 수 있습니다.`);
        return;
      }
      try {
        const compressed = await compressDataUrls(
          dataUrls.slice(0, remaining)
        );
        if (!compressed.length) return;
        await onChange([...images, ...compressed]);
        setPasteArmed(false);
        setStatus(null);
      } catch {
        alert("이미지 추가에 실패했습니다.");
      }
    },
    [images, maxImages, onChange]
  );

  const addFiles = useCallback(
    async (files: File[]) => {
      const imageFiles = files.filter((f) => f.type.startsWith("image/"));
      if (!imageFiles.length) return false;
      const remaining = maxImages - images.length;
      if (remaining <= 0) {
        alert(`이미지는 최대 ${maxImages}장까지 추가할 수 있습니다.`);
        return false;
      }
      try {
        const compressed = await compressImageFiles(
          imageFiles.slice(0, remaining)
        );
        if (!compressed.length) return false;
        await onChange([...images, ...compressed]);
        setPasteArmed(false);
        setStatus(null);
        return true;
      } catch {
        alert("이미지 추가에 실패했습니다.");
        return false;
      }
    },
    [images, maxImages, onChange]
  );

  const onPaste = useCallback(
    (e: React.ClipboardEvent) => {
      if (!pasteEnabled || busy) return;
      const files = extractImageFilesFromDataTransfer(e.clipboardData);
      if (!files.length) return;
      e.preventDefault();
      void addFiles(files);
    },
    [addFiles, busy, pasteEnabled]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      if (!pasteEnabled || busy) return;
      e.preventDefault();
      void addFiles(Array.from(e.dataTransfer.files));
    },
    [addFiles, busy, pasteEnabled]
  );

  // 「붙여넣기」 누른 뒤 어디서든 Ctrl+V 하면 이미지 수신
  useEffect(() => {
    if (!pasteArmed || !pasteEnabled) return;
    const onWindowPaste = (e: ClipboardEvent) => {
      if (busy) return;
      const files = e.clipboardData
        ? extractImageFilesFromDataTransfer(e.clipboardData)
        : [];
      if (!files.length) return;
      e.preventDefault();
      void addFiles(files);
    };
    window.addEventListener("paste", onWindowPaste, true);
    return () => window.removeEventListener("paste", onWindowPaste, true);
  }, [pasteArmed, pasteEnabled, busy, addFiles]);

  async function pasteFromClipboard() {
    if (!pasteEnabled || busy) return;

    // await 전에 포커스·대기 모드 (권한 다이얼로그에 포커스 뺏기지 않게)
    setPasteArmed(true);
    setStatus("이미지를 복사한 뒤 지금 Ctrl+V 하세요.");
    pasteRef.current?.focus();

    try {
      const files = await readImagesFromClipboard();
      if (files.length) {
        const ok = await addFiles(files);
        if (ok) return;
      }
    } catch {
      /* 권한 거부·미지원 → Ctrl+V 대기 */
    }
  }

  return (
    <div
      className="space-y-2"
      onPaste={pasteEnabled ? onPaste : undefined}
      onDragOver={
        pasteEnabled
          ? (e) => {
              e.preventDefault();
            }
          : undefined
      }
      onDrop={pasteEnabled ? onDrop : undefined}
    >
      <div className="flex flex-wrap gap-2 items-center">
        <label className="inline-flex items-center gap-2 min-h-10 rounded-lg border border-ink-200 bg-white px-3 text-xs font-medium cursor-pointer hover:border-accent">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              void addFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          {busy ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              저장 중…
            </>
          ) : (
            label
          )}
        </label>
        {pasteEnabled && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void pasteFromClipboard()}
            className={`inline-flex items-center gap-1.5 min-h-10 rounded-lg border px-3 text-xs font-medium disabled:opacity-50 ${
              pasteArmed
                ? "border-accent bg-accent-muted text-ink-900"
                : "border-ink-200 bg-white hover:border-accent"
            }`}
          >
            <ClipboardPaste className="h-3.5 w-3.5" />
            {pasteArmed ? "Ctrl+V 대기 중…" : "붙여넣기"}
          </button>
        )}
        {textImageEnabled && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setTextModal(true)}
            className="inline-flex items-center gap-1.5 min-h-10 rounded-lg border border-ink-200 bg-white px-3 text-xs font-medium hover:border-accent disabled:opacity-50"
          >
            <Type className="h-3.5 w-3.5" />
            텍스트→이미지
          </button>
        )}
        {(pasteEnabled || textImageEnabled) && hint.trim() ? (
          <span className="text-xs text-ink-500">{hint}</span>
        ) : null}
      </div>

      {pasteEnabled && (
        <textarea
          ref={pasteRef}
          aria-label="이미지 붙여넣기"
          rows={2}
          readOnly={false}
          placeholder="또는 여기 클릭 후 Ctrl+V / 이미지 드래그"
          className={`w-full rounded-lg border border-dashed px-2 py-1.5 text-xs outline-none focus:border-accent ${
            pasteArmed
              ? "border-accent bg-accent-muted/40 text-ink-800"
              : "border-ink-200 bg-white text-ink-500"
          }`}
          onPaste={onPaste}
          onFocus={() => {
            if (pasteEnabled && !busy) {
              setPasteArmed(true);
              setStatus("지금 Ctrl+V로 이미지를 붙여넣으세요.");
            }
          }}
        />
      )}
      {status && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
          {status}
        </p>
      )}

      {images.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {images.map((src, i) => (
            <div
              key={`${i}-${src.slice(0, 24)}`}
              className="relative overflow-hidden rounded-lg border border-ink-100 bg-white"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt=""
                className="w-full aspect-video object-cover"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => void onChange(images.filter((_, j) => j !== i))}
                className="absolute top-1.5 right-1.5 rounded-md bg-white/90 border border-ink-200 p-1 hover:border-verify-false disabled:opacity-50"
                title="이미지 제거"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {textModal && (
        <TextToImageModal
          initialText={initialText}
          onCancel={() => setTextModal(false)}
          onInsert={(dataUrl) => {
            setTextModal(false);
            void addDataUrls([dataUrl]);
          }}
        />
      )}
    </div>
  );
}
