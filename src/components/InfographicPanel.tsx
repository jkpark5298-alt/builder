"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { VideoRecord } from "@/lib/types";
import { ImageAttachArea } from "@/components/ImageAttachArea";
import { uploadDataUrls } from "@/lib/media-upload-client";

const MAX_IMAGES = 12;

function bridgeList(video: VideoRecord): string[] {
  return Array.isArray(video.infographicBridgeImages)
    ? video.infographicBridgeImages.filter(Boolean)
    : [];
}

/** 인포그래픽 = 사용자가 붙여넣기·사진첩으로 넣은 이미지 (자동 생성 없음) */
export function InfographicPanel({ video }: { video: VideoRecord }) {
  const router = useRouter();
  const [images, setImages] = useState<string[]>(() => bridgeList(video));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedHint, setSavedHint] = useState<string | null>(null);

  useEffect(() => {
    setImages(bridgeList(video));
  }, [video.id, video.updatedAt, video.infographicBridgeImages]);

  async function persist(next: string[]) {
    setBusy(true);
    setError(null);
    setSavedHint(null);
    try {
      const remote: string[] = [];
      const dataUrls: string[] = [];
      for (const u of next) {
        if (u.startsWith("data:image/")) dataUrls.push(u);
        else if (u.trim()) remote.push(u.trim());
      }
      const uploaded = dataUrls.length
        ? await uploadDataUrls(dataUrls, `videos/${video.id}/infographic`)
        : [];
      const merged = Array.from(new Set([...remote, ...uploaded])).slice(
        0,
        MAX_IMAGES
      );
      const res = await fetch(`/api/videos/${video.id}/infographic`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bridgeImages: merged }),
      });
      const data = (await res.json()) as {
        error?: string;
        video?: VideoRecord;
      };
      if (!res.ok) throw new Error(data.error || "저장 실패");
      const saved = data.video ? bridgeList(data.video) : merged;
      setImages(saved);
      setSavedHint(
        saved.length
          ? `${saved.length}장 저장했습니다.`
          : "이미지를 모두 지웠습니다."
      );
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-ink-200 bg-white/80 p-4 sm:p-5 print:hidden">
      <div className="mb-3">
        <h2 className="font-display text-lg sm:text-xl">
          4. 인포그래픽 이미지
        </h2>
        <p className="mt-1.5 text-xs sm:text-sm text-ink-600 leading-relaxed">
          자동 생성하지 않습니다.{" "}
          <strong>복사한 이미지를 붙여넣기</strong>하거나{" "}
          <strong>사진첩에서 가져오기</strong>로 넣으세요.
        </p>
      </div>

      {error && (
        <p className="mb-3 text-sm text-verify-false rounded-xl border border-verify-false/30 bg-verify-false/5 px-3 py-2">
          {error}
        </p>
      )}
      {savedHint && (
        <p className="mb-3 text-sm text-verify-true rounded-xl border border-verify-true/30 bg-verify-true/10 px-3 py-2">
          {savedHint}
        </p>
      )}

      <div className="rounded-xl border border-ink-200 bg-white p-3 sm:p-4">
        <div className="flex items-center justify-between gap-2 mb-2">
          <p className="text-sm font-semibold text-ink-800">이미지</p>
          <span className="text-xs text-ink-400">
            {images.length}/{MAX_IMAGES}
          </span>
        </div>
        <ImageAttachArea
          images={images}
          busy={busy}
          maxImages={MAX_IMAGES}
          label="사진첩에서 가져오기"
          hint="PC: Ctrl+V · 아이폰: 「붙여넣기」또는 사진첩"
          textImageEnabled={false}
          onChange={(next) => void persist(next)}
        />
        {busy && (
          <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-ink-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            저장 중…
          </p>
        )}
      </div>
    </section>
  );
}
