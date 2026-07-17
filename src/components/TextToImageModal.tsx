"use client";

import { useEffect, useMemo, useState } from "react";
import { ClipboardPaste, ImagePlus, Type, X } from "lucide-react";
import {
  compressImageFiles,
  extractImageFilesFromDataTransfer,
  readImagesFromClipboard,
} from "@/lib/image-client";
import {
  renderTextToImageDataUrl,
  renderTextWithImageToDataUrl,
} from "@/lib/text-to-image";

const BG_PRESETS = [
  { id: "white", label: "흰 배경", bg: "#ffffff", fg: "#1a2430" },
  { id: "cream", label: "크림", bg: "#f8f4ec", fg: "#1a2430" },
  { id: "ink", label: "다크", bg: "#1a2430", fg: "#f8fafc" },
  { id: "accent", label: "강조", bg: "#fff7ed", fg: "#9a3412" },
] as const;

export function TextToImageModal({
  onCancel,
  onInsert,
  initialText = "",
  title = "텍스트 → 이미지",
}: {
  onCancel: () => void;
  onInsert: (dataUrl: string) => void;
  initialText?: string;
  title?: string;
}) {
  const [text, setText] = useState(initialText);
  const [fontSize, setFontSize] = useState(28);
  const [preset, setPreset] = useState<(typeof BG_PRESETS)[number]["id"]>("white");
  const [align, setAlign] = useState<"left" | "center">("left");
  const [busy, setBusy] = useState(false);
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const colors = useMemo(
    () => BG_PRESETS.find((p) => p.id === preset) ?? BG_PRESETS[0],
    [preset]
  );

  useEffect(() => {
    let cancelled = false;
    if (!text.trim() && !attachedImage) {
      setPreviewUrl(null);
      return;
    }
    void (async () => {
      try {
        const url = await renderTextWithImageToDataUrl(text, attachedImage, {
          fontSize,
          backgroundColor: colors.bg,
          textColor: colors.fg,
          align,
          maxWidth: 640,
        });
        if (!cancelled) setPreviewUrl(url);
      } catch {
        if (!cancelled) setPreviewUrl(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [text, attachedImage, fontSize, colors, align]);

  async function attachFiles(files: File[]) {
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return;
    try {
      const [dataUrl] = await compressImageFiles(imgs.slice(0, 1));
      if (dataUrl) setAttachedImage(dataUrl);
    } catch {
      alert("이미지 추가에 실패했습니다.");
    }
  }

  function onPaste(e: React.ClipboardEvent) {
    const files = extractImageFilesFromDataTransfer(e.clipboardData);
    if (!files.length) return;
    e.preventDefault();
    void attachFiles(files);
  }

  async function pasteImageFromClipboard() {
    try {
      const files = await readImagesFromClipboard();
      if (files.length) {
        await attachFiles(files);
        return;
      }
    } catch {
      /* 권한 거부 등 */
    }
    alert(
      "클립보드에서 이미지를 찾지 못했습니다. 이미지를 복사한 뒤 다시 누르거나, 텍스트 입력칸에 Ctrl+V 하세요."
    );
  }

  async function insert() {
    if (!text.trim() && !attachedImage) {
      alert("텍스트를 입력하거나 이미지를 붙여넣어 주세요.");
      return;
    }
    setBusy(true);
    try {
      const url = attachedImage
        ? await renderTextWithImageToDataUrl(text, attachedImage, {
            fontSize,
            backgroundColor: colors.bg,
            textColor: colors.fg,
            align,
            maxWidth: 900,
          })
        : renderTextToImageDataUrl(text, {
            fontSize,
            backgroundColor: colors.bg,
            textColor: colors.fg,
            align,
            maxWidth: 900,
          });
      onInsert(url);
    } catch {
      alert("이미지 생성에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink-900/50 p-3">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl overflow-hidden max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-ink-100 shrink-0">
          <p className="font-medium text-ink-900 inline-flex items-center gap-1.5">
            <Type className="h-4 w-4" />
            {title}
          </p>
          <button type="button" onClick={onCancel} className="p-1">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-3 space-y-3 overflow-y-auto" onPaste={onPaste}>
          <label className="block text-xs font-medium text-ink-600">
            텍스트 입력
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              placeholder="이미지로 넣을 문장을 입력하세요…"
              className="mt-1.5 w-full rounded-xl border border-ink-200 px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </label>

          {/* 텍스트 아래 붙는 이미지 */}
          <div className="rounded-xl border border-dashed border-ink-200 bg-ink-50/60 p-2.5 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-ink-600 inline-flex items-center gap-1">
                <ImagePlus className="h-3.5 w-3.5" />
                텍스트 아래 이미지 (선택)
              </span>
              <button
                type="button"
                onClick={() => void pasteImageFromClipboard()}
                className="inline-flex items-center gap-1.5 min-h-9 rounded-lg border border-ink-200 bg-white px-2.5 text-xs font-medium hover:border-accent"
              >
                <ClipboardPaste className="h-3.5 w-3.5" />
                이미지 붙여넣기
              </button>
              <label className="inline-flex items-center min-h-9 rounded-lg border border-ink-200 bg-white px-2.5 text-xs font-medium cursor-pointer hover:border-accent">
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(e) => {
                    void attachFiles(Array.from(e.target.files ?? []));
                    e.target.value = "";
                  }}
                />
                파일 선택
              </label>
              {attachedImage && (
                <button
                  type="button"
                  onClick={() => setAttachedImage(null)}
                  className="inline-flex items-center gap-1 min-h-9 rounded-lg border border-ink-200 bg-white px-2.5 text-xs font-medium text-verify-false hover:border-verify-false"
                >
                  <X className="h-3.5 w-3.5" />
                  이미지 제거
                </button>
              )}
            </div>
            <p className="text-[11px] text-ink-500">
              캡처·복사한 이미지를 Ctrl+V로 붙여넣으면 텍스트 아래에 합쳐집니다.
            </p>
            {attachedImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={attachedImage}
                alt="첨부 이미지"
                className="max-h-40 rounded-lg border border-ink-200 bg-white"
              />
            )}
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs text-ink-500">배경</span>
            {BG_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPreset(p.id)}
                className={`min-h-8 rounded-lg border px-2.5 text-xs ${
                  preset === p.id
                    ? "border-accent bg-accent-muted"
                    : "border-ink-200 bg-white"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-3 items-center">
            <label className="text-xs text-ink-500 flex items-center gap-2">
              글자 크기
              <input
                type="range"
                min={18}
                max={44}
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}
              />
              <span className="tabular-nums w-8">{fontSize}</span>
            </label>
            <div className="flex gap-1.5">
              {(
                [
                  ["left", "왼쪽"],
                  ["center", "가운데"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setAlign(id)}
                  className={`min-h-8 rounded-lg border px-2.5 text-xs ${
                    align === id
                      ? "border-accent bg-accent-muted"
                      : "border-ink-200 bg-white"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-ink-100 bg-ink-50 p-2">
            <p className="text-xs text-ink-500 mb-2 px-1">미리보기</p>
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt=""
                className="w-full rounded-lg border border-ink-100 bg-white"
              />
            ) : (
              <p className="text-sm text-ink-400 px-2 py-6 text-center">
                텍스트를 입력하면 미리보기가 나타납니다.
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-2 p-3 border-t border-ink-100 shrink-0">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 min-h-11 rounded-xl border border-ink-200"
          >
            취소
          </button>
          <button
            type="button"
            disabled={busy || (!text.trim() && !attachedImage)}
            onClick={() => void insert()}
            className="flex-1 min-h-11 rounded-xl bg-ink-900 text-white font-medium disabled:opacity-50"
          >
            {busy ? "생성 중…" : "이미지로 넣기"}
          </button>
        </div>
      </div>
    </div>
  );
}
