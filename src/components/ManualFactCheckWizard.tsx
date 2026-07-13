"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileText,
} from "lucide-react";
import type {
  FactCheckResult,
  FactCheckVerdict,
  SummaryItem,
  VideoRecord,
} from "@/lib/types";
import { factCheckProgress, isItemChecked } from "@/lib/factcheck-client";
import { ReportTypePicker } from "@/components/ReportTypePicker";

function promptOf(item: SummaryItem, fc?: FactCheckResult): string {
  return (
    item.evidence.find((e) => e.sourceHint === "factcheck-guide")?.text ||
    (fc?.explanation && /^다음 주장을/.test(fc.explanation)
      ? fc.explanation
      : "") ||
    `다음 주장을 팩트체크해 주세요: 「${item.statement}」 — 수치·시기·지명·사료 근거와 반론을 출처와 함께 사실·과장·미확인으로 구분해 주세요.`
  );
}

export function ManualFactCheckWizard({ video }: { video: VideoRecord }) {
  const router = useRouter();
  const required = useMemo(
    () => video.items.filter((i) => i.needsFactCheck),
    [video.items]
  );
  const progress = factCheckProgress(video);
  const firstOpen = Math.max(
    0,
    required.findIndex((i) => !isItemChecked(i.id, video.factChecks))
  );
  const [step, setStep] = useState(firstOpen === -1 ? 0 : firstOpen);
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = required[step];
  const fcMap = useMemo(
    () => new Map(video.factChecks.map((f) => [f.itemId, f])),
    [video.factChecks]
  );

  async function saveItem(
    itemId: string,
    answer: string,
    verdict: FactCheckVerdict
  ) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/videos/${video.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft: true,
          factCheck: {
            itemId,
            verdict,
            explanation: answer,
            sources: [],
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "저장 실패");
      router.refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function completeAndGenerate() {
    setCompleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/videos/${video.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          completeManual: true,
          reportType: video.reportType,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "보고서 생성 실패");
      router.refresh();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "보고서 생성 실패");
    } finally {
      setCompleting(false);
    }
  }

  if (required.length === 0) {
    return (
      <div className="rounded-2xl border border-ink-200 bg-white p-5 text-center space-y-4">
        <p className="text-ink-700">
          검증이 필요한 주장이 없습니다. 바로 보고서를 만들 수 있습니다.
        </p>
        <button
          type="button"
          onClick={completeAndGenerate}
          disabled={completing}
          className="w-full sm:w-auto min-h-12 rounded-xl bg-ink-900 px-5 py-3 text-white font-medium hover:bg-accent disabled:opacity-60"
        >
          {completing ? "생성 중…" : "PDF 보고서 · 인포그래픽 생성"}
        </button>
      </div>
    );
  }

  return (
    <section
      id="manual-factcheck"
      className="rounded-2xl border border-accent/30 bg-white shadow-sm overflow-hidden"
    >
      <div className="bg-accent px-4 sm:px-5 py-3.5">
        <h2 className="font-display text-xl sm:text-2xl text-white text-center sm:text-left">
          2. 팩트체크 정리
        </h2>
      </div>
      <div className="bg-accent-muted/40 px-4 sm:px-5 py-4 border-b border-accent/20">
        <p className="text-sm text-ink-600">
          아래 <strong>AI 질문</strong>을 복사해 제미나이 등에 물어본 뒤,{" "}
          <strong>AI 답변·팩트체크 결과</strong>를 이 화면에 붙여넣으세요.
        </p>

        <div className="mt-4">
          <ReportTypePicker video={video} compact />
        </div>

        <div className="mt-4">
          <div className="flex justify-between text-xs text-ink-600 mb-1.5">
            <span>
              진행 {progress.doneCount} / {progress.total}
            </span>
            <span>
              {Math.round(
                (progress.doneCount / Math.max(progress.total, 1)) * 100
              )}
              %
            </span>
          </div>
          <div className="h-2 rounded-full bg-white overflow-hidden">
            <div
              className="h-full bg-accent transition-all duration-300"
              style={{
                width: `${(progress.doneCount / Math.max(progress.total, 1)) * 100}%`,
              }}
            />
          </div>
          <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
            {required.map((item, i) => {
              const done = isItemChecked(item.id, video.factChecks);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setStep(i)}
                  className={`shrink-0 min-w-9 min-h-9 rounded-lg text-sm font-medium border transition-colors ${
                    i === step
                      ? "bg-ink-900 text-white border-ink-900"
                      : done
                        ? "bg-verify-true/15 text-verify-true border-verify-true/30"
                        : "bg-white text-ink-500 border-ink-200"
                  }`}
                  aria-label={`${i + 1}번 항목`}
                >
                  {done ? <CheckCircle2 className="h-4 w-4 mx-auto" /> : i + 1}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {current && (
        <StepEditor
          key={current.id}
          item={current}
          index={step}
          total={required.length}
          imageFallback={video.thumbnailUrl}
          fc={fcMap.get(current.id)}
          saving={saving}
          onSave={async (answer, verdict) => {
            const ok = await saveItem(current.id, answer, verdict);
            if (ok && step < required.length - 1) setStep(step + 1);
          }}
        />
      )}

      {error && (
        <p className="px-4 sm:px-5 text-sm text-verify-false" role="alert">
          {error}
        </p>
      )}

      <div className="sticky bottom-0 sm:static border-t border-ink-200 bg-white/95 backdrop-blur px-4 sm:px-5 py-3 flex flex-col sm:flex-row gap-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex gap-2 flex-1">
          <button
            type="button"
            disabled={step === 0}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1 min-h-12 rounded-xl border border-ink-200 px-4 text-sm font-medium disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
            이전
          </button>
          <button
            type="button"
            disabled={step >= required.length - 1}
            onClick={() => setStep((s) => Math.min(required.length - 1, s + 1))}
            className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1 min-h-12 rounded-xl border border-ink-200 px-4 text-sm font-medium disabled:opacity-40"
          >
            다음
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <button
          type="button"
          disabled={!progress.complete || completing}
          onClick={completeAndGenerate}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 min-h-12 rounded-xl bg-accent px-5 text-white font-medium disabled:opacity-50 hover:bg-ink-900 transition-colors"
        >
          <FileText className="h-4 w-4" />
          {completing
            ? "보고서 생성 중…"
            : progress.complete
              ? "완료 → PDF·인포그래픽 생성"
              : `미완료 ${progress.total - progress.doneCount}건`}
        </button>
      </div>
    </section>
  );
}

function StepEditor({
  item,
  index,
  total,
  imageFallback,
  fc,
  saving,
  onSave,
}: {
  item: SummaryItem;
  index: number;
  total: number;
  imageFallback: string;
  fc?: FactCheckResult;
  saving: boolean;
  onSave: (answer: string, verdict: FactCheckVerdict) => Promise<void>;
}) {
  const prompt = promptOf(item, fc);
  const existingAnswer =
    fc?.explanation && !/^다음 주장을/.test(fc.explanation)
      ? fc.explanation
      : "";
  const [answer, setAnswer] = useState(existingAnswer);
  const [verdict, setVerdict] = useState<FactCheckVerdict>(
    fc?.verdict && fc.verdict !== "pending" ? fc.verdict : "unverifiable"
  );
  const [copied, setCopied] = useState(false);

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="p-4 sm:p-5 space-y-4">
      <p className="text-xs font-medium text-ink-500">
        항목 {index + 1} / {total} · 팩트체크 정리
      </p>

      <div className="overflow-hidden rounded-xl border border-ink-100">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.imageUrl || imageFallback}
          alt=""
          className="w-full aspect-video object-cover bg-ink-900"
        />
        <div className="p-3 sm:p-4 bg-ink-50/80 space-y-3">
          <div>
            <p className="text-xs text-accent font-medium mb-1">팩트체크 대상</p>
            <p className="text-base sm:text-lg font-medium text-ink-900 leading-snug">
              {item.statement}
            </p>
          </div>
          {item.detail && (
            <div className="rounded-lg border border-ink-200 bg-white px-3 py-2.5">
              <p className="text-xs text-ink-500 font-medium mb-1">
                왜 확인해야 하나
              </p>
              <p className="text-sm text-ink-700 leading-relaxed">
                {item.detail}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-accent/25 bg-accent-muted/40 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-accent font-medium">
            AI에게 물어볼 내용 (복사해서 제미나이 등에 붙여넣기)
          </p>
          <button
            type="button"
            onClick={copyPrompt}
            className="inline-flex items-center gap-1 rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-xs font-medium hover:border-accent"
          >
            <Copy className="h-3.5 w-3.5" />
            {copied ? "복사됨" : "복사"}
          </button>
        </div>
        <p className="text-sm text-ink-800 leading-relaxed whitespace-pre-wrap">
          {prompt}
        </p>
      </div>

      <label className="block text-sm text-ink-700">
        AI 답변 · 팩트체크 결과 입력{" "}
        <span className="text-verify-false">*</span>
        <span className="block text-xs text-ink-500 font-normal mt-0.5">
          제미나이·ChatGPT 등에서 받은 답변을 여기에 붙여넣으세요. (사실/과장/
          미확인·출처 포함)
        </span>
        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          rows={7}
          className="mt-1.5 w-full rounded-xl border border-ink-200 px-3 py-3 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          placeholder="예) AI 답변을 여기에 붙여넣기…"
        />
      </label>

      <div>
        <p className="text-sm text-ink-700 mb-2">판정 (선택)</p>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["true", "사실"],
              ["mostly_true", "대체로 사실"],
              ["mixed", "일부 사실"],
              ["mostly_false", "대체로 거짓"],
              ["false", "거짓"],
              ["unverifiable", "검증 불가"],
            ] as Array<[FactCheckVerdict, string]>
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => setVerdict(v)}
              className={`min-h-10 rounded-lg border px-3 text-sm ${
                verdict === v
                  ? "border-accent bg-accent-muted text-ink-900"
                  : "border-ink-200 bg-white text-ink-600"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        disabled={saving || answer.trim().length < 20}
        onClick={() => onSave(answer, verdict)}
        className="w-full min-h-12 rounded-xl bg-ink-900 text-white font-medium hover:bg-accent disabled:opacity-50 transition-colors"
      >
        {saving ? "저장 중…" : "이 항목 저장하고 다음"}
      </button>
    </div>
  );
}
