"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import type { VideoRecord } from "@/lib/types";
import { canExportArtifacts } from "@/lib/factcheck-client";
import { isReportInput } from "@/lib/input-mode";
import { isReportInputDraft, libraryCardLabel, libraryStage } from "@/lib/library";
import { ReportActions } from "@/components/ReportActions";
import { formatDistanceToNow } from "date-fns";
import { ko } from "date-fns/locale";

export type VideoListKind = "draft" | "report-pending" | "report-complete";

export function VideoListCard({
  video,
  listKind,
}: {
  video: VideoRecord;
  listKind: VideoListKind;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const stage = libraryStage(video);
  const ready = canExportArtifacts(video);
  const inputDraft = isReportInputDraft(video);

  async function remove(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`「${video.title}」을(를) 삭제할까요?`)) return;
    setBusy(true);
    try {
      await fetch(`/api/videos/${video.id}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const btn =
    "inline-flex items-center justify-center gap-1 min-h-9 rounded-lg border px-2.5 text-xs font-medium transition-colors";

  return (
    <article className="overflow-hidden rounded-2xl border border-ink-200 bg-white/90 hover:border-accent/40 hover:shadow-md transition-all">
      <a
        href={
          listKind === "report-complete"
            ? `/videos/${video.id}#report`
            : `/videos/${video.id}`
        }
        className="block group"
      >
        <div className="aspect-video overflow-hidden bg-ink-900">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={video.thumbnailUrl}
            alt=""
            className="h-full w-full object-cover opacity-95 group-hover:scale-[1.03] transition-transform duration-500"
          />
        </div>
        <div className="p-4">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span
              className={`text-xs px-2 py-0.5 rounded-md ${
                stage === "complete"
                  ? "bg-verify-true/10 text-verify-true"
                  : stage === "report_pending"
                    ? "bg-ink-900 text-white"
                    : stage === "report_input_draft"
                      ? "bg-amber-100 text-amber-900"
                      : stage === "factcheck_draft"
                      ? "bg-accent-muted text-accent"
                      : stage === "error"
                        ? "bg-verify-false/10 text-verify-false"
                        : "bg-ink-100 text-ink-600"
              }`}
            >
              {libraryCardLabel(video)}
            </span>
            {isReportInput(video) && (
              <span className="text-xs px-2 py-0.5 rounded-md bg-ink-900/90 text-white">
                Report
              </span>
            )}
            <span className="text-xs text-ink-400">
              {formatDistanceToNow(new Date(video.updatedAt), {
                addSuffix: true,
                locale: ko,
              })}
            </span>
          </div>
          <h3 className="font-medium text-ink-900 line-clamp-2 group-hover:text-accent transition-colors">
            {video.title}
          </h3>
          <p className="text-sm text-ink-500 mt-1">{video.channel}</p>
          <p className="text-xs text-ink-400 mt-2">
            {inputDraft
              ? `스크립트 ${(video.transcript?.length ?? 0).toLocaleString()}자 · 입력 중`
              : `항목 ${video.items.length} · 검증 ${video.factChecks.length}${
                  listKind === "draft" &&
                  video.status === "awaiting_factcheck"
                    ? " · 팩트체크 진행 중"
                    : ""
                }`}
          </p>
        </div>
      </a>

      <div className="px-4 pb-4 flex flex-wrap gap-2 border-t border-ink-100 pt-3">
        {listKind === "report-complete" && ready ? (
          <ReportActions video={video} compact />
        ) : (
          <>
            {listKind === "report-pending" && (
              <a
                href={`/videos/${video.id}#complete-report`}
                className={`${btn} border-ink-900 bg-ink-900 text-white hover:opacity-90`}
              >
                보고서 저장
              </a>
            )}
            {listKind === "draft" && (
              <a
                href={`/videos/${video.id}`}
                className={`${btn} ${
                  inputDraft
                    ? "border-accent/40 bg-accent-muted/40 text-ink-900 hover:bg-accent-muted"
                    : "border-ink-900 bg-ink-900 text-white hover:opacity-90"
                }`}
              >
                {inputDraft ? "이어서 작성" : "이어서 하기"}
              </a>
            )}
          </>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={remove}
          className={`${btn} border-verify-false/30 text-verify-false hover:bg-verify-false/5`}
        >
          <Trash2 className="h-3.5 w-3.5" />
          삭제
        </button>
      </div>
    </article>
  );
}
