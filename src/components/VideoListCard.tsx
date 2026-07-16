"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Eye,
  FileDown,
  Pencil,
  Share2,
  Trash2,
} from "lucide-react";
import type { VideoRecord } from "@/lib/types";
import { libraryCardLabel, libraryStage } from "@/lib/library";
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
  const ready = video.status === "ready" && video.report && video.infographic;

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

  async function share(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const url = `${window.location.origin}/videos/${video.id}#report`;
    const text = `[FactCheck] ${video.title}`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: video.title,
          text,
          url,
        });
        return;
      }
      await navigator.clipboard.writeText(url);
      alert("링크를 복사했습니다.");
    } catch {
      /* cancelled */
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
                    : stage === "factcheck_draft"
                      ? "bg-accent-muted text-accent"
                      : stage === "error"
                        ? "bg-verify-false/10 text-verify-false"
                        : "bg-ink-100 text-ink-600"
              }`}
            >
              {libraryCardLabel(video)}
            </span>
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
            항목 {video.items.length} · 검증 {video.factChecks.length}
            {listKind === "draft" &&
              video.status === "awaiting_factcheck" &&
              ` · 팩트체크 진행 중`}
          </p>
        </div>
      </a>

      <div className="px-4 pb-4 flex flex-wrap gap-2 border-t border-ink-100 pt-3">
        {listKind === "report-complete" && ready && (
          <a
            href={`/videos/${video.id}#report`}
            className={`${btn} border-accent/40 bg-accent-muted/40 text-ink-900 hover:bg-accent-muted`}
          >
            <Eye className="h-3.5 w-3.5" />
            보기
          </a>
        )}
        <a
          href={`/videos/${video.id}`}
          className={`${btn} border-ink-200 bg-white hover:border-accent text-ink-700`}
        >
          <Pencil className="h-3.5 w-3.5" />
          수정
        </a>
        <button
          type="button"
          disabled={busy}
          onClick={remove}
          className={`${btn} border-verify-false/30 text-verify-false hover:bg-verify-false/5`}
        >
          <Trash2 className="h-3.5 w-3.5" />
          삭제
        </button>
        {listKind !== "draft" && (
          <button
            type="button"
            onClick={share}
            className={`${btn} border-ink-200 bg-white hover:border-accent text-ink-700`}
          >
            <Share2 className="h-3.5 w-3.5" />
            공유
          </button>
        )}
        {listKind === "report-complete" && ready && (
          <a
            href={`/api/videos/${video.id}/pdf?t=${encodeURIComponent(video.updatedAt)}`}
            onClick={(e) => e.stopPropagation()}
            className={`${btn} border-ink-200 bg-white hover:border-accent text-ink-700`}
          >
            <FileDown className="h-3.5 w-3.5" />
            PDF 저장
          </a>
        )}
      </div>
    </article>
  );
}
