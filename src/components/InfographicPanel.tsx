"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, RefreshCw, RotateCcw, X } from "lucide-react";
import type { VideoRecord } from "@/lib/types";
import { hasInfographic } from "@/lib/factcheck-client";
import { InfographicSharePanel } from "@/components/InfographicSharePanel";
import { compressImageFiles } from "@/lib/image-client";
import { uploadDataUrls } from "@/lib/media-upload-client";
import { collectInfographicBridgeImages } from "@/lib/infographic-bridge";

const MAX_BRIDGE = 6;

export function InfographicPanel({ video }: { video: VideoRecord }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [bridgeBusy, setBridgeBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bridgeImages, setBridgeImages] = useState<string[]>(() =>
    Array.isArray(video.infographicBridgeImages)
      ? video.infographicBridgeImages
      : collectInfographicBridgeImages(video, MAX_BRIDGE)
  );
  const [bridgeDirty, setBridgeDirty] = useState(false);
  const ready = hasInfographic(video);
  const cacheBust = encodeURIComponent(video.updatedAt);

  useEffect(() => {
    setBridgeImages(
      Array.isArray(video.infographicBridgeImages)
        ? video.infographicBridgeImages
        : collectInfographicBridgeImages(video, MAX_BRIDGE)
    );
    setBridgeDirty(false);
  }, [video.id, video.updatedAt, video.infographicBridgeImages, video.report]);

  async function rebuild() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/videos/${video.id}/infographic`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rebuild: true }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "인포그래픽 생성 실패");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "인포그래픽 생성 실패");
    } finally {
      setBusy(false);
    }
  }

  async function saveBridgeAndRebuild(next: string[] | null) {
    setBridgeBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/videos/${video.id}/infographic`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rebuild: true,
          bridgeImages: next,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        video?: VideoRecord;
      };
      if (!res.ok) throw new Error(data.error || "관련 이미지 저장 실패");
      if (data.video) {
        setBridgeImages(
          Array.isArray(data.video.infographicBridgeImages)
            ? data.video.infographicBridgeImages
            : collectInfographicBridgeImages(data.video, MAX_BRIDGE)
        );
      } else if (next) {
        setBridgeImages(next);
      }
      setBridgeDirty(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "관련 이미지 저장 실패");
    } finally {
      setBridgeBusy(false);
    }
  }

  function removeAt(i: number) {
    setBridgeImages((prev) => prev.filter((_, idx) => idx !== i));
    setBridgeDirty(true);
  }

  async function onAddFiles(files: FileList | null) {
    const list = Array.from(files ?? []).filter((f) =>
      f.type.startsWith("image/")
    );
    if (!list.length) return;
    const room = MAX_BRIDGE - bridgeImages.length;
    if (room <= 0) {
      setError(`관련 이미지는 최대 ${MAX_BRIDGE}장입니다.`);
      return;
    }
    setBridgeBusy(true);
    setError(null);
    try {
      const compressed = await compressImageFiles(list.slice(0, room));
      const uploaded = await uploadDataUrls(
        compressed,
        `videos/${video.id}/infographic-bridge`
      );
      setBridgeImages((prev) =>
        Array.from(new Set([...prev, ...uploaded])).slice(0, MAX_BRIDGE)
      );
      setBridgeDirty(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "이미지 추가 실패");
    } finally {
      setBridgeBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <section className="rounded-2xl border border-ink-200 bg-white/80 p-4 sm:p-5 print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 className="font-display text-lg sm:text-xl">
          4. 인포그래픽 · 저장 · 공유
        </h2>
        <button
          type="button"
          disabled={busy || bridgeBusy}
          onClick={() => void rebuild()}
          className="inline-flex items-center gap-1.5 min-h-9 rounded-lg border border-ink-200 bg-white px-3 text-xs font-medium text-ink-700 hover:border-accent disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {ready ? "보고서 기준으로 다시 만들기" : "인포그래픽 만들기"}
        </button>
      </div>
      <p className="text-xs text-ink-500 mb-3">
        저장된 보고서 섹션·팩트체크를 바탕으로 만듭니다. 아래{" "}
        <strong>관련 이미지</strong>를 고친 뒤 저장하면 인포그래픽에 반영됩니다.
      </p>

      {error && (
        <p className="mb-3 text-sm text-verify-false rounded-xl border border-verify-false/30 bg-verify-false/5 px-3 py-2">
          {error}
        </p>
      )}

      <div className="mb-4 rounded-xl border border-ink-200 bg-white overflow-hidden">
        <div className="flex items-center gap-0">
          <div className="w-1.5 self-stretch bg-accent shrink-0" />
          <div className="flex-1 p-3 sm:p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-accent">관련 이미지</p>
              <span className="text-xs text-ink-400">
                {bridgeImages.length}/{MAX_BRIDGE}
              </span>
            </div>
            {bridgeImages.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {bridgeImages.map((src, i) => (
                  <div
                    key={`${src.slice(0, 48)}-${i}`}
                    className="relative overflow-hidden rounded-xl border border-ink-100 bg-ink-50 aspect-[4/3]"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={src}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      disabled={bridgeBusy}
                      onClick={() => removeAt(i)}
                      className="absolute top-1.5 right-1.5 rounded-lg bg-white/95 border border-ink-200 p-1 shadow-sm disabled:opacity-50"
                      title="이 이미지 제거"
                    >
                      <X className="h-3.5 w-3.5 text-ink-700" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-ink-500 py-4 text-center border border-dashed border-ink-200 rounded-xl">
                관련 이미지가 없습니다. 아래에서 추가하세요.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => void onAddFiles(e.target.files)}
              />
              <button
                type="button"
                disabled={bridgeBusy || bridgeImages.length >= MAX_BRIDGE}
                onClick={() => fileRef.current?.click()}
                className="inline-flex items-center gap-1.5 min-h-9 rounded-lg border border-ink-200 bg-white px-3 text-xs font-medium disabled:opacity-50"
              >
                {bridgeBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ImagePlus className="h-3.5 w-3.5" />
                )}
                이미지 추가
              </button>
              <button
                type="button"
                disabled={bridgeBusy}
                onClick={() => {
                  setBridgeImages(
                    collectInfographicBridgeImages(video, MAX_BRIDGE)
                  );
                  setBridgeDirty(true);
                }}
                className="inline-flex items-center gap-1.5 min-h-9 rounded-lg border border-ink-200 bg-white px-3 text-xs font-medium disabled:opacity-50"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                자동 모으기
              </button>
              <button
                type="button"
                disabled={bridgeBusy || (!bridgeDirty && !Array.isArray(video.infographicBridgeImages))}
                onClick={() => void saveBridgeAndRebuild(bridgeImages)}
                className="inline-flex items-center gap-1.5 min-h-9 rounded-lg border border-accent/40 bg-accent text-white px-3 text-xs font-medium hover:opacity-95 disabled:opacity-50"
              >
                {bridgeBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : null}
                저장 · 인포 반영
              </button>
            </div>
            <p className="text-xs text-ink-400">
              인포그래픽 상단 「관련 이미지」 칸에 들어가는 사진입니다. 삭제·추가
              후 <strong>저장 · 인포 반영</strong>을 누르세요.
            </p>
          </div>
        </div>
      </div>

      {ready ? (
        <>
          <div className="overflow-auto rounded-xl border border-ink-100 bg-ink-50 max-h-none">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/videos/${video.id}/infographic?t=${cacheBust}`}
              alt="인포그래픽"
              className="w-full h-auto max-w-none block"
              style={{ minHeight: "200px" }}
            />
          </div>
          <InfographicSharePanel video={video} />
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-ink-200 bg-ink-50/80 px-4 py-8 text-center space-y-3">
          <p className="text-ink-600 text-sm">
            인포그래픽이 아직 없거나 저장 중 제외되었습니다.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void rebuild()}
            className="inline-flex items-center justify-center gap-2 min-h-11 rounded-xl bg-accent px-4 text-sm font-medium text-white hover:opacity-95 disabled:opacity-60"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            지금 만들기
          </button>
        </div>
      )}
    </section>
  );
}
