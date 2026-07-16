"use client";

import { CheckCircle2, Loader2, Pencil, Sparkles, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { VideoRecord } from "@/lib/types";

const SOURCE_UI: Record<
  NonNullable<VideoRecord["summarySource"]>,
  { label: string; hint: string; ai: boolean; className: string }
> = {
  ai: {
    label: "AI API 요약",
    hint: "OpenAI API로 생성한 상세 요약입니다.",
    ai: true,
    className: "bg-emerald-50 text-emerald-800 border-emerald-200",
  },
  manual: {
    label: "수동 입력 요약",
    hint: "직접 작성한 요약입니다. 「완료」를 누르면 팩트체크·보고서에 반영됩니다.",
    ai: false,
    className: "bg-sky-50 text-sky-900 border-sky-200",
  },
  fallback: {
    label: "AI 요약 아님 (폴백)",
    hint: "API 키 없음·오류 등으로 짧은 발췌만 있습니다. 아래에서 수동 입력하거나 재요약하세요.",
    ai: false,
    className: "bg-amber-50 text-amber-900 border-amber-200",
  },
  none: {
    label: "요약 없음",
    hint: "아직 요약이 없습니다. AI 재요약 또는 수동 입력을 하세요.",
    ai: false,
    className: "bg-ink-50 text-ink-700 border-ink-200",
  },
};

/** 유튜브 내용 요약: 수동 수정 후 완료 → FC·보고서 자동 갱신 */
export function OverviewSummaryPanel({ video }: { video: VideoRecord }) {
  const router = useRouter();
  const source = video.summarySource ?? "none";
  const ui = SOURCE_UI[source] ?? SOURCE_UI.none;
  const needsManual = !ui.ai;

  const [editing, setEditing] = useState(needsManual && !video.overview.trim());
  const [draft, setDraft] = useState(video.overview || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const charCount = useMemo(() => draft.trim().length, [draft]);

  async function completeManualOverview() {
    setError(null);
    setHint(null);
    if (draft.trim().length < 40) {
      setError("요약을 40자 이상 입력해 주세요.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/videos/${video.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updateOverview: {
            overview: draft.trim(),
            complete: true,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "완료 처리 실패");
      const n = data.progress?.total ?? data.video?.items?.length ?? 0;
      setHint(
        `요약 완료. 팩트체크 ${n}건·보고서를 새 요약에 맞춰 자동 갱신했습니다.`
      );
      setEditing(false);
      router.refresh();
      window.setTimeout(() => {
        document
          .getElementById("manual-factcheck")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
        if (!document.getElementById("manual-factcheck")) {
          document
            .getElementById("report")
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }, 250);
    } catch (e) {
      setError(e instanceof Error ? e.message : "완료 처리 실패");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium ${ui.className}`}
      >
        {ui.ai ? (
          <Sparkles className="h-3.5 w-3.5" />
        ) : (
          <UserRound className="h-3.5 w-3.5" />
        )}
        {ui.label}
      </div>
      <p className="text-xs text-ink-500">{ui.hint}</p>

      {!editing ? (
        <>
          <div className="text-ink-800 leading-relaxed whitespace-pre-wrap text-[15px]">
            {video.overview?.trim() || "요약 내용이 없습니다."}
          </div>
          {hint && (
            <p className="text-sm text-emerald-700" role="status">
              {hint}
            </p>
          )}
          {(needsManual || source === "ai" || source === "manual") && (
            <button
              type="button"
              onClick={() => {
                setDraft(video.overview || "");
                setEditing(true);
                setError(null);
                setHint(null);
              }}
              className="inline-flex items-center gap-1.5 min-h-10 rounded-lg border border-ink-200 bg-white px-3 text-xs font-medium hover:border-accent"
            >
              <Pencil className="h-3.5 w-3.5" />
              {needsManual ? "수동으로 요약 입력·수정" : "요약 수정"}
            </button>
          )}
        </>
      ) : (
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={14}
            placeholder={`예시 형식:\n1. 대주제 제목\n• 소주제: 상세 설명…\n\n최종 결론\n…`}
            className="w-full rounded-xl border border-ink-200 bg-white px-3 py-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
          <p className="text-xs text-ink-500">{charCount.toLocaleString()}자</p>
          <p className="text-xs text-ink-600 leading-relaxed rounded-lg bg-ink-50 border border-ink-100 px-3 py-2">
            <strong>완료</strong>를 누르면 이 요약을 저장하고, 팩트체크 항목과
            보고서를 새 요약에 맞춰 자동으로 다시 만듭니다.
          </p>
          {error && (
            <p className="text-sm text-verify-false" role="alert">
              {error}
            </p>
          )}
          {hint && (
            <p className="text-sm text-emerald-700" role="status">
              {hint}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void completeManualOverview()}
              className="inline-flex items-center gap-1.5 min-h-10 rounded-xl bg-ink-900 px-4 text-sm font-medium text-white hover:bg-accent disabled:opacity-60"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              {saving ? "반영 중…" : "완료"}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setEditing(false);
                setDraft(video.overview || "");
                setError(null);
              }}
              className="inline-flex items-center min-h-10 rounded-xl border border-ink-200 px-4 text-sm font-medium"
            >
              취소
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
