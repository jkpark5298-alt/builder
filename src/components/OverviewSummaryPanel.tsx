"use client";

import {
  CheckCircle2,
  FileText,
  Loader2,
  Pencil,
  Sparkles,
  UserRound,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import type { VideoRecord } from "@/lib/types";
import { factCheckProgress } from "@/lib/factcheck-client";
import { normalizeAiOverviewPaste } from "@/lib/text-format";

/** API와 동일 — 클라이언트에서 unpdf를 끌어오지 않도록 상수만 둠 */
const PDF_MAX_BYTES = 4 * 1024 * 1024;

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
    hint: "직접 작성·PDF 읽기·AI 답변 붙인 뒤 「AI 답변 정리」할 수 있습니다. 「완료」로 저장합니다.",
    ai: false,
    className: "bg-sky-50 text-sky-900 border-sky-200",
  },
  fallback: {
    label: "AI 요약 아님 (폴백)",
    hint: "API 키 없음·오류 등으로 짧은 발췌만 있습니다. 수동 입력·PDF·AI 답변 정리 또는 재요약하세요.",
    ai: false,
    className: "bg-amber-50 text-amber-900 border-amber-200",
  },
  none: {
    label: "요약 없음",
    hint: "아직 요약이 없습니다. PDF에서 읽기, AI 답변 붙여넣기·정리, 또는 AI 재요약을 하세요.",
    ai: false,
    className: "bg-ink-50 text-ink-700 border-ink-200",
  },
};

