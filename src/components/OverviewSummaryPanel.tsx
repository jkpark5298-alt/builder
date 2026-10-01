"use client";

import {
  Check,
  CheckCircle2,
  ClipboardCopy,
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
import { isFactCheckPass } from "@/lib/input-mode";
import { normalizeAiOverviewPaste } from "@/lib/text-format";
import { FLOW, flowLabel } from "@/lib/flow-steps";
import {
  EXTERNAL_APP_LABEL,
  launchExternalApp,
  type ExternalAppId,
} from "@/lib/external-apps";

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
    hint: `요약을 확인한 뒤 「${flowLabel("tidySummary")}」→「${flowLabel("saveSummary")}」(이미 저장됐으면 ${FLOW.copySummary.n}번으로).`,
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
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const hasExistingFc = video.items.some((i) => i.needsFactCheck);
  const fcPass = isFactCheckPass(video);
  const [preserveFactChecks, setPreserveFactChecks] = useState(
    hasExistingFc && !fcPass
  );

  const charCount = useMemo(() => draft.trim().length, [draft]);
  const fcProgress = useMemo(() => factCheckProgress(video), [video]);

  async function copyOverviewAll() {
    const text = (editing ? draft : video.overview || "").trim();
    if (!text) {
      setError("복사할 요약이 없습니다.");
      return;
    }
    setError(null);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setHint(`요약 전체 ${text.length.toLocaleString()}자를 복사했습니다.`);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("복사에 실패했습니다. 텍스트를 직접 드래그해 복사해 주세요.");
    }
  }

  /** 같은 탭에서 복사 + 앱 실행 (iOS 제스처 유지) */
  function copyOverviewAndOpenApp(app: ExternalAppId) {
    const text = (editing ? draft : video.overview || "").trim();
    const label = EXTERNAL_APP_LABEL[app];
    if (!text) {
      setError("복사할 요약이 없습니다.");
      return;
    }
    setError(null);
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        setHint(
          `요약 전체를 복사했습니다 · ${label}에서 붙여넣기 하세요.`
        );
        window.setTimeout(() => setCopied(false), 2500);
      })
      .catch(() => {
        setError("복사에 실패했습니다. 전체 복사 후 앱에서 붙여넣기 하세요.");
      });
    launchExternalApp(app);
  }

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

  async function completeManualOverview(opts?: {
    buildInternalReport?: boolean;
  }) {
    setError(null);
    setHint(null);
    let text = (editing ? draft : video.overview || draft).trim();
    if (text.length < 40) {
      setError("요약을 40자 이상 입력해 주세요.");
      return;
    }
    // 저장 전 문장·마크다운 정리
    const cleaned = normalizeAiOverviewPaste(text);
    if (cleaned.trim().length >= 40) {
      text = cleaned.trim();
      if (editing) setDraft(text);
    }
    setSaving(true);
    try {
      const keepFc = hasExistingFc && preserveFactChecks && !fcPass;
      const res = await fetch(`/api/videos/${video.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updateOverview: {
            overview: text,
            complete: true,
            preserveFactChecks: keepFc,
            buildInternalReport: opts?.buildInternalReport === true,
          },
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        progress?: { total?: number };
        video?: { items?: unknown[] };
        mode?: string;
      };
      if (!res.ok) throw new Error(data.error || "완료 처리 실패");
      if (keepFc) {
        setHint("요약만 저장했습니다. 기존 팩트체크는 유지됩니다.");
      } else if (data.mode === "overview_pass_finalize") {
        setHint("요약 저장 · 내부 AI 보고서 초안을 만들었습니다.");
      } else {
        setHint(
          `${flowLabel("saveSummary")} 완료. 다음: 「${flowLabel("copySummary")}」→ 제미나이 보고서 → 「${flowLabel("pasteReport")}」.`
        );
      }
      setEditing(false);
      router.refresh();
      window.setTimeout(() => {
        const target = opts?.buildInternalReport
          ? document.getElementById("report") ||
            document.getElementById("report-draft")
          : document.getElementById("report-draft") ||
            document.getElementById("report");
        target?.scrollIntoView({ behavior: "smooth", block: "start" });
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
        ? `${flowLabel("tidySummary")} 완료 · 대주제 ${sections}개 · 소주제 ${bullets}개. 확인 후 「${flowLabel("saveSummary")}」.`
        : `${flowLabel("tidySummary")} 완료. 확인 후 「${flowLabel("saveSummary")}」.`
    );
  }

  /** 저장된 요약 문장 정리 후 다시 저장 (보기 모드 「AI 답변 정리」) */
  async function tidySavedOverview() {
    setError(null);
    setHint(null);
    const source = (video.overview || "").trim();
    if (source.length < 40) {
      setError("정리할 요약이 없습니다.");
      return;
    }
    const cleaned = normalizeAiOverviewPaste(source);
    if (!cleaned || cleaned.trim().length < 40) {
      setError("정리 결과가 너무 짧습니다. 「요약 수정」에서 확인해 주세요.");
      return;
    }
    if (cleaned.trim() === source) {
      setHint("이미 문장이 정리된 요약입니다.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/videos/${video.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updateOverview: {
            overview: cleaned,
            complete: true,
            preserveFactChecks: true,
          },
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "정리 저장 실패");
      setHint(`${flowLabel("tidySummary")}를 반영했습니다. 다음: 「${flowLabel("copySummary")}」.`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "정리 저장 실패");
    } finally {
      setSaving(false);
    }
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
            <button
              type="button"
              disabled={!(video.overview?.trim())}
              onClick={() => void copyOverviewAll()}
              className="inline-flex items-center gap-1.5 min-h-10 rounded-lg border border-ink-200 bg-white px-3 text-xs font-medium hover:border-accent disabled:opacity-50"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-verify-true" />
              ) : (
                <ClipboardCopy className="h-3.5 w-3.5" />
              )}
              {copied ? "복사됨" : flowLabel("copySummary", "전체 복사")}
            </button>
            <button
              type="button"
              disabled={!(video.overview?.trim())}
              onClick={() => copyOverviewAndOpenApp("gemini")}
              className="inline-flex items-center gap-1.5 min-h-10 rounded-lg border border-ink-200 bg-white px-3 text-xs font-medium hover:border-accent disabled:opacity-50"
            >
              제미나이
            </button>
            <button
              type="button"
              disabled={!(video.overview?.trim())}
              onClick={() => copyOverviewAndOpenApp("daglo")}
              className="inline-flex items-center gap-1.5 min-h-10 rounded-lg border border-ink-200 bg-white px-3 text-xs font-medium hover:border-accent disabled:opacity-50"
            >
              다글로
            </button>
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
            {!!video.overview?.trim() && (
              <button
                type="button"
                disabled={saving}
                onClick={() => void tidySavedOverview()}
                className="inline-flex items-center gap-1.5 min-h-10 rounded-lg border border-accent/40 bg-accent-muted/40 px-3 text-xs font-medium text-ink-900 hover:border-accent disabled:opacity-60"
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                {flowLabel("tidySummary")}
              </button>
            )}
            {pdfButton}
          </div>
          {fcPass && video.status === "awaiting_factcheck" && video.overview.trim().length >= 40 && (
            <button
              type="button"
              disabled={saving}
              onClick={() =>
                void completeManualOverview({ buildInternalReport: true })
              }
              className="inline-flex items-center gap-1.5 min-h-10 rounded-xl border border-ink-300 bg-white px-4 text-sm font-medium text-ink-800 hover:border-accent disabled:opacity-60"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {saving ? "초안 만드는 중…" : "고급 · 내부 AI로 초안 만들기"}
            </button>
          )}
        </>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-ink-600 leading-relaxed rounded-lg bg-ink-50 border border-ink-100 px-3 py-2">
            <strong>순서</strong> {flowLabel("pasteSummary")} →{" "}
            {flowLabel("tidySummary")} → {flowLabel("saveSummary")} →{" "}
            {flowLabel("copySummary")}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {pdfButton}
            <button
              type="button"
              disabled={saving || pdfBusy || !draft.trim()}
              onClick={runNormalizeAiOverview}
              className="inline-flex items-center gap-1.5 min-h-10 rounded-lg border border-accent/40 bg-accent-muted/30 px-3 text-xs font-medium text-ink-900 hover:bg-accent-muted disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {flowLabel("tidySummary")}
            </button>
            <button
              type="button"
              disabled={saving || pdfBusy || !draft.trim()}
              onClick={() => void copyOverviewAll()}
              className="inline-flex items-center gap-1.5 min-h-10 rounded-lg border border-ink-200 bg-white px-3 text-xs font-medium hover:border-accent disabled:opacity-50"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-verify-true" />
              ) : (
                <ClipboardCopy className="h-3.5 w-3.5" />
              )}
              {copied ? "복사됨" : flowLabel("copySummary", "전체 복사")}
            </button>
            <button
              type="button"
              disabled={saving || pdfBusy || !draft.trim()}
              onClick={() => copyOverviewAndOpenApp("gemini")}
              className="inline-flex items-center gap-1.5 min-h-10 rounded-lg border border-ink-200 bg-white px-3 text-xs font-medium hover:border-accent disabled:opacity-50"
            >
              제미나이
            </button>
            <button
              type="button"
              disabled={saving || pdfBusy || !draft.trim()}
              onClick={() => copyOverviewAndOpenApp("daglo")}
              className="inline-flex items-center gap-1.5 min-h-10 rounded-lg border border-ink-200 bg-white px-3 text-xs font-medium hover:border-accent disabled:opacity-50"
            >
              다글로
            </button>
            <p className="text-xs text-ink-500">
              {FLOW.copySummary.n}번 복사 후 제미나이에서 보고서 · PDF{" "}
              {(PDF_MAX_BYTES / (1024 * 1024)).toFixed(0)}MB 이하
            </p>
          </div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={14}
            placeholder={`${flowLabel("pasteSummary")}: 제미나이 요약을 붙여넣은 뒤 「${flowLabel("tidySummary")}」→「${flowLabel("saveSummary")}」.\n\n예시:\n1. 대주제\n• 소주제: 설명…\n\n최종 결론\n…`}
            className="w-full rounded-xl border border-ink-200 bg-white px-3 py-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
          <p className="text-xs text-ink-500">{charCount.toLocaleString()}자</p>
          <p className="text-xs text-ink-600 leading-relaxed rounded-lg bg-ink-50 border border-ink-100 px-3 py-2">
            <strong>절차</strong> {flowLabel("pasteSummary")} →{" "}
            <strong>{flowLabel("tidySummary")}</strong> →{" "}
            <strong>{flowLabel("saveSummary")}</strong> →{" "}
            {flowLabel("copySummary")} → {flowLabel("pasteReport")}
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
          {hasExistingFc && !fcPass && (
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
              {saving ? "저장 중…" : flowLabel("saveSummary")}
            </button>
            {fcPass && (
              <button
                type="button"
                disabled={saving || pdfBusy}
                onClick={() =>
                  void completeManualOverview({ buildInternalReport: true })
                }
                className="inline-flex items-center gap-1.5 min-h-10 rounded-xl border border-ink-300 bg-white px-4 text-sm font-medium text-ink-800 hover:border-accent disabled:opacity-60"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                고급 · 내부 AI 초안
              </button>
            )}
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
