"use client";

import { ImagePlus, Loader2, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { compressImageFiles } from "@/lib/image-client";
import { uploadDataUrls } from "@/lib/media-upload-client";

/** 상세·목록 상단 표지(초기 화면) 이미지 교체 */
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
  const [preview, setPreview] = useState(thumbnailUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

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

  async function onPick(files: FileList | null) {
    const file = files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    setBusy(true);
    setError(null);
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
  }

  return (
    <div
      id="cover"
      className="scroll-mt-24 space-y-2"
    >
      {emphasize && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-ink-800">
            초기 화면(표지) 이미지
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
          alt="초기 화면 표지"
          className="w-full aspect-video object-cover opacity-95"
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
              초기 화면 바꾸기
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
              목록 카드·상세 상단·인포그래픽 표지에 함께 반영됩니다.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
