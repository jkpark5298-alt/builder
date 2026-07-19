"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import type { VideoRecord } from "@/lib/types";
import { hasInfographic } from "@/lib/factcheck-client";
import { InfographicSharePanel } from "@/components/InfographicSharePanel";

export function InfographicPanel({ video }: { video: VideoRecord }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = hasInfographic(video);
  const cacheBust = encodeURIComponent(video.updatedAt);

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

  return (
    <section className="rounded-2xl border border-ink-200 bg-white/80 p-4 sm:p-5 print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 className="font-display text-lg sm:text-xl">
          4. 인포그래픽 · 저장 · 공유
        </h2>
        <button
          type="button"
          disabled={busy}
          onClick={() => void rebuild()}
          className="inline-flex items-center gap-1.5 min-h-9 rounded-lg border border-ink-200 bg-white px-3 text-xs font-medium text-ink-700 hover:border-accent disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {ready ? "다시 만들기" : "인포그래픽 만들기"}
        </button>
      </div>

      {error && (
        <p className="mb-3 text-sm text-verify-false rounded-xl border border-verify-false/30 bg-verify-false/5 px-3 py-2">
          {error}
        </p>
      )}

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
