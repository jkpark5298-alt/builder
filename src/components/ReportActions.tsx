"use client";

import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ClipboardCopy,
  Eye,
  FileDown,
  FileText,
  ImagePlus,
  Loader2,
  Mail,
  MessageCircle,
  Pencil,
  Printer,
  Share2,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { VideoRecord } from "@/lib/types";
import { canExportArtifacts } from "@/lib/factcheck-client";
import { isFactCheckPass, reportDocumentTitle } from "@/lib/input-mode";
import { compressImageFiles } from "@/lib/image-client";
import { uploadDataUrls } from "@/lib/media-upload-client";
import {
  downloadReportPdfFromDom,
  prepareReportForPrint,
  shareReportPdfToGoodNotes,
} from "@/lib/report-dom-export";
import { shareOrDownloadReportDocx } from "@/lib/report-docx";
import {
  formatFactChecksText,
  formatReportText,
  formatReportWithFactChecksText,
} from "@/lib/report";
import { buildInfDocxFileName, buildInfPdfFileName } from "@/lib/pdf-filename";
import { isIosLikeDevice } from "@/lib/device";

type ActionGroup = "view" | "copy" | "export" | "share";

declare global {
  interface Window {
    Kakao?: {
      isInitialized: () => boolean;
      init: (key: string) => void;
      Share: {
        sendDefault: (opts: Record<string, unknown>) => void;
      };
    };
  }
}

/**
 * 완료 보고서 작업 버튼.
 * 같은 종류는 그룹으로 묶고, 그룹을 누르면 세부 항목이 펼쳐집니다.
 * (PDF·인쇄·공유 중복 없음)
 */
