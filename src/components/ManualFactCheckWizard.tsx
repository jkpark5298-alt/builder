"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Copy,
  FileText,
  Loader2,
  Pencil,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react";
import type {
  AnswerPart,
  FactCheckResult,
  FactCheckVerdict,
  SummaryItem,
  VideoRecord,
} from "@/lib/types";
import { factCheckProgress, isItemChecked } from "@/lib/factcheck-client";
import {
  pairAnswerParts,
  partsToExplanation,
  resolveAnswerParts,
} from "@/lib/answer-parts";
import { factCheckGuideForItem } from "@/lib/report";
import {
  normalizeAiAnswer,
  normalizeAiFactCheckAnswer,
  htmlToPlainText,
} from "@/lib/text-format";
import { ReportTypePicker } from "@/components/ReportTypePicker";
import { FactCheckRevisedBanner } from "@/components/FactCheckRevisedBanner";
import { BulkFactCheckPastePanel } from "@/components/BulkFactCheckPastePanel";
import { FactCheckRestoreActions } from "@/components/FactCheckRestoreActions";
import {
  FactCheckAnswerEditor,
  answerPlainLength,
} from "@/components/FactCheckAnswerEditor";
import { FC_VERDICT_OPTIONS } from "@/lib/factcheck-detail";
import { normalizeSimpleVerdict, verdictLabel } from "@/lib/labels";
import { isHistoryFactCheckFlow } from "@/lib/history-flow";

function promptOf(item: SummaryItem, fc?: FactCheckResult): string {
  const fromEvidence = item.evidence.find(
    (e) => e.sourceHint === "factcheck-guide"
  )?.text;
  if (fromEvidence && !fromEvidence.includes("본문 근거")) {
    return fromEvidence;
  }
  return factCheckGuideForItem(item);
}

function showDetailBlock(item: SummaryItem): boolean {
  if (!item.detail?.trim()) return false;
  const d = item.detail.replace(/\s+/g, " ");
  const s = item.statement.replace(/\s+/g, " ");
  return !d.includes(s.slice(0, 30)) && !/^본문 근거:/i.test(d);
}

