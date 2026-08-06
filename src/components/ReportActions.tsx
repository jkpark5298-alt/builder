"use client";

import {
  CheckCircle2,
  ClipboardCopy,
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
import {
  downloadReportPdfFromDom,
  prepareReportForPrint,
} from "@/lib/report-dom-export";
import {
  formatFactChecksText,
  formatReportText,
  formatReportWithFactChecksText,
} from "@/lib/report";

/** 완료 보고서용: 표지 변경 / 보기 / 본문 수정 / 공유 / PDF·인쇄 */
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
  const [pdfBusy, setPdfBusy] = useState(false);
  const [printBusy, setPrintBusy] = useState(false);

  if (!ready) return null;
  const report = video.report;
  if (!report) return null;
  const readyReport = report;

  const viewHref = `/videos/${video.id}#report`;
  const editHref = `/videos/${video.id}#report-edit`;
  const fcHref = `/videos/${video.id}#report-fc`;
  const coverHref = `/videos/${video.id}#cover`;

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

  async function copyText(kind: "report" | "factchecks" | "all") {
    const text =
      kind === "report"
        ? formatReportText(readyReport)
        : kind === "factchecks"
          ? formatFactChecksText(readyReport)
          : formatReportWithFactChecksText(readyReport);
    if (!text.trim()) {
      alert("복사할 텍스트가 없습니다.");
      return;
    }
    await navigator.clipboard.writeText(text);
    alert(
      kind === "report"
        ? "보고서 텍스트를 복사했습니다."
        : kind === "factchecks"
          ? "팩트체크 텍스트를 복사했습니다."
          : "보고서+팩트체크 텍스트를 복사했습니다."
    );
  }

  async function printReport() {
    if (!window.location.pathname.includes(`/videos/${video.id}`)) {
      router.push(`/videos/${video.id}?print=1#report`);
      return;
    }
    setPrintBusy(true);
    try {
      await prepareReportForPrint(video.id);
      window.print();
    } finally {
      setPrintBusy(false);
    }
  }

  async function savePdf() {
    const onReportPage =
      typeof window !== "undefined" &&
      window.location.pathname.includes(`/videos/${video.id}`) &&
      Boolean(document.getElementById("report-body-export") || document.getElementById("report"));
    // 목록 등 보고서 DOM이 없으면 서버 PDF(본문 S 순서 반영)로 폴백
    if (!onReportPage) {
      window.location.href = `/api/videos/${video.id}/pdf?t=${encodeURIComponent(video.updatedAt)}`;
      return;
    }
    setPdfBusy(true);
    try {
      await downloadReportPdfFromDom({
        videoId: video.id,
        fileName: `factcheck-${video.videoId}.pdf`,
      });
    } catch (e) {
      console.error(e);
      // DOM 캡처 실패 시 서버 PDF
      window.location.href = `/api/videos/${video.id}/pdf?t=${encodeURIComponent(video.updatedAt)}`;
    } finally {
      setPdfBusy(false);
    }
  }

  function startEdit(e: React.MouseEvent) {
    e.preventDefault();
    try {
      sessionStorage.setItem(`edit-report:${video.id}`, "1");
    } catch {
      /* ignore */
    }
    window.dispatchEvent(
      new CustomEvent("factcheck:edit-report", {
        detail: { id: video.id, mode: "body" },
      })
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

  function startFactcheck(e: React.MouseEvent) {
    e.preventDefault();
    try {
      sessionStorage.setItem(`edit-fc:${video.id}`, "1");
    } catch {
      /* ignore */
    }
    window.dispatchEvent(
      new CustomEvent("factcheck:edit-report", {
        detail: { id: video.id, mode: "factcheck" },
      })
    );
    if (window.location.pathname.includes(`/videos/${video.id}`)) {
      window.location.hash = "report-fc";
      document.getElementById("report")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    } else {
      router.push(fcHref);
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
        표지
      </button>
      <a href={viewHref} className={`${btn} ${enabled}`}>
        <Eye className="h-3.5 w-3.5 shrink-0" />
        보기
      </a>
      <button type="button" onClick={startEdit} className={`${btn} ${enabled}`}>
        <Pencil className="h-3.5 w-3.5 shrink-0" />
        본문
      </button>
      <button
        type="button"
        onClick={startFactcheck}
        className={`${btn} ${enabled}`}
      >
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        팩트체크
      </button>
      <button
        type="button"
        onClick={() => void copyText("report")}
        className={`${btn} ${enabled}`}
      >
        <ClipboardCopy className="h-3.5 w-3.5 shrink-0" />
        보고서 text
      </button>
      <button
        type="button"
        onClick={() => void copyText("factchecks")}
        className={`${btn} ${enabled}`}
      >
        <ClipboardCopy className="h-3.5 w-3.5 shrink-0" />
        팩트체크 text
      </button>
      <button
        type="button"
        onClick={() => void copyText("all")}
        className={`${btn} ${enabled}`}
      >
        <ClipboardCopy className="h-3.5 w-3.5 shrink-0" />
        전체 text
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
      <button
        type="button"
        disabled={pdfBusy}
        onClick={() => void savePdf()}
        title="보기 본문과 동일한 형식의 PDF"
        className={`${btn} ${enabled}`}
      >
        {pdfBusy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
        ) : (
          <FileDown className="h-3.5 w-3.5 shrink-0" />
        )}
        {pdfBusy ? "PDF 만드는 중…" : "PDF 저장"}
      </button>
      <button
        type="button"
        disabled={printBusy}
        onClick={() => void printReport()}
        className={`${btn} ${enabled}`}
      >
        {printBusy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
        ) : (
          <Printer className="h-3.5 w-3.5 shrink-0" />
        )}
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
