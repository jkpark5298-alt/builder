"use client";

import { FileText, ListChecks, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { VideoRecord } from "@/lib/types";
import { ReopenAsDraftButton } from "@/components/ReopenAsDraftButton";

/** 수동 요약만 저장한 뒤: 팩트체크·보고서 직접 수정 안내 */
export function ManualFollowUpBanner({
  video,
  onDismissed,
}: {
  video: VideoRecord;
  onDismissed?: (video: VideoRecord) => void;
}) {
  const router = useRouter();
  const notice = video.manualFollowUpNotice;
  const [hiding, setHiding] = useState(false);

  if (!notice || notice.dismissed) return null;

  const ready = video.status === "ready";

  async function dismiss() {
    setHiding(true);
    try {
      const res = await fetch(`/api/videos/${video.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dismissManualFollowUpNotice: true }),
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
      className="rounded-xl border border-sky-300 bg-sky-50 px-3 py-3 space-y-3"
      role="status"
    >
      <div className="flex gap-2 items-start">
        <ListChecks className="h-4 w-4 text-sky-800 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0 space-y-1">
          <p className="text-sm font-medium text-sky-950">
            수동 요약만 저장했습니다
          </p>
          <p className="text-xs text-sky-900/90 leading-relaxed">
            팩트체크·보고서는 자동으로 바꾸지 않았습니다. 아래에서{" "}
            <strong>직접 수정</strong>하세요. (스크립트 재요약과는 별개입니다)
          </p>
        </div>
        <button
          type="button"
          onClick={() => void dismiss()}
          disabled={hiding}
          className="shrink-0 rounded-lg p-1.5 text-sky-800 hover:bg-sky-100 disabled:opacity-50"
          aria-label="안내 닫기"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex flex-col sm:flex-row flex-wrap gap-2 pl-6">
        {ready ? (
          <>
            <ReopenAsDraftButton videoId={video.id} />
            <button
              type="button"
              onClick={() =>
                document
                  .getElementById("report")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
              className="inline-flex items-center justify-center gap-1.5 min-h-10 rounded-xl border border-sky-300 bg-white px-3 text-sm font-medium text-sky-950 hover:border-accent"
            >
              <FileText className="h-4 w-4" />
              보고서 직접 수정
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() =>
              document
                .getElementById("manual-factcheck")
                ?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
            className="inline-flex items-center justify-center gap-1.5 min-h-10 rounded-xl border border-sky-300 bg-white px-3 text-sm font-medium text-sky-950 hover:border-accent"
          >
            <ListChecks className="h-4 w-4" />
            팩트체크 직접 수정
          </button>
        )}
      </div>
    </div>
  );
}