export function ManualFactCheckWizard({ video }: { video: VideoRecord }) {
  const router = useRouter();
  /** API 응답으로 즉시 갱신 — refresh 지연/캐시로 두 번 저장하는 문제 방지 */
  const [localVideo, setLocalVideo] = useState(video);

  useEffect(() => {
    const serverTs = new Date(video.updatedAt).getTime();
    const localTs = new Date(localVideo.updatedAt).getTime();
    const serverNewer = serverTs > localTs;
    const serverMoreChecks =
      video.updatedAt === localVideo.updatedAt &&
      video.factChecks.length > localVideo.factChecks.length;
    const noticeChanged =
      video.factCheckRevisionNotice?.at !==
      localVideo.factCheckRevisionNotice?.at;
    const finalizeModeChanged =
      video.pendingReportFinalize !== localVideo.pendingReportFinalize;
    const reportChanged =
      Boolean(video.report) !== Boolean(localVideo.report) ||
      video.reportSkeletonEdited !== localVideo.reportSkeletonEdited;
    if (serverNewer || serverMoreChecks || noticeChanged || finalizeModeChanged || reportChanged) {
      // refresh 캐시가 구버전이면 완료 건수가 줄어들 수 있음 → 덮어쓰지 않음
      const localDone = factCheckProgress(localVideo).doneCount;
      const serverDone = factCheckProgress(video).doneCount;
      if (serverNewer && serverDone < localDone && serverTs - localTs < 3000) {
        return;
      }
      setLocalVideo(video);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync only when server props change
  }, [video.updatedAt, video.factChecks, video.factCheckRevisionNotice?.at, video.factCheckNotice, video.factCheckSource, video.pendingReportFinalize, video.report, video.reportSkeletonEdited]);

  const required = useMemo(
    () => localVideo.items.filter((i) => i.needsFactCheck),
    [localVideo.items]
  );
  const progress = factCheckProgress(localVideo);
  const historyFlow = isHistoryFactCheckFlow(localVideo);
  const keepBodyOnComplete =
    localVideo.pendingReportFinalize === "keep_body";
  const rewriteOnComplete =
    localVideo.pendingReportFinalize === "rewrite";
  const firstOpen = Math.max(
    0,
    required.findIndex((i) => !isItemChecked(i.id, localVideo.factChecks))
  );
  const [step, setStep] = useState(firstOpen === -1 ? 0 : firstOpen);
  /** 항목에서 고른 판정 — 간편 붙여넣기 목록에 즉시 반영 */
  const [draftVerdicts, setDraftVerdicts] = useState<
    Record<string, FactCheckVerdict>
  >({});
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const current = required[step];
  const fcMap = useMemo(
    () => new Map(localVideo.factChecks.map((f) => [f.itemId, f])),
    [localVideo.factChecks]
  );

  async function saveItem(
    itemId: string,
    answer: string,
    verdict: FactCheckVerdict,
    answerImageUrls?: string[],
    answerParts?: AnswerPart[]
  ): Promise<boolean> {
    setSaving(true);
    setError(null);
    setSavedFlash(false);
    try {
      const plain = htmlToPlainText(answer);
      const rawParts =
        answerParts ?? pairAnswerParts(plain, answerImageUrls ?? []);
      // 서식(HTML) 유지. 번호 분할용 평문은 parts에만 사용
      const plainExplanation =
        partsToExplanation(rawParts) || normalizeAiAnswer(plain);
      if (plainExplanation.trim().length < 20 && plain.trim().length < 20) {
        throw new Error("AI 답변을 조금 더 자세히 입력해 주세요. (20자 이상)");
      }
      const safeVerdict = normalizeSimpleVerdict(
        verdict === "pending" ? "unverifiable" : verdict
      );
      // HTML이면 본문 서식 저장, 아니면 평문 explanation
      const explanation = /<[a-z][\s\S]*>/i.test(answer.trim())
        ? answer.trim()
        : plainExplanation;

      const patchOnce = async () => {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), 45000);
        try {
          return await fetch(`/api/videos/${localVideo.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
              factCheck: {
                itemId,
                verdict: safeVerdict,
                explanation,
                sources: [],
              },
            }),
          });
        } finally {
          window.clearTimeout(timer);
        }
      };

      let res: Response;
      try {
        res = await patchOnce();
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
          throw new Error(
            "저장 시간이 초과됐습니다. 네트워크를 확인한 뒤 다시 시도해 주세요."
          );
        }
        throw e;
      }

      let data: {
        error?: string;
        code?: string;
        warning?: string;
        video?: VideoRecord;
      } = {};
      try {
        data = (await res.json()) as typeof data;
      } catch {
        if (!res.ok) throw new Error(`저장 실패 (HTTP ${res.status})`);
      }

      // 동시 저장 충돌 시 1회 재시도
      if (res.status === 409 || data.code === "STORAGE_CONFLICT") {
        res = await patchOnce();
        try {
          data = (await res.json()) as typeof data;
        } catch {
          if (!res.ok) throw new Error(`저장 실패 (HTTP ${res.status})`);
        }
      }

      if (!res.ok) {
        throw new Error(data.error || `저장 실패 (HTTP ${res.status})`);
      }
      if (!data.video) {
        throw new Error("저장 응답에 데이터가 없습니다. 새로고침 후 다시 시도해 주세요.");
      }

      const textOnlyParts = rawParts.map((p) => ({
        number: p.number,
        text: p.text,
        imageUrls: [] as string[],
      }));
      const fc: FactCheckResult = {
        itemId,
        mode: "manual",
        verdict: safeVerdict,
        explanation,
        sources: [],
        checkedAt: new Date().toISOString(),
        answerImageUrl: undefined,
        answerImageUrls: undefined,
        answerParts: textOnlyParts,
      };

      const mergedChecks = [
        ...data.video.factChecks.filter((f) => f.itemId !== itemId),
        {
          ...(data.video.factChecks.find((f) => f.itemId === itemId) ?? fc),
          ...fc,
        },
      ];
      setLocalVideo({ ...data.video, factChecks: mergedChecks });

      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 2500);
      // 즉시 refresh하면 캐시된 구 데이터가 local을 덮어쓸 수 있음 → 지연
      window.setTimeout(() => router.refresh(), 800);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function completeAndGenerate(opts?: { allowPartial?: boolean }) {
    if (
      opts?.allowPartial &&
      !window.confirm(
        `필수 항목 ${progress.gateTotal - progress.gateDoneCount}건이 아직 미완료입니다.\n\n미완료 항목은 보고서 완료 후 「팩트체크」 탭에서 이어서 채울 수 있습니다. 그래도 보고서를 만들까요?`
      )
    ) {
      return;
    }
    setCompleting(true);
    setError(null);
    try {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 150_000);
      let res: Response;
      try {
        res = await fetch(`/api/videos/${localVideo.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            completeManual: true,
            reportType: localVideo.reportType,
            ...(opts?.allowPartial ? { allowPartialFactCheck: true } : {}),
          }),
        });
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
          throw new Error(
            "보고서 작성 시간이 초과됐습니다. 네트워크를 확인한 뒤 다시 시도해 주세요."
          );
        }
        throw e;
      } finally {
        window.clearTimeout(timer);
      }
      const data = (await res.json()) as {
        error?: string;
        video?: VideoRecord;
      };
      if (!res.ok) throw new Error(data.error || "보고서 생성 실패");
      if (data.video) setLocalVideo(data.video);
      // 완료 후 바로 보고서 보기 화면으로
      router.push(`/videos/${localVideo.id}#report`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "보고서 생성 실패");
    } finally {
      setCompleting(false);
    }
  }

  async function redraftDrafts() {
    setDrafting(true);
    setError(null);
    try {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 150_000);
      let res: Response;
      try {
        res = await fetch(`/api/videos/${localVideo.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({ redraftFactChecks: true }),
        });
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
          throw new Error(
            "초안 생성 시간이 초과됐습니다. 질문을 복사해 외부 AI에 붙여넣는 기존 방식을 이용해 주세요."
          );
        }
        throw e;
      } finally {
        window.clearTimeout(timer);
      }
      const data = (await res.json()) as {
        error?: string;
        video?: VideoRecord;
        notice?: string;
      };
      if (!res.ok) throw new Error(data.error || "초안 생성 실패");
      if (data.video) setLocalVideo(data.video);
      if (data.notice || data.video?.factCheckNotice) {
        setSavedFlash(true);
        window.setTimeout(() => setSavedFlash(false), 2500);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "초안 생성 실패");
    } finally {
      setDrafting(false);
    }
  }

  async function updateTarget(
    itemId: string,
    patch: {
      statement?: string;
      detail?: string;
      factCheckOptional?: boolean;
    }
  ) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/videos/${localVideo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updateItem: {
            itemId,
            ...(patch.statement !== undefined
              ? { statement: patch.statement }
              : {}),
            ...(patch.detail !== undefined
              ? { detail: patch.detail.trim() ? patch.detail : null }
              : {}),
            ...(patch.factCheckOptional !== undefined
              ? { factCheckOptional: patch.factCheckOptional }
              : {}),
          },
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        video?: VideoRecord;
      };
      if (!res.ok) throw new Error(data.error || "대상 수정 실패");
      if (data.video) setLocalVideo(data.video);
      router.refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "대상 수정 실패");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function deleteTarget(itemId: string) {
    if (
      !window.confirm(
        "이 팩트체크 대상을 삭제할까요? 저장된 답변도 함께 삭제됩니다."
      )
    ) {
      return false;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/videos/${localVideo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deleteItem: { itemId } }),
      });
      const data = (await res.json()) as {
        error?: string;
        video?: VideoRecord;
      };
      if (!res.ok) throw new Error(data.error || "대상 삭제 실패");
      if (data.video) {
        setLocalVideo(data.video);
        const left = data.video.items.filter((i) => i.needsFactCheck).length;
        setStep((s) => Math.min(s, Math.max(0, left - 1)));
      }
      router.refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "대상 삭제 실패");
      return false;
    } finally {
      setSaving(false);
    }
  }

  function saveDraftAndLeave() {
    if (progress.gateComplete) {
      router.push("/#pending");
    } else {
      router.push("/#drafts");
    }
    router.refresh();
  }

  if (required.length === 0) {
    return (
      <div className="rounded-2xl border border-ink-200 bg-white p-5 space-y-4">
        <p className="text-ink-700 text-center">
          검증이 필요한 주장이 없습니다.
          {(localVideo.factCheckTrash?.length ?? 0) > 0
            ? " 삭제한 항목을 원복하거나, 요약에서 다시 만들 수 있습니다."
            : " 요약에서 다시 만들거나, 대상을 직접 추가할 수 있습니다."}
        </p>
        <FactCheckRestoreActions
          video={localVideo}
          onVideoUpdate={setLocalVideo}
        />
        <p className="text-sm text-ink-600 text-center rounded-xl border border-accent/25 bg-accent-muted/30 px-3 py-2">
          이미지는 FC에 붙이지 않습니다. 홈 <strong>이미지</strong> 라이브러리 →{" "}
          <strong>보고서</strong>에서만 사용하세요.
        </p>
        <div className="flex flex-col sm:flex-row gap-2 justify-center pt-1">
          <button
            type="button"
            onClick={saveDraftAndLeave}
            className="w-full sm:w-auto min-h-12 rounded-xl border border-accent/40 bg-accent-muted/40 px-5 py-3 font-medium hover:bg-accent-muted"
          >
            작성 대기로
          </button>
          <button
            type="button"
            id="complete-report"
            onClick={() => void completeAndGenerate()}
            disabled={completing}
            className="w-full sm:w-auto min-h-12 rounded-xl bg-ink-900 px-5 py-3 text-white font-medium hover:bg-accent disabled:opacity-60 scroll-mt-24"
          >
            {completing
              ? "만드는 중…"
              : historyFlow
                ? "확정 보고서 만들기"
                : "보고서 만들기"}
          </button>
        </div>
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
      <div className="bg-accent-muted/40 px-4 sm:px-5 py-4 border-b border-accent/20 space-y-3">
        {historyFlow && (
          <div className="rounded-xl border border-accent/30 bg-white/90 px-3 py-2.5 text-xs sm:text-sm text-ink-800 leading-relaxed">
            <strong>역사 팩트체크 순서</strong>
            <ol className="mt-1.5 list-decimal pl-4 space-y-0.5 text-ink-700">
              <li>내용 요약</li>
              <li>FC 답변 붙여넣기 · 반영</li>
              <li>FC 반영 초안 확인 · 재수정</li>
              <li>확정 보고서 만들기</li>
              <li>번호별 이미지 추가</li>
            </ol>
            <p className="mt-1.5 text-ink-500">
              지금은 <strong>2단계</strong>입니다. 이미지는 확정 후(5단계)에
              붙입니다.
            </p>
          </div>
        )}
        <FactCheckRevisedBanner
          video={localVideo}
          onDismissed={setLocalVideo}
        />
        {localVideo.factCheckNotice ? (
          <p className="text-sm text-ink-700 rounded-xl border border-accent/25 bg-white/80 px-3 py-2.5">
            {localVideo.factCheckNotice}
          </p>
        ) : null}
        {localVideo.pendingReportFinalize === "keep_body" ? (
          <p className="text-sm text-ink-800 rounded-xl border border-verify-true/30 bg-verify-true/10 px-3 py-2.5">
            <strong>본문 유지</strong> — 보고서 만들기 시 기존 문장을 유지하고
            팩트체크만 반영합니다.
          </p>
        ) : localVideo.pendingReportFinalize === "rewrite" ? (
          <p className="text-sm text-ink-800 rounded-xl border border-verify-false/30 bg-verify-false/10 px-3 py-2.5">
            <strong>본문 새로 작성</strong> — 보고서 만들기 시 본문을 다시
            만듭니다. 기존 수정 내용은 사라집니다.
          </p>
        ) : null}

        <ReportTypePicker
          video={localVideo}
          compact
          onVideoUpdate={setLocalVideo}
        />

        <div className="flex justify-between text-xs text-ink-600">
          <span>
            진행 {progress.doneCount} / {progress.total}
            {progress.optionalCount > 0
              ? ` · 필수 ${progress.gateDoneCount}/${progress.gateTotal}`
              : ""}
          </span>
          <span>
            {Math.round(
              (progress.doneCount / Math.max(progress.total, 1)) * 100
            )}
            %
          </span>
        </div>

        <BulkFactCheckPastePanel
          video={localVideo}
          items={localVideo.items}
          liveVerdicts={draftVerdicts}
          onApplied={(v) => {
            setLocalVideo(v);
            const nextOpen = Math.max(
              0,
              v.items
                .filter((i) => i.needsFactCheck)
                .findIndex((i) => !isItemChecked(i.id, v.factChecks))
            );
            setStep(nextOpen === -1 ? 0 : nextOpen);
            router.refresh();
          }}
        />

        <p className="text-sm text-ink-600 rounded-xl border border-ink-200 bg-ink-50/80 px-3 py-2">
          FC에서는 답변·판정만 합니다. 이미지는 홈 「이미지」에 저장한 뒤
          보고서에서 붙이세요.
        </p>
        {historyFlow && progress.gateComplete && (
          <div className="rounded-xl border border-verify-true/30 bg-verify-true/10 px-3 py-2.5 text-sm text-ink-800">
            필수 FC가 끝났습니다. 아래{" "}
            <a href="#report-draft" className="font-medium text-accent underline">
              초안 보고서
            </a>
            를 다듬은 뒤 <strong>확정 보고서 만들기</strong>를 누르세요.
          </div>
        )}

        <details className="rounded-xl border border-ink-200 bg-white/70 px-3 py-2">
          <summary className="cursor-pointer select-none text-sm font-medium text-ink-800 py-1.5">
            추가 · 항목별 수정 · 인앱 AI
          </summary>
          <div className="pt-2 pb-1 space-y-3 border-t border-ink-100 mt-1">
            <p className="text-xs text-ink-500 leading-relaxed">
              필요할 때만 엽니다. 기본은 위{" "}
              {historyFlow ? "전체 답변 붙여넣기" : "붙여넣기"}
              입니다.
              <br />
              · <strong>인앱 AI 초안</strong> — OpenAI 키로 미완료 항목 답변·판정
              자동 작성 (실패 시 붙여넣기 사용)
              <br />
              · <strong>번호 버튼·항목별 수정</strong> — 주장 고치기, 나중에 해도
              됨, 개별 답변 입력, 항목 삭제
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                disabled={drafting || saving || completing}
                onClick={() => void redraftDrafts()}
                className="inline-flex items-center justify-center gap-2 min-h-11 rounded-xl border border-accent/40 bg-white px-4 text-sm font-medium text-ink-900 hover:bg-accent-muted/50 disabled:opacity-50"
              >
                {drafting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    초안 생성 중…
                  </>
                ) : (
                  "인앱 AI 초안 생성 (미완료만)"
                )}
              </button>
              <p className="text-xs text-ink-500 self-center">
                OpenAI 키 사용 · 실패 시 붙여넣기 사용
              </p>
            </div>

            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {required.map((item, i) => {
                const done = isItemChecked(item.id, localVideo.factChecks);
                const optional = Boolean(item.factCheckOptional);
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
                          : optional
                            ? "bg-ink-50 text-ink-400 border-ink-200 border-dashed"
                            : "bg-white text-ink-500 border-ink-200"
                    }`}
                    aria-label={`${i + 1}번 항목${optional ? " (선택)" : ""}`}
                  >
                    {done ? (
                      <CheckCircle2 className="h-4 w-4 mx-auto" />
                    ) : (
                      i + 1
                    )}
                  </button>
                );
              })}
            </div>

            {current && (
              <StepEditor
                key={current.id}
                item={current}
                index={step}
                total={required.length}
                fc={fcMap.get(current.id)}
                saving={saving}
                onVerdictChange={(v) =>
                  setDraftVerdicts((prev) => ({ ...prev, [current.id]: v }))
                }
                onUpdateTarget={(statement, detail) =>
                  updateTarget(current.id, { statement, detail })
                }
                onToggleOptional={(optional) =>
                  updateTarget(current.id, { factCheckOptional: optional })
                }
                onDeleteTarget={() => deleteTarget(current.id)}
                onSave={async (answer, verdict, ansImg, parts) => {
                  const ok = await saveItem(
                    current.id,
                    answer,
                    verdict,
                    ansImg,
                    parts
                  );
                  if (ok && step < required.length - 1) setStep(step + 1);
                  return ok;
                }}
              />
            )}
          </div>
        </details>
      </div>

      {savedFlash && (
        <div
          className="mx-4 sm:mx-5 mb-2 flex items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800"
          role="status"
        >
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
          저장됐습니다. 진행 표시에 ✓가 반영됩니다.
        </div>
      )}

      {error && (
        <p
          className={`px-4 sm:px-5 text-sm ${
            /저장됐습니다|제외/.test(error)
              ? "text-amber-700"
              : "text-verify-false"
          }`}
          role="status"
        >
          {error}
        </p>
      )}

      <div className="sticky bottom-0 sm:static border-t border-ink-200 bg-white/95 backdrop-blur px-4 sm:px-5 py-3 flex flex-col gap-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {savedFlash && (
          <div
            className="flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white sm:hidden"
            role="status"
          >
            <CheckCircle2 className="h-4 w-4" />
            저장 완료
          </div>
        )}
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            onClick={saveDraftAndLeave}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 min-h-12 rounded-xl border border-accent/40 bg-accent-muted/40 px-5 text-sm font-medium text-ink-900 hover:bg-accent-muted transition-colors"
          >
            <Save className="h-4 w-4" />
            {progress.gateComplete
              ? "작성 대기로"
              : "임시 저장하고 목록으로"}
          </button>
          {progress.canFinalizePartial ? (
            <button
              type="button"
              disabled={completing}
              onClick={() => void completeAndGenerate({ allowPartial: true })}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 min-h-12 rounded-xl border border-ink-300 bg-white px-5 text-sm font-medium text-ink-800 hover:border-accent disabled:opacity-50"
            >
              <FileText className="h-4 w-4" />
              {completing
                ? "만드는 중…"
                : `미완료 ${progress.gateTotal - progress.gateDoneCount}건 무시하고 만들기`}
            </button>
          ) : null}
          <button
            type="button"
            id="complete-report"
            disabled={!progress.gateComplete || completing}
            onClick={() => void completeAndGenerate()}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 min-h-12 rounded-xl bg-accent px-5 text-white font-medium disabled:opacity-50 hover:bg-ink-900 transition-colors scroll-mt-24"
          >
            <FileText className="h-4 w-4" />
            {completing
              ? "만드는 중…"
              : progress.gateComplete
                ? historyFlow
                  ? progress.complete
                    ? "확정 보고서 만들기"
                    : `확정 보고서 만들기 (선택 ${progress.total - progress.doneCount}건 남음)`
                  : progress.complete
                    ? "보고서 만들기"
                    : `보고서 만들기 (선택 ${progress.total - progress.doneCount}건 남음)`
                : `필수 ${progress.gateTotal - progress.gateDoneCount}건 남음`}
          </button>
        </div>
        {localVideo.report && (!historyFlow || progress.gateComplete) ? (
          <div className="flex justify-center sm:justify-start">
            <a
              href="#report-draft"
              className="inline-flex items-center justify-center min-h-10 rounded-xl border border-accent/40 bg-white px-4 text-sm font-medium text-accent hover:bg-accent-muted/30"
            >
              초안 보고서 보기
            </a>
          </div>
        ) : null}
        <p className="text-xs text-ink-500 text-center sm:text-left">
          {progress.gateComplete
            ? keepBodyOnComplete
              ? "작성 대기입니다. 확정하면 기존 본문을 유지한 채 팩트체크만 반영합니다."
              : rewriteOnComplete
                ? "작성 대기입니다. 확정하면 본문을 새로 작성합니다."
                : localVideo.reportSkeletonEdited
                  ? "작성 대기입니다. 초안에서 수정한 본문을 유지한 채 확정합니다."
                  : progress.complete
                    ? historyFlow
                      ? "초안을 확인·수정한 뒤 「확정 보고서 만들기」를 누르세요. 이미지는 확정 후입니다."
                      : "작성 대기입니다. 보고서 만들기를 누르면 글쓰기 AI로 본문을 다듬습니다."
                    : "필수 팩트체크는 끝났습니다. 선택 항목은 나중에 보고서에서 이어서 채울 수 있습니다."
            : progress.canFinalizePartial
              ? "필수 항목을 「나중에 해도 됨」으로 표시하거나, 1건 이상 완료 후 미완료 무시하고 만들 수 있습니다."
              : historyFlow
                ? "답변을 붙여넣어 반영하면, 초안 보고서가 열립니다."
                : localVideo.report
                  ? "팩트체크를 하는 동안 아래 초안 보고서를 미리 볼 수 있습니다."
                  : "답변 붙여넣기 적용 후 보고서에서 이미지를 붙이세요."}
        </p>
      </div>
    </section>
  );
}

