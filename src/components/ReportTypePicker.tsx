"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ReportType, VideoRecord } from "@/lib/types";
import {
  REPORT_TYPE_HINTS,
  REPORT_TYPE_LABELS,
  REPORT_TYPE_STRUCTURE,
} from "@/lib/types";

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
      <div className="space-y-1">
        <h3
          className={
            compact
              ? "text-sm font-medium text-ink-800"
              : "font-display text-lg sm:text-xl"
          }
        >
          보고서 유형
        </h3>
        <details className="group">
          <summary className="cursor-pointer select-none text-xs text-ink-500 hover:text-ink-800 list-none inline-flex items-center gap-1 [&::-webkit-details-marker]:hidden">
            <span className="text-[10px] leading-none group-open:rotate-90 transition-transform">
              ▶
            </span>
            설명 보기
          </summary>
          <div className="mt-1.5 rounded-lg border border-ink-100 bg-ink-50/80 px-2.5 py-2 space-y-1.5">
            <p className="text-xs text-ink-700 leading-relaxed">
              <span className="font-medium text-ink-900">
                {REPORT_TYPE_LABELS[type]}
              </span>
              {" — "}
              {REPORT_TYPE_HINTS[type]}
            </p>
            <ul className="text-[11px] text-ink-500 space-y-0.5">
              {REPORT_TYPE_STRUCTURE[type].map((h) => (
                <li key={h}>· {h}</li>
              ))}
            </ul>
          </div>
        </details>
      </div>
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
    </div>
  );
}
