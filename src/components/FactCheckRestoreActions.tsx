"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { History, Loader2, RotateCcw } from "lucide-react";
import type { VideoRecord } from "@/lib/types";

/** 삭제 항목 원복 · 요약에서 FC 재생성 */
export function FactCheckRestoreActions({
  video,
  onVideoUpdate,
  compact = false,
}: {
  video: VideoRecord;
  onVideoUpdate: (v: VideoRecord) => void;
  compact?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"trash" | "overview" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const trashCount = video.factCheckTrash?.length ?? 0;
  const hasOverview = (video.overview?.trim().length ?? 0) >= 40;

  async function patch(body: Record<string, unknown>, mode: "trash" | "overview") {
    setBusy(mode);
    setError(null);
    try {
      const res = await fetch(`/api/videos/${video.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft: true, ...body }),
      });
      const data = (await res.json()) as {
        error?: string;
        video?: VideoRecord;
      };
      if (!res.ok || !data.video) {
        throw new Error(data.error || "복구 실패");
      }
      onVideoUpdate(data.video);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "복구 실패");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className={
        compact
          ? "space-y-2"
          : "rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-3 space-y-2"
      }
    >
      {!compact && (
        <p className="text-sm text-ink-800 font-medium flex items-center gap-1.5">
          <History className="h-4 w-4 text-amber-700" />
          팩트체크 원복
        </p>
      )}
      <div className="flex flex-col sm:flex-row flex-wrap gap-2">
        <button
          type="button"
          disabled={busy !== null || trashCount === 0}
          onClick={() =>
            void patch({ restoreFactCheckTrash: true }, "trash")
          }
          className="inline-flex items-center justify-center gap-1.5 min-h-11 rounded-xl border border-accent/40 bg-white px-4 text-sm font-medium disabled:opacity-45 hover:bg-accent-muted/40"
        >
          {busy === "trash" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RotateCcw className="h-4 w-4" />
          )}
          삭제 항목 원복
          {trashCount > 0 ? ` (${trashCount})` : ""}
        </button>
        <button
          type="button"
          disabled={busy !== null || !hasOverview}
          onClick={() => {
            if (
              !confirm(
                "요약 내용으로 팩트체크 항목을 다시 만들까요?\n현재 남은 항목은 휴지통으로 옮긴 뒤 새로 생성합니다."
              )
            ) {
              return;
            }
            void patch({ rebuildFactChecksFromOverview: true }, "overview");
          }}
          className="inline-flex items-center justify-center gap-1.5 min-h-11 rounded-xl border border-ink-300 bg-white px-4 text-sm font-medium disabled:opacity-45 hover:border-accent"
        >
          {busy === "overview" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <History className="h-4 w-4" />
          )}
          요약에서 FC 다시 만들기
        </button>
      </div>
      {trashCount === 0 && (
        <p className="text-xs text-ink-500">
          이번 세션에 보관한 삭제 항목이 없으면 「요약에서 FC 다시 만들기」를
          쓰세요.
        </p>
      )}
      {error && (
        <p className="text-sm text-verify-false" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