export function ReportActions({
  video,
  compact = false,
  /** 이메일·카톡·굿노트·삭제 포함 (상세 ActionBar용) */
  includeManage = false,
}: {
  video: VideoRecord;
  compact?: boolean;
  includeManage?: boolean;
}) {
  const router = useRouter();
  const ready = canExportArtifacts(video);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [openGroup, setOpenGroup] = useState<ActionGroup | null>(
    compact ? null : "view"
  );
  const [sharing, setSharing] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [docxBusy, setDocxBusy] = useState<"pages" | "word" | null>(null);
  const [printBusy, setPrintBusy] = useState(false);
  const [goodnotesBusy, setGoodnotesBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const hideFactCheck = isFactCheckPass(video);
  const kakaoConfigured = Boolean(process.env.NEXT_PUBLIC_KAKAO_JS_KEY);
  const iosLike =
    typeof navigator !== "undefined" ? isIosLikeDevice() : false;

  if (!ready) return null;
  const report = video.report;
  if (!report) return null;
  const readyReport = report;

  const viewHref = `/videos/${video.id}#report`;
  const editHref = `/videos/${video.id}#report-edit`;
  const fcHref = `/videos/${video.id}#report-fc`;

  function toggleGroup(id: ActionGroup) {
    setOpenGroup((prev) => (prev === id ? null : id));
  }

  async function shareLink() {
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
      kind === "report" || hideFactCheck
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
          : hideFactCheck
            ? "전체 텍스트를 복사했습니다."
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
    if (!video.report) {
      window.location.href = `/api/videos/${video.id}/pdf?t=${encodeURIComponent(video.updatedAt)}`;
      return;
    }
    setPdfBusy(true);
    try {
      await downloadReportPdfFromDom({
        videoId: video.id,
        fileName: buildInfPdfFileName({
          title:
            video.report?.meta.title?.trim() ||
            video.title ||
            reportDocumentTitle(video),
          writtenAt: video.report?.meta.writtenAt || video.updatedAt,
        }),
        report: video.report,
      });
    } catch (e) {
      console.error(e);
      window.location.href = `/api/videos/${video.id}/pdf?t=${encodeURIComponent(video.updatedAt)}`;
    } finally {
      setPdfBusy(false);
    }
  }

  async function exportDocx(mode: "pages" | "word") {
    if (!video.report) {
      alert("저장할 보고서가 없습니다.");
      return;
    }
    const appLabel = mode === "pages" ? "Pages" : "Word";
    setDocxBusy(mode);
    try {
      const fileName = buildInfDocxFileName({
        title:
          video.report.meta.title?.trim() ||
          video.title ||
          reportDocumentTitle(video),
        writtenAt: video.report.meta.writtenAt || video.updatedAt,
      });
      // Word·Pages 동일 문서(PDF와 같은 규격). 앱만 다르게 열어 PDF로 저장.
      const result = await shareOrDownloadReportDocx({
        report: video.report,
        extraImages: video.articleImages,
        fileName,
        title: video.title,
        preferShare: iosLike,
        shareText: iosLike
          ? `① ${appLabel}로 열기 → ② 수정 → ③ 공유에서 PDF로 내보내기`
          : undefined,
      });
      if (iosLike && result === "downloaded") {
        alert(
          [
            "PDF와 같은 규격의 문서입니다.",
            "",
            "1. 파일 앱에서 방금 받은 문서를 엽니다",
            `2. ${appLabel}로 열기 → 수정`,
            "3. 공유(□↑) → PDF로 내보내기",
          ].join("\n")
        );
      }
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      console.error(e);
      alert(
        e instanceof Error
          ? e.message
          : `${appLabel} 문서 준비에 실패했습니다. 잠시 후 다시 시도해 주세요.`
      );
    } finally {
      setDocxBusy(null);
    }
  }

  async function shareGoodNotes() {
    setGoodnotesBusy(true);
    try {
      const onReportPage =
        typeof window !== "undefined" &&
        window.location.pathname.includes(`/videos/${video.id}`) &&
        Boolean(
          document.getElementById("report-body-export") ||
            document.getElementById("report")
        );
      if (!onReportPage) {
        router.push(`/videos/${video.id}#report`);
        alert(
          "보고서 상세에서 「굿노트 공유」를 누르면 본문 PDF를 공유합니다."
        );
        return;
      }
      const result = await shareReportPdfToGoodNotes({
        videoId: video.videoId,
        title: video.title,
        report: video.report,
        fileName: buildInfPdfFileName({
          title:
            video.report?.meta.title?.trim() ||
            video.title ||
            reportDocumentTitle(video),
          writtenAt: video.report?.meta.writtenAt || video.updatedAt,
        }),
      });
      await fetch(`/api/videos/${video.id}/infographic`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: "goodnotes" }),
      });
      if (result === "downloaded") {
        alert(
          "보고서 PDF를 저장했습니다.\nGoodnotes 앱에서 열어 필기하세요."
        );
      }
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      alert(
        e instanceof Error
          ? e.message
          : "굿노트 공유에 실패했습니다. PDF 저장 후 Goodnotes에서 열어 주세요."
      );
    } finally {
      setGoodnotesBusy(false);
    }
  }

  function shareEmail() {
    const subject = encodeURIComponent(`[FactCheck] ${video.title}`);
    const body = encodeURIComponent(
      [
        video.title,
        video.channel,
        video.youtubeUrl,
        "",
        video.overview,
        "",
        `상세: ${window.location.href}`,
        `PDF: ${window.location.origin}/api/videos/${video.id}/pdf?t=${encodeURIComponent(video.updatedAt)}`,
      ].join("\n")
    );
    void fetch(`/api/videos/${video.id}/infographic`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel: "email" }),
    });
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  }

  async function shareKakao() {
    const key = process.env.NEXT_PUBLIC_KAKAO_JS_KEY;
    if (!key) {
      alert(
        "카카오톡 공유를 쓰려면 NEXT_PUBLIC_KAKAO_JS_KEY를 .env.local에 설정하세요."
      );
      return;
    }
    if (!window.Kakao) await loadKakaoSdk();
    if (window.Kakao && !window.Kakao.isInitialized()) {
      window.Kakao.init(key);
    }
    const origin = window.location.origin;
    window.Kakao?.Share.sendDefault({
      objectType: "feed",
      content: {
        title: video.title,
        description: video.overview.slice(0, 120),
        imageUrl: video.thumbnailUrl,
        link: {
          mobileWebUrl: window.location.href,
          webUrl: window.location.href,
        },
      },
      buttons: [
        {
          title: "보고서 보기",
          link: {
            mobileWebUrl: `${origin}/videos/${video.id}#report`,
            webUrl: `${origin}/videos/${video.id}#report`,
          },
        },
      ],
    });
    void fetch(`/api/videos/${video.id}/infographic`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel: "kakao" }),
    });
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

  async function remove() {
    if (!confirm("이 항목을 삭제할까요?")) return;
    setDeleteBusy(true);
    try {
      await fetch(`/api/videos/${video.id}`, { method: "DELETE" });
      router.push("/");
      router.refresh();
    } finally {
      setDeleteBusy(false);
    }
  }

  const btn = compact
    ? "inline-flex items-center justify-center gap-1 min-h-9 rounded-lg border px-2.5 text-xs font-medium transition-colors"
    : "inline-flex items-center justify-center gap-2 min-h-11 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors";
  const enabled =
    "border-ink-200 bg-white hover:border-accent hover:text-accent active:bg-ink-50 text-ink-700";
  const primary =
    "border-accent/40 bg-accent-muted/40 text-ink-900 hover:bg-accent-muted";
  const groupTab = (id: ActionGroup) =>
    `${btn} ${
      openGroup === id
        ? "border-accent/50 bg-accent-muted/50 text-ink-900"
        : enabled
    }`;

  const groups: Array<{
    id: ActionGroup;
    label: string;
    show: boolean;
  }> = [
    { id: "view", label: "보기·편집", show: true },
    { id: "copy", label: "텍스트 복사", show: true },
    { id: "export", label: iosLike ? "PDF·Word·Pages" : "PDF·Word·인쇄", show: true },
    { id: "share", label: "공유", show: true },
  ];

  return (
    <div className={`space-y-2 ${compact ? "" : "w-full"}`}>
      <input
        ref={coverInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void onCoverPick(e.target.files)}
      />

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="보고서 작업">
        {groups
          .filter((g) => g.show)
          .map((g) => (
            <button
              key={g.id}
              type="button"
              role="tab"
              aria-selected={openGroup === g.id}
              aria-expanded={openGroup === g.id}
              onClick={() => toggleGroup(g.id)}
              className={groupTab(g.id)}
            >
              {g.label}
              <ChevronDown
                className={`h-3.5 w-3.5 shrink-0 transition-transform ${
                  openGroup === g.id ? "rotate-180" : ""
                }`}
              />
            </button>
          ))}
        {includeManage && (
          <button
            type="button"
            disabled={deleteBusy}
            onClick={() => void remove()}
            className={`${btn} border-verify-false/30 bg-white text-verify-false hover:bg-verify-false/5`}
          >
            {deleteBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
            ) : (
              <Trash2 className="h-3.5 w-3.5 shrink-0" />
            )}
            삭제
          </button>
        )}
      </div>

      {openGroup === "view" && (
        <div className="flex flex-wrap gap-2 rounded-xl border border-ink-100 bg-ink-50/60 p-2">
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
          <button
            type="button"
            onClick={startEdit}
            className={`${btn} ${enabled}`}
          >
            <Pencil className="h-3.5 w-3.5 shrink-0" />
            본문
          </button>
          {!hideFactCheck && (
            <button
              type="button"
              onClick={startFactcheck}
              className={`${btn} ${enabled}`}
            >
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              팩트체크
            </button>
          )}
        </div>
      )}

      {openGroup === "copy" && (
        <div className="flex flex-wrap gap-2 rounded-xl border border-ink-100 bg-ink-50/60 p-2">
          <button
            type="button"
            onClick={() => void copyText("report")}
            className={`${btn} ${enabled}`}
          >
            <ClipboardCopy className="h-3.5 w-3.5 shrink-0" />
            보고서 text
          </button>
          {!hideFactCheck && (
            <button
              type="button"
              onClick={() => void copyText("factchecks")}
              className={`${btn} ${enabled}`}
            >
              <ClipboardCopy className="h-3.5 w-3.5 shrink-0" />
              팩트체크 text
            </button>
          )}
          <button
            type="button"
            onClick={() => void copyText("all")}
            className={`${btn} ${enabled}`}
          >
            <ClipboardCopy className="h-3.5 w-3.5 shrink-0" />
            전체 text
          </button>
        </div>
      )}

      {openGroup === "export" && (
        <div className="space-y-2 rounded-xl border border-ink-100 bg-ink-50/60 p-2">
          {iosLike ? (
            <p className="px-1 text-xs leading-relaxed text-ink-500">
              iPhone:{" "}
              <span className="font-medium text-ink-700">Word</span>·
              <span className="font-medium text-ink-700">Pages</span> 모두
              PDF와 같은 규격 → 열어 수정한 뒤 PDF로 저장
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pdfBusy}
              onClick={() => void savePdf()}
              title="읽기 도구와 같은 글자·문단 형식의 PDF"
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
              disabled={docxBusy !== null}
              onClick={() => void exportDocx("word")}
              title="PDF와 같은 규격 · Word에서 수정 후 PDF로 저장"
              className={`${btn} ${enabled}`}
            >
              {docxBusy === "word" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
              ) : (
                <FileText className="h-3.5 w-3.5 shrink-0" />
              )}
              {docxBusy === "word" ? "Word 만드는 중…" : "Word 저장"}
            </button>
            {iosLike ? (
              <button
                type="button"
                disabled={docxBusy !== null}
                onClick={() => void exportDocx("pages")}
                title="PDF와 같은 규격 · Pages에서 수정 후 PDF로 저장"
                className={`${btn} ${enabled}`}
              >
                {docxBusy === "pages" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                ) : (
                  <FileText className="h-3.5 w-3.5 shrink-0" />
                )}
                {docxBusy === "pages" ? "Pages 만드는 중…" : "Pages 저장"}
              </button>
            ) : null}
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
          </div>
        </div>
      )}

      {openGroup === "share" && (
        <div className="flex flex-wrap gap-2 rounded-xl border border-ink-100 bg-ink-50/60 p-2">
          <button
            type="button"
            disabled={sharing}
            onClick={() => void shareLink()}
            className={`${btn} ${enabled}`}
          >
            {sharing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Share2 className="h-3.5 w-3.5 shrink-0" />
            )}
            시스템 공유
          </button>
          {includeManage && (
            <>
              <button
                type="button"
                disabled={goodnotesBusy}
                onClick={() => void shareGoodNotes()}
                className={`${btn} ${primary}`}
              >
                <BookOpen className="h-3.5 w-3.5 shrink-0" />
                {goodnotesBusy ? "준비 중…" : "굿노트"}
              </button>
              <button
                type="button"
                onClick={shareEmail}
                className={`${btn} ${enabled}`}
              >
                <Mail className="h-3.5 w-3.5 shrink-0" />
                이메일
              </button>
              <button
                type="button"
                onClick={() => void shareKakao()}
                className={`${btn} ${enabled}`}
                title={
                  kakaoConfigured
                    ? "카카오톡 공유"
                    : "NEXT_PUBLIC_KAKAO_JS_KEY 설정 필요"
                }
              >
                <MessageCircle className="h-3.5 w-3.5 shrink-0" />
                카톡{kakaoConfigured ? "" : " (키 필요)"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function loadKakaoSdk() {
  return new Promise<void>((resolve, reject) => {
    if (document.getElementById("kakao-sdk")) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.id = "kakao-sdk";
    s.src = "https://t1.kakaocdn.net/kakao_js_sdk/2.7.4/kakao.min.js";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Kakao SDK load failed"));
    document.head.appendChild(s);
  });
}