function StepEditor({
  item,
  index,
  total,
  fc,
  saving,
  onVerdictChange,
  onUpdateTarget,
  onToggleOptional,
  onDeleteTarget,
  onSave,
}: {
  item: SummaryItem;
  index: number;
  total: number;
  fc?: FactCheckResult;
  saving: boolean;
  onVerdictChange?: (verdict: FactCheckVerdict) => void;
  onUpdateTarget: (statement: string, detail: string) => Promise<boolean>;
  onToggleOptional: (optional: boolean) => Promise<boolean>;
  onDeleteTarget: () => Promise<boolean>;
  onSave: (
    answer: string,
    verdict: FactCheckVerdict,
    answerImageUrls?: string[],
    answerParts?: AnswerPart[]
  ) => Promise<boolean>;
}) {
  const prompt = promptOf(item, fc);
  const existingAnswer =
    fc?.explanation && !/^다음 주장을/.test(htmlToPlainText(fc.explanation))
      ? fc.explanation
      : "";
  const [answer, setAnswer] = useState(existingAnswer);
  const [verdict, setVerdict] = useState<FactCheckVerdict>(
    normalizeSimpleVerdict(
      fc?.verdict && fc.verdict !== "pending" ? fc.verdict : "unverifiable"
    )
  );
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editStatement, setEditStatement] = useState(item.statement);
  const [editDetail, setEditDetail] = useState(item.detail || "");
  const [localSaveError, setLocalSaveError] = useState<string | null>(null);

  const [answerParts, setAnswerParts] = useState<AnswerPart[]>(() =>
    resolveAnswerParts({
      explanation: htmlToPlainText(existingAnswer),
      answerParts: fc?.answerParts?.map((p) => ({
        ...p,
        imageUrls: [],
      })),
    })
  );

  useEffect(() => {
    onVerdictChange?.(verdict);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  useEffect(() => {
    const nextAnswer =
      fc?.explanation && !/^다음 주장을/.test(htmlToPlainText(fc.explanation))
        ? fc.explanation
        : "";
    setAnswer(nextAnswer);
    setAnswerParts(
      resolveAnswerParts({
        explanation: htmlToPlainText(nextAnswer),
        answerParts: fc?.answerParts?.map((p) => ({
          ...p,
          imageUrls: [],
        })),
      })
    );
    if (fc?.verdict && fc.verdict !== "pending") {
      const nextV = normalizeSimpleVerdict(fc.verdict);
      setVerdict(nextV);
      onVerdictChange?.(nextV);
    }
    setLocalSaveError(null);
  }, [item.id, fc?.explanation, fc?.verdict]);

  function syncPartsFromAnswer(raw: string) {
    const plain = htmlToPlainText(raw);
    const normalized = normalizeAiAnswer(plain);
    setAnswerParts((prev) => pairAnswerParts(normalized, [], prev));
  }

  function runNormalizeAiAnswer() {
    const cleaned = normalizeAiFactCheckAnswer(htmlToPlainText(answer));
    if (!cleaned) {
      alert("정리할 내용이 없습니다. AI 답변을 붙여넣은 뒤 다시 시도하세요.");
      return;
    }
    setAnswer(cleaned);
    setAnswerParts((prev) => pairAnswerParts(cleaned, [], prev));
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  async function saveTargetEdit() {
    if (editStatement.trim().length < 4) {
      alert("팩트체크 대상 주장을 조금 더 구체적으로 적어 주세요.");
      return;
    }
    const ok = await onUpdateTarget(editStatement.trim(), editDetail);
    if (ok) setEditing(false);
  }

  return (
    <div className="p-4 sm:p-5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-ink-500">
          항목 {index + 1} / {total} · 팩트체크 정리
          {item.factCheckOptional ? (
            <span className="ml-1.5 rounded-md bg-ink-100 px-1.5 py-0.5 text-[10px] font-semibold text-ink-500">
              선택
            </span>
          ) : null}
        </p>
        <div className="flex gap-1.5">
          <button
            type="button"
            disabled={saving || editing}
            onClick={() => {
              setEditStatement(item.statement);
              setEditDetail(item.detail || "");
              setEditing(true);
            }}
            className="inline-flex items-center gap-1 min-h-9 rounded-lg border border-ink-200 bg-white px-2.5 text-xs font-medium text-ink-700 hover:border-accent disabled:opacity-40"
          >
            <Pencil className="h-3.5 w-3.5" />
            대상 수정
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void onDeleteTarget()}
            className="inline-flex items-center gap-1 min-h-9 rounded-lg border border-verify-false/30 bg-white px-2.5 text-xs font-medium text-verify-false hover:bg-verify-false/10 disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
            삭제
          </button>
        </div>
      </div>

      <label className="flex items-start gap-2 rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm text-ink-700 cursor-pointer">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 rounded border-ink-300 text-accent focus:ring-accent/30"
          checked={Boolean(item.factCheckOptional)}
          disabled={saving}
          onChange={(e) => void onToggleOptional(e.target.checked)}
        />
        <span>
          <strong className="font-medium">나중에 해도 됨</strong>
          <span className="block text-xs text-ink-500 mt-0.5">
            선택 항목은 보고서 만들기 필수 조건에서 빠집니다. 완료 후 보고서
            「팩트체크」 탭에서 이어서 채울 수 있습니다.
          </span>
        </span>
      </label>

      <div className="overflow-hidden rounded-xl border border-ink-100">
        <div className="p-3 sm:p-4 bg-ink-50/80 space-y-3">
          {editing ? (
            <div className="space-y-3">
              <label className="block text-xs text-accent font-medium">
                팩트체크 대상 수정
                <textarea
                  value={editStatement}
                  onChange={(e) => setEditStatement(e.target.value)}
                  rows={3}
                  className="mt-1.5 w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-base text-ink-900 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                  placeholder="검증할 주장·문장"
                />
              </label>
              <label className="block text-xs text-ink-500 font-medium">
                왜 확인해야 하나 (선택)
                <textarea
                  value={editDetail}
                  onChange={(e) => setEditDetail(e.target.value)}
                  rows={2}
                  className="mt-1.5 w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-700 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                  placeholder="검증 포인트·맥락"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void saveTargetEdit()}
                  className="min-h-10 rounded-lg bg-ink-900 px-4 text-sm font-medium text-white hover:bg-accent disabled:opacity-50"
                >
                  {saving ? "저장 중…" : "대상 저장"}
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    setEditing(false);
                    setEditStatement(item.statement);
                    setEditDetail(item.detail || "");
                  }}
                  className="min-h-10 rounded-lg border border-ink-200 bg-white px-4 text-sm text-ink-600"
                >
                  취소
                </button>
              </div>
            </div>
          ) : (
            <>
              <div>
                <p className="text-xs text-accent font-medium mb-1">
                  팩트체크 대상
                </p>
                <p className="text-base sm:text-lg font-medium text-ink-900 leading-snug">
                  {item.statement}
                </p>
              </div>
              {item.detail && showDetailBlock(item) && (
                <div className="rounded-lg border border-ink-200 bg-white px-3 py-2.5">
                  <p className="text-xs text-ink-500 font-medium mb-1">
                    검증 포인트
                  </p>
                  <p className="text-sm text-ink-700 leading-relaxed">
                    {item.detail}
                  </p>
                </div>
              )}
            </>
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

      <div className="space-y-2">
        <label className="block text-sm text-ink-700">
          AI 답변 · 팩트체크 결과 입력{" "}
          <span className="text-verify-false">*</span>
          <span className="block text-xs text-ink-500 font-normal mt-0.5">
            제미나이·ChatGPT 답변을 붙여넣은 뒤{" "}
            <strong>AI 답변 정리</strong>로 다듬으세요. 되돌리기·글자색·형광·굵게·줄긋기를
            쓸 수 있습니다. 이미지는 FC에 붙이지 마세요.
          </span>
        </label>
        <FactCheckAnswerEditor
          value={answer}
          onChange={setAnswer}
          onBlur={() => syncPartsFromAnswer(answer)}
          disabled={saving || editing}
          placeholder={
            "예)\n1. 첫 번째 검증 결과…\n\n주요 근거\n상세 설명…\n\n판정: 사실"
          }
        />
        <button
          type="button"
          disabled={!answerPlainLength(answer) || saving || editing}
          onClick={runNormalizeAiAnswer}
          className="inline-flex items-center gap-1.5 min-h-10 rounded-xl border border-accent/40 bg-accent-muted/30 px-3 text-sm font-medium text-ink-900 hover:bg-accent-muted disabled:opacity-50"
        >
          <Sparkles className="h-4 w-4" />
          AI 답변 정리
        </button>
      </div>

      <div className="rounded-xl border border-accent/25 bg-accent-muted/30 p-3 space-y-3">
        <div>
          <p className="text-xs font-medium text-accent">
            번호별 답변 미리보기
          </p>
          <p className="text-[11px] text-ink-500 mt-0.5">
            붙여넣은 글을 번호 단위로 나눈 확인용입니다. 판정만 고른 뒤 「이
            항목 저장하고 다음」이면 됩니다. (이미지 첨부 없음)
          </p>
        </div>

        {answerParts.length === 0 ? (
          <p className="text-sm text-ink-500 rounded-lg border border-dashed border-ink-200 bg-white px-3 py-4 text-center">
            위에 답변을 붙여넣으면 번호 칸이 생깁니다.
          </p>
        ) : (
          answerParts.map((part) => (
            <div
              key={part.number}
              className="rounded-xl border border-ink-200 bg-white p-3 space-y-2"
            >
              <div className="flex items-start gap-2">
                <span className="shrink-0 inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-ink-900 text-xs font-bold text-white">
                  {part.number}
                </span>
                <p className="text-sm text-ink-800 leading-relaxed whitespace-pre-wrap flex-1">
                  {part.text || (
                    <span className="text-ink-400">(텍스트 없음)</span>
                  )}
                </p>
              </div>
            </div>
          ))
        )}
      </div>

      <div>
        <p className="text-sm text-ink-700 mb-2">판정 (선택)</p>
        <div className="flex flex-wrap gap-2">
          {FC_VERDICT_OPTIONS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => {
                setVerdict(v);
                onVerdictChange?.(v);
              }}
              className={`min-h-10 rounded-lg border px-3 text-sm ${
                verdict === v
                  ? "border-accent bg-accent-muted text-ink-900"
                  : "border-ink-200 bg-white text-ink-600"
              }`}
            >
              {verdictLabel(v)}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-ink-500">
          판정만 고른 상태로는 저장되지 않습니다. 아래 저장을 눌러야 반영됩니다.
        </p>
      </div>

      <button
        type="button"
        disabled={saving || editing || answerPlainLength(answer) < 20}
        onClick={() => {
          void (async () => {
            setLocalSaveError(null);
            syncPartsFromAnswer(answer);
            const parts = pairAnswerParts(
              htmlToPlainText(answer),
              [],
              answerParts
            ).map((p) => ({
              ...p,
              imageUrls: [] as string[],
            }));
            const ok = await onSave(answer, verdict, undefined, parts);
            if (!ok) {
              setLocalSaveError(
                "저장되지 않았습니다. 위쪽 빨간 오류 메시지를 확인하거나 다시 시도해 주세요."
              );
            }
          })();
        }}
        className="w-full min-h-12 rounded-xl bg-ink-900 text-white font-medium hover:bg-accent disabled:opacity-50 transition-colors inline-flex items-center justify-center gap-2"
      >
        {saving ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            저장 중…
          </>
        ) : (
          "이 항목 저장하고 다음"
        )}
      </button>
      {localSaveError && (
        <p className="text-sm text-verify-false" role="alert">
          {localSaveError}
        </p>
      )}
      {answerPlainLength(answer) > 0 && answerPlainLength(answer) < 20 && (
        <p className="text-[11px] text-amber-800">
          답변이 20자 이상이어야 저장할 수 있습니다.
        </p>
      )}
    </div>
  );
}
