"use client";

import { useState } from "react";
import { BookOpen, Download, Loader2, Share2 } from "lucide-react";
import type { VideoRecord } from "@/lib/types";
import { shareInfographicToGoodNotes } from "@/lib/share-goodnotes";

export function InfographicSharePanel({ video }: { video: VideoRecord }) {
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const svgUrl = `/api/videos/${video.id}/infographic?t=${encodeURIComponent(video.updatedAt)}`;

  async function shareGoodNotes() {
    setBusy(true);
    setHint(null);
    try {
      const result = await shareInfographicToGoodNotes({
        videoId: video.videoId,
        title: video.title,
        svgUrl,
      });
      if (result === "shared") {
        setHint(
          "공유 시트에서 「Goodnotes」를 선택하면 노트에 추가됩니다."
        );
      } else {
        setHint(
          "PNG를 저장했습니다. Goodnotes 앱 → 새 문서/이미지 가져오기로 열어 주세요."
        );
      }
      void fetch(`/api/videos/${video.id}/infographic`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: "goodnotes" }),
      });
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        setHint(null);
        return;
      }
      setHint(
        e instanceof Error
          ? e.message
          : "공유에 실패했습니다. PNG 다운로드를 이용해 주세요."
      );
    } finally {
      setBusy(false);
    }
  }

  const btn =
    "inline-flex items-center justify-center gap-2 min-h-11 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors";

  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void shareGoodNotes()}
          className={`${btn} border-accent/40 bg-accent-muted/50 text-ink-900 hover:bg-accent-muted disabled:opacity-60`}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <BookOpen className="h-4 w-4" />
          )}
          {busy ? "준비 중…" : "굿노트로 공유"}
        </button>
        <a
          href={`/api/videos/${video.id}/infographic?download=1`}
          className={`${btn} border-ink-200 bg-white hover:border-accent`}
        >
          <Download className="h-4 w-4" />
          SVG 저장
        </a>
        <a
          href={svgUrl}
          target="_blank"
          rel="noreferrer"
          className={`${btn} border-ink-200 bg-white hover:border-accent`}
        >
          <Share2 className="h-4 w-4" />
          크게 보기
        </a>
      </div>
      <p className="text-xs text-ink-500 leading-relaxed">
        아이폰·아이패드: 「굿노트로 공유」→ 공유 시트에서{" "}
        <strong>Goodnotes</strong> 선택. PC는 PNG로 저장 후 Goodnotes에서
        가져오면 됩니다.
      </p>
      {hint && (
        <p
          className="text-sm rounded-xl border border-accent/30 bg-accent-muted/40 px-3 py-2 text-ink-800"
          role="status"
        >
          {hint}
        </p>
      )}
    </div>
  );
}
