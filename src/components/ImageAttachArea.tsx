"use client";

import { useCallback, useRef } from "react";
import { Loader2, X } from "lucide-react";
import {
  compressImageFiles,
  extractImageFilesFromDataTransfer,
} from "@/lib/image-client";

type Props = {
  images: string[];
  onChange: (images: string[]) => void | Promise<void>;
  busy?: boolean;
  label?: string;
  hint?: string;
  maxImages?: number;
  /** 붙여넣기·드래그 활성화 */
  pasteEnabled?: boolean;
};

export function ImageAttachArea({
  images,
  onChange,
  busy = false,
  label = "이미지 추가",
  hint = "파일 선택·복수 선택·Ctrl+V 붙여넣기 가능",
  maxImages = 12,
  pasteEnabled = true,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(
    async (files: File[]) => {
      const imageFiles = files.filter((f) => f.type.startsWith("image/"));
      if (!imageFiles.length) return;
      const remaining = maxImages - images.length;
      if (remaining <= 0) {
        alert(`이미지는 최대 ${maxImages}장까지 추가할 수 있습니다.`);
        return;
      }
      try {
        const compressed = await compressImageFiles(
          imageFiles.slice(0, remaining)
        );
        if (!compressed.length) return;
        await onChange([...images, ...compressed]);
      } catch {
        alert("이미지 추가에 실패했습니다.");
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
          <span className="text-xs text-ink-500">{hint}</span>
        )}
      </div>

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
    </div>
  );
}
