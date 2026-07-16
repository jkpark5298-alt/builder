"use client";

import { RefreshCw, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { VideoRecord } from "@/lib/types";

/** 요약 변경으로 팩트체크가 다시 만들어졌을 때 표시 */
export function FactCheckRevisedBanner({
  video,
  onDismissed,
}: {
  video: VideoRecord;
  onDismissed?: (video: VideoRecord) => void;
}) {
  const router = useRouter();
  const notice = video.factCheckRevisionNotice;
  const [hiding, setHiding] = useState(false);

  if (!notice || notice.dismissed) return null;

  const reasonLabel =
    notice.reason === "summary_edit"
      ? "요약이 수정되어"
      : "요약이 다시 만들어져";

  async function dismiss() {
    setHiding(true);
    try {
      const res = await fetch(`/api/videos/${video.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dismissFactCheckRevisionNotice: true }),
      });
      const data = (await res.json()) as { video?: VideoRecord };
      if (data.video) onDismissed?.(data.video);
      router.refresh();
    } finally {
      setHiding(false);
    }
  }

  return (
    <div
      className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-3 flex gap-2 items-start"
      role="status"
    >
      <RefreshCw className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0 space-y-1">
        <p className="text-sm font-medium text-amber-950">
          팩트체크 항목이 변경되었습니다
        </p>
        <p className="text-xs text-amber-900/90 leading-relaxed">
          {reasonLabel} 팩트체크 대상 {notice.itemCount}건을 새로 맞췄습니다.
          이전 답변은 초기화되었으니 다시 정리해 주세요.
        </p>
      </div>
      <button
        type="button"
        onClick={dismiss}
        disabled={hiding}
        className="shrink-0 rounded-lg p-1.5 text-amber-800 hover:bg-amber-100 disabled:opacity-50"
        aria-label="안내 닫기"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
