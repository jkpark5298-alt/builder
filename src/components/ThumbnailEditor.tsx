"use client";

import { ClipboardPaste, ImagePlus, Loader2, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  compressImageFiles,
  extractImageFilesFromDataTransfer,
  readImagesFromClipboard,
} from "@/lib/image-client";
import { uploadDataUrls } from "@/lib/media-upload-client";

/** 상세·목록 상단 표지 이미지 교체 */
export function ThumbnailEditor({
  videoId,
  thumbnailUrl,
  /** 완료 보고서 등에서 안내 문구 강조 */
  emphasize = false,
}: {
  videoId: string;
  thumbnailUrl: string;
  emphasize?: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const pasteRef = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(thumbnailUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [pasteArmed, setPasteArmed] = useState(false);

  useEffect(() => {
    setPreview(thumbnailUrl);
  }, [thumbnailUrl]);

  async function persist(nextUrl: string | null) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/videos/${videoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updateThumbnail: { thumbnailUrl: nextUrl },
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        video?: { thumbnailUrl?: string };
      };
      if (!res.ok) {
        throw new Error(data.error || "표지 이미지 저장 실패");
      }
      if (data.video?.thumbnailUrl) {
        setPreview(data.video.thumbnailUrl);
      } else if (nextUrl) {
        setPreview(nextUrl);
      }
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1800);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "표지 이미지 저장 실패");
    } finally {
      setBusy(false);
    }
  }

  const uploadFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) return;
      setBusy(true);
      setError(null);
      setPasteArmed(false);
      try {
        const compressed = await compressImageFiles([file]);
        if (!compressed.length) throw new Error("이미지를 읽지 못했습니다.");
        const uploaded = await uploadDataUrls(
          compressed,
          `videos/${videoId}/thumb`
        );
        if (!uploaded[0]) throw new Error("이미지 업로드에 실패했습니다.");
        const url = uploaded[0];
        setPreview(url);
        const res = await fetch(`/api/videos/${videoId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            updateThumbnail: { thumbnailUrl: url },
          }),
        });
        const data = (await res.json()) as {
          error?: string;
          video?: { thumbnailUrl?: string };
        };
        if (!res.ok) {
          throw new Error(data.error || "표지 이미지 저장 실패");
        }
        if (data.video?.thumbnailUrl) setPreview(data.video.thumbnailUrl);
        setSavedFlash(true);
        window.setTimeout(() => setSavedFlash(false), 1800);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "표지 이미지 업로드 실패");
        setPreview(thumbnailUrl);
      } finally {
        setBusy(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [router, thumbnailUrl, videoId]
  );

  function onPick(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    void uploadFile(file);
  }

  const onPaste = useCallback(
    (e: React.ClipboardEvent | ClipboardEvent) => {
      if (busy) return;
      const data = e.clipboardData;
      if (!data) return;
      const files = extractImageFilesFromDataTransfer(data);
      if (!files[0]) return;
      e.preventDefault();
      void uploadFile(files[0]);
    },
    [busy, uploadFile]
  );

  useEffect(() => {
    if (!pasteArmed) return;
    const onWindowPaste = (e: ClipboardEvent) => {
      onPaste(e);
    };
    window.addEventListener("paste", onWindowPaste, true);
    return () => window.removeEventListener("paste", onWindowPaste, true);
  }, [pasteArmed, onPaste]);

  async function pasteFromClipboard() {
    if (busy) return;
    setPasteArmed(true);
    pasteRef.current?.focus();
    try {
      const files = await readImagesFromClipboard();
      if (files[0]) {
        await uploadFile(files[0]);
        return;
      }
    } catch {
      /* 권한 거부·미지원 → Ctrl+V 대기 */
    }
  }

  return (
    <div
      id="cover"
      className="scroll-mt-24 space-y-2"
      onPaste={onPaste}
      onDragOver={(e) => {
        e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        if (busy) return;
        const file = Array.from(e.dataTransfer.files).find((f) =>
          f.type.startsWith("image/")
        );
        if (file) void uploadFile(file);
      }}
    >
      {emphasize && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-ink-800">
            표지 이미지
          </p>
          {savedFlash && (
            <span className="text-xs text-emerald-700 font-medium">저장됨</span>
          )}
        </div>
      )}
      <div className="relative overflow-hidden rounded-2xl border border-ink-200 bg-ink-900">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={preview}
          alt="표지"
          className="w-full aspect-video object-contain opacity-95"
        />
        <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/75 to-transparent print:hidden">
          <div className="flex flex-wrap gap-2">
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => void onPick(e.target.files)}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              className="inline-flex items-center gap-1.5 min-h-10 rounded-lg border border-white/30 bg-white px-3.5 text-sm font-medium text-ink-900 hover:bg-white disabled:opacity-60 shadow-sm"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ImagePlus className="h-4 w-4" />
              )}
              표지 바꾸기
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void pasteFromClipboard()}
              className={`inline-flex items-center gap-1.5 min-h-10 rounded-lg border px-3 text-sm font-medium disabled:opacity-60 ${
                pasteArmed
                  ? "border-accent bg-accent-muted text-ink-900"
                  : "border-white/20 bg-black/45 text-white hover:bg-black/60"
              }`}
              title="클립보드 이미지 붙여넣기"
            >
              <ClipboardPaste className="h-4 w-4" />
              {pasteArmed ? "Ctrl+V 대기…" : "붙여넣기"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void persist(null)}
              className="inline-flex items-center gap-1.5 min-h-10 rounded-lg border border-white/20 bg-black/45 px-3 text-sm font-medium text-white hover:bg-black/60 disabled:opacity-60"
              title="기본 표지로 되돌리기"
            >
              <RotateCcw className="h-4 w-4" />
              기본
            </button>
          </div>
          {error && (
            <p className="mt-2 text-xs text-red-200" role="alert">
              {error}
            </p>
          )}
          {!error && (
            <p className="mt-2 text-[11px] text-white/80">
              목록 카드·상세 상단 표지에 함께 반영됩니다. PC: Ctrl+V · 드래그앤드롭
              가능.
            </p>
          )}
        </div>
        {/* iOS 등에서 포커스 후 Ctrl+V 수신용 */}
        <textarea
          ref={pasteRef}
          aria-label="표지 이미지 붙여넣기"
          tabIndex={-1}
          className="sr-only"
          onPaste={onPaste}
        />
      </div>
    </div>
  );
}
