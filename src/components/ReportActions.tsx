"use client";

import {
  Eye,
  FileDown,
  Loader2,
  Pencil,
  Printer,
  Share2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { VideoRecord } from "@/lib/types";
import { canExportArtifacts } from "@/lib/factcheck-client";

/** 완료 보고서용: 보기 / 수정 / 공유 / PDF·인쇄 */
export function ReportActions({
  video,
  compact = false,
}: {
  video: VideoRecord;
  compact?: boolean;
}) {
  const router = useRouter();
  const ready = canExportArtifacts(video);
  const [sharing, setSharing] = useState(false);

  if (!ready) return null;

  const viewHref = `/videos/${video.id}#report`;
  const editHref = `/videos/${video.id}#report`;
  const pdfHref = `/api/videos/${video.id}/pdf?t=${encodeURIComponent(video.updatedAt)}`;

  async function share() {
    setSharing(true);
    const url = `${window.location.origin}${viewHref}`;
    const text = `[FactCheck] ${video.title}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: video.title, text, url });
      } else {
        await navigator.clipboard.writeText(url);
        alert("보고서 링크를 복사했습니다.");
      }
    } catch {
      /* cancelled */
    } finally {
      setSharing(false);
    }
  }

  function printReport() {
    // 상세 페이지면 보고서 섹션 스크롤 후 인쇄
    if (!window.location.pathname.includes(`/videos/${video.id}`)) {
      router.push(`/videos/${video.id}?print=1#report`);
      return;
    }
    const el = document.getElementById("report");
    el?.scrollIntoView({ behavior: "instant", block: "start" });
    window.setTimeout(() => window.print(), 200);
  }

  const btn = compact
    ? "inline-flex items-center justify-center gap-1 min-h-9 rounded-lg border px-2.5 text-xs font-medium transition-colors"
    : "inline-flex items-center justify-center gap-2 min-h-11 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors";
  const enabled =
    "border-ink-200 bg-white hover:border-accent hover:text-accent active:bg-ink-50 text-ink-700";
  const primary =
    "border-accent/40 bg-accent-muted/40 text-ink-900 hover:bg-accent-muted";

  return (
    <div className={`flex flex-wrap gap-2 ${compact ? "" : "w-full"}`}>
      <a href={viewHref} className={`${btn} ${primary}`}>
        <Eye className="h-3.5 w-3.5 shrink-0" />
        보기
      </a>
      <a
        href={editHref}
        className={`${btn} ${enabled}`}
        onClick={() => {
          // 수정 모드 힌트 — EditableReportPanel이 hash 변경을 감지
          if (typeof window !== "undefined") {
            sessionStorage.setItem(`edit-report:${video.id}`, "1");
          }
        }}
      >
        <Pencil className="h-3.5 w-3.5 shrink-0" />
        수정
      </a>
      <button
        type="button"
        disabled={sharing}
        onClick={() => void share()}
        className={`${btn} ${enabled}`}
      >
        {sharing ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Share2 className="h-3.5 w-3.5 shrink-0" />
        )}
        공유
      </button>
      <a href={pdfHref} className={`${btn} ${enabled}`}>
        <FileDown className="h-3.5 w-3.5 shrink-0" />
        PDF 저장
      </a>
      <button type="button" onClick={printReport} className={`${btn} ${enabled}`}>
        <Printer className="h-3.5 w-3.5 shrink-0" />
        인쇄
      </button>
    </div>
  );
}
