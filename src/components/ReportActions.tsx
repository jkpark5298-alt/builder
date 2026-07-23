"use client";

import {
  Eye,
  FileDown,
  ImagePlus,
  Loader2,
  Pencil,
  Printer,
  Share2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { VideoRecord } from "@/lib/types";
import { canExportArtifacts } from "@/lib/factcheck-client";
import { compressImageFiles } from "@/lib/image-client";
import { uploadDataUrls } from "@/lib/media-upload-client";

/** 완료 보고서용: 표지 변경 / 보기 / 수정 / 공유 / PDF·인쇄 */
export function ReportActions({
  video,
  compact = false,
}: {
  video: VideoRecord;
  compact?: boolean;
}) {
  const router = useRouter();
  const ready = canExportArtifacts(video);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [sharing, setSharing] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);

  if (!ready) return null;

  const viewHref = `/videos/${video.id}#report`;
  const editHref = `/videos/${video.id}#report-edit`;
  const coverHref = `/videos/${video.id}#cover`;
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
    if (!window.location.pathname.includes(`/videos/${video.id}`)) {
      router.push(`/videos/${video.id}?print=1#report`);
      return;
    }
    const el = document.getElementById("report");
    el?.scrollIntoView({ behavior: "auto", block: "start" });
    window.setTimeout(() => window.print(), 200);
  }

  function startEdit(e: React.MouseEvent) {
    e.preventDefault();
    try {
      sessionStorage.setItem(`edit-report:${video.id}`, "1");
    } catch {
      /* ignore */
    }
    window.dispatchEvent(
      new CustomEvent("factcheck:edit-report", { detail: { id: video.id } })
    );
    if (window.location.pathname.includes(`/videos/${video.id}`)) {
      window.location.hash = "report-edit";
      document.getElementById("report")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    } else {
      router.push(editHref);
    }
  }

  /** 목록에서도 바로 표지 교체 / 상세면 #cover로 이동 */
  function openCoverEditor(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (window.location.pathname.includes(`/videos/${video.id}`)) {
      window.location.hash = "cover";
      document.getElementById("cover")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      return;
    }
    // 라이브러리 카드: 파일 선택으로 바로 변경
    coverInputRef.current?.click();
  }

  async function onCoverPick(files: FileList | null) {
    const file = files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    setCoverBusy(true);
    try {
      const compressed = await compressImageFiles([file]);
      if (!compressed.length) throw new Error("이미지를 읽지 못했습니다.");
      const uploaded = await uploadDataUrls(
        compressed,
        `videos/${video.id}/thumb`
      );
      if (!uploaded[0]) throw new Error("업로드 실패");
      const res = await fetch(`/api/videos/${video.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updateThumbnail: { thumbnailUrl: uploaded[0] },
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "표지 저장 실패");
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "표지 이미지 변경 실패");
    } finally {
      setCoverBusy(false);
      if (coverInputRef.current) coverInputRef.current.value = "";
    }
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
      <input
        ref={coverInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void onCoverPick(e.target.files)}
      />
      <button
        type="button"
        disabled={coverBusy}
        onClick={openCoverEditor}
        title="목록·상세 상단 표지 이미지 변경"
        className={`${btn} ${primary}`}
      >
        {coverBusy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
        ) : (
          <ImagePlus className="h-3.5 w-3.5 shrink-0" />
        )}
        초기 화면
      </button>
      <a href={viewHref} className={`${btn} ${enabled}`}>
        <Eye className="h-3.5 w-3.5 shrink-0" />
        보기
      </a>
      <button type="button" onClick={startEdit} className={`${btn} ${enabled}`}>
        <Pencil className="h-3.5 w-3.5 shrink-0" />
        수정
      </button>
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
      {!compact && (
        <a href={coverHref} className="sr-only">
          표지 편집
        </a>
      )}
    </div>
  );
}