/** 유튜브 내용 요약: 수동 수정 후 완료 → FC·보고서 자동 갱신 */
export function OverviewSummaryPanel({ video }: { video: VideoRecord }) {
  const router = useRouter();
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const source = video.summarySource ?? "none";
  const ui = SOURCE_UI[source] ?? SOURCE_UI.none;
  const needsManual = !ui.ai;

  const [editing, setEditing] = useState(needsManual && !video.overview.trim());
  const [draft, setDraft] = useState(video.overview || "");
  const [saving, setSaving] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const hasExistingFc = video.items.some((i) => i.needsFactCheck);
  const [preserveFactChecks, setPreserveFactChecks] = useState(hasExistingFc);

  const charCount = useMemo(() => draft.trim().length, [draft]);
  const fcProgress = useMemo(() => factCheckProgress(video), [video]);

  async function importFromPdf(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setError(null);
    setHint(null);

    const name = file.name || "upload.pdf";
    const type = (file.type || "").toLowerCase();
    const looksPdf =
      type === "application/pdf" ||
      type === "application/x-pdf" ||
      name.toLowerCase().endsWith(".pdf");
    if (!looksPdf) {
      setError("PDF 파일만 올릴 수 있습니다.");
      return;
    }
    if (file.size > PDF_MAX_BYTES) {
      setError(
        `PDF가 너무 큽니다. ${(PDF_MAX_BYTES / (1024 * 1024)).toFixed(0)}MB 이하로 올려 주세요.`
      );
      return;
    }

    if (draft.trim().length >= 40) {
      const ok = window.confirm(
        "이미 입력된 요약이 있습니다. PDF 내용으로 바꿀까요?\n(취소하면 불러오지 않습니다.)"
      );
      if (!ok) {
        if (pdfInputRef.current) pdfInputRef.current.value = "";
        return;
      }
    }

    setPdfBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/pdf/extract", {
        method: "POST",
        body: form,
      });
      const data = (await res.json()) as {
        error?: string;
        text?: string;
        pageCount?: number;
        charCount?: number;
        fileName?: string;
      };
      if (!res.ok || !data.text) {
        throw new Error(data.error || "PDF 읽기 실패");
      }
      setDraft(data.text);
      setEditing(true);
      setHint(
        `PDF「${data.fileName || name}」에서 ${data.pageCount ?? "?"}쪽 · ${(data.charCount ?? data.text.length).toLocaleString()}자를 읽었습니다. 확인 후 「완료」를 누르세요.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF 읽기 실패");
    } finally {
      setPdfBusy(false);
      if (pdfInputRef.current) pdfInputRef.current.value = "";
    }
  }

  async function completeManualOverview() {
    setError(null);
    setHint(null);
    if (draft.trim().length < 40) {
      setError("요약을 40자 이상 입력해 주세요.");
      return;
    }
    setSaving(true);
    try {
      const keepFc = hasExistingFc && preserveFactChecks;
      const res = await fetch(`/api/videos/${video.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updateOverview: {
            overview: draft.trim(),
            complete: true,
            preserveFactChecks: keepFc,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "완료 처리 실패");
      if (keepFc) {
        setHint("요약만 저장했습니다. 기존 팩트체크는 유지됩니다.");
      } else {
        const n = data.progress?.total ?? data.video?.items?.length ?? 0;
        setHint(
          `요약 완료. 팩트체크 ${n}건·보고서 초안을 만들었습니다.`
        );
      }
      setEditing(false);
      router.refresh();
      window.setTimeout(() => {
        if (keepFc && video.status === "ready") {
          document
            .getElementById("report")
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
          return;
        }
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

  function runNormalizeAiOverview() {
    setError(null);
    const cleaned = normalizeAiOverviewPaste(draft);
    if (!cleaned) {
      setError("정리할 내용이 없습니다. AI 요약을 붙여넣은 뒤 다시 시도하세요.");
      return;
    }
    setDraft(cleaned);
    const sections = (cleaned.match(/^\d+\.\s+/gm) || []).length;
    const bullets = (cleaned.match(/^•\s+/gm) || []).length;
    setHint(
      sections || bullets
        ? `AI 답변 정리 완료 · 대주제 ${sections}개 · 소주제 ${bullets}개. 확인 후 「완료」를 누르세요.`
        : "AI 답변 정리 완료. 마크다운·군더더기를 걷어냈습니다. 확인 후 「완료」를 누르세요."
    );
  }

  const pdfButton = (
    <>
      <input
        ref={pdfInputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => void importFromPdf(e.target.files)}
      />
      <button
        type="button"
        disabled={saving || pdfBusy}
        onClick={() => pdfInputRef.current?.click()}
        className="inline-flex items-center gap-1.5 min-h-10 rounded-lg border border-ink-200 bg-white px-3 text-xs font-medium hover:border-accent disabled:opacity-60"
      >
        {pdfBusy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <FileText className="h-3.5 w-3.5" />
        )}
        {pdfBusy ? "PDF 읽는 중…" : "PDF에서 읽기"}
      </button>
    </>
  );

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
          {error && (
            <p className="text-sm text-verify-false" role="alert">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
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
            {pdfButton}
          </div>
        </>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {pdfButton}
            <button
              type="button"
              disabled={saving || pdfBusy || !draft.trim()}
              onClick={runNormalizeAiOverview}
              className="inline-flex items-center gap-1.5 min-h-10 rounded-lg border border-accent/40 bg-accent-muted/30 px-3 text-xs font-medium text-ink-900 hover:bg-accent-muted disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5" />
              AI 답변 정리
            </button>
            <p className="text-xs text-ink-500">
              Gemini 등 요약을 붙여넣은 뒤 정리 · PDF {(PDF_MAX_BYTES / (1024 * 1024)).toFixed(0)}MB 이하
            </p>
          </div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={14}
            placeholder={`Gemini/ChatGPT 요약을 붙여넣은 뒤 「AI 답변 정리」를 누르세요.\n\n예시 형식:\n1. 대주제 제목\n• 소주제: 상세 설명…\n\n최종 결론\n…`}
            className="w-full rounded-xl border border-ink-200 bg-white px-3 py-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
          <p className="text-xs text-ink-500">{charCount.toLocaleString()}자</p>
          <p className="text-xs text-ink-600 leading-relaxed rounded-lg bg-ink-50 border border-ink-100 px-3 py-2">
            <strong>AI 답변 정리</strong>는 마크다운·군더더기를 걷어{" "}
            <code className="text-[11px]">1. 대주제 / • 소주제</code> 형으로
            맞춥니다. <strong>완료</strong>를 누르면 저장하고 팩트체크·보고서를
            새 요약에 맞춥니다.
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
          {hasExistingFc && (
            <fieldset className="space-y-2 rounded-xl border border-ink-200 bg-ink-50/80 p-3">
              <legend className="text-xs font-medium text-ink-700 px-1">
                요약 저장 방식
              </legend>
              <label className="flex gap-2 items-start cursor-pointer text-sm">
                <input
                  type="radio"
                  name="overview-fc-mode"
                  className="mt-1"
                  checked={preserveFactChecks}
                  onChange={() => setPreserveFactChecks(true)}
                />
                <span>
                  <span className="font-medium text-ink-900">요약만 수정 (FC 유지)</span>
                  <span className="block text-xs text-ink-500 mt-0.5">
                    기존 팩트체크 {fcProgress.doneCount}/{fcProgress.total}건·보고서
                    본문을 유지합니다.
                  </span>
                </span>
              </label>
              <label className="flex gap-2 items-start cursor-pointer text-sm">
                <input
                  type="radio"
                  name="overview-fc-mode"
                  className="mt-1"
                  checked={!preserveFactChecks}
                  onChange={() => setPreserveFactChecks(false)}
                />
                <span>
                  <span className="font-medium text-ink-900">
                    팩트체크도 다시 만들기
                  </span>
                  <span className="block text-xs text-ink-500 mt-0.5">
                    새 요약 기준으로 FC 항목을 다시 만들며, 기존 답변은
                    사라집니다.
                  </span>
                </span>
              </label>
            </fieldset>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={saving || pdfBusy}
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
              disabled={saving || pdfBusy}
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
