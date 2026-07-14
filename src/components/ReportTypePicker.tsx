"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ReportType, VideoRecord } from "@/lib/types";
import { REPORT_TYPE_LABELS, REPORT_TYPE_STRUCTURE } from "@/lib/types";

export function ReportTypePicker({
  video,
  compact = false,
  onVideoUpdate,
}: {
  video: VideoRecord;
  compact?: boolean;
  onVideoUpdate?: (video: VideoRecord) => void;
}) {
  const router = useRouter();
  const [type, setType] = useState<ReportType>(video.reportType);
  const [saving, setSaving] = useState(false);

  async function save(next: ReportType) {
    setType(next);
    setSaving(true);
    try {
      const res = await fetch(`/api/videos/${video.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportType: next,
          rebuild: video.status === "ready",
        }),
      });
      const data = (await res.json()) as { video?: VideoRecord };
      if (data.video) onVideoUpdate?.(data.video);
      else onVideoUpdate?.({ ...video, reportType: next });
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className={
        compact
          ? "rounded-xl border border-ink-200/80 bg-white/90 p-3 space-y-2"
          : "rounded-2xl border border-ink-200 bg-white/80 p-4 sm:p-5 space-y-3"
      }
    >
      <h3
        className={
          compact
            ? "text-sm font-medium text-ink-800"
            : "font-display text-lg sm:text-xl"
        }
      >
        보고서 유형
      </h3>
      <p className="text-xs sm:text-sm text-ink-500">
        팩트체크 완료 후 이 유형으로 보고서(3번)를 작성합니다. (자동 추천:{" "}
        {REPORT_TYPE_LABELS[video.reportType]})
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {(["H", "S", "C", "P"] as ReportType[]).map((t) => (
          <button
            key={t}
            type="button"
            disabled={saving}
            onClick={() => save(t)}
            className={`min-h-11 rounded-xl border px-2 py-2 text-sm font-medium transition-colors ${
              type === t
                ? "border-accent bg-accent-muted text-ink-900"
                : "border-ink-200 bg-white text-ink-600"
            }`}
          >
            {REPORT_TYPE_LABELS[t]}
          </button>
        ))}
      </div>
      {!compact && (
        <ul className="text-xs text-ink-500 space-y-1 pt-1">
          {REPORT_TYPE_STRUCTURE[type].map((h) => (
            <li key={h}>· {h}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
