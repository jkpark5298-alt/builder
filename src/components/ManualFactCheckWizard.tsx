"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileText,
  Loader2,
  Pencil,
  Save,
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
import { compressDataUrls } from "@/lib/image-client";
import { normalizeImageUrls } from "@/lib/image-urls";
import {
  pairAnswerParts,
  partsToExplanation,
  partsToImageUrls,
  resolveAnswerParts,
} from "@/lib/answer-parts";
import { factCheckGuideForItem } from "@/lib/report";
import { normalizeAiAnswer } from "@/lib/text-format";
import { ReportTypePicker } from "@/components/ReportTypePicker";
import { FactCheckRevisedBanner } from "@/components/FactCheckRevisedBanner";
import { ImageAttachArea } from "@/components/ImageAttachArea";

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
    if (serverNewer || serverMoreChecks || noticeChanged) {
      setLocalVideo(video);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync only when server props change
  }, [video.updatedAt, video.factChecks, video.factCheckRevisionNotice?.at]);

  const required = useMemo(
    () => localVideo.items.filter((i) => i.needsFactCheck),
    [localVideo.items]
  );
  const progress = factCheckProgress(localVideo);
  const firstOpen = Math.max(
    0,
    required.findIndex((i) => !isItemChecked(i.id, localVideo.factChecks))
  );
  const [step, setStep] = useState(firstOpen === -1 ? 0 : firstOpen);
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);
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
  ) {
    setSaving(true);
    setError(null);
    setSavedFlash(false);
    try {
      const rawParts =
        answerParts ?? pairAnswerParts(answer, answerImageUrls ?? []);
      const explanation =
        partsToExplanation(rawParts) || normalizeAiAnswer(answer);
      if (explanation.trim().length < 20) {
        throw new Error("AI 답변을 조금 더 자세히 입력해 주세요. (20자 이상)");
      }
      const safeVerdict =
        verdict === "pending" ? "unverifiable" : verdict;

      // 1) 텍스트·판정만 먼저 저장 (대용량 이미지로 타임아웃 나지 않게)
      const textParts = rawParts.map((p) => ({ ...p, imageUrls: [] as string[] }));
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 45000);
      let res: Response;
      try {
        res = await fetch(`/api/videos/${localVideo.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            draft: true,
            factCheck: {
              itemId,
              verdict: safeVerdict,
              explanation,
              sources: [],
              answerImageUrls: [],
              answerParts: textParts,
            },
          }),
        });
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
          throw new Error(
            "저장 시간이 초과됐습니다. 네트워크를 확인한 뒤 다시 시도해 주세요."
          );
        }
        throw e;
      } finally {
        window.clearTimeout(timer);
      }

      let data: {
        error?: string;
        warning?: string;
        video?: VideoRecord;
      } = {};
      try {
        data = (await res.json()) as typeof data;
      } catch {
        if (!res.ok) throw new Error(`저장 실패 (HTTP ${res.status})`);
      }
      if (!res.ok) throw new Error(data.error || `저장 실패 (HTTP ${res.status})`);

      const fc: FactCheckResult = {
        itemId,
        mode: "manual",
        verdict: safeVerdict,
        explanation,
        sources: [],
        checkedAt: new Date().toISOString(),
        answerParts: textParts,
      };

      // 로컬에 이미지 유지(서버는 용량상 생략할 수 있음)
      let compressedParts = textParts;
      const hasImages = rawParts.some((p) => (p.imageUrls?.length ?? 0) > 0);
      let imageWarning = data.warning;

      if (hasImages) {
        try {
          compressedParts = [];
          for (const p of rawParts) {
            compressedParts.push({
              ...p,
              imageUrls: await compressDataUrls(p.imageUrls ?? [], 220_000, 720),
            });
          }
          const images = partsToImageUrls(compressedParts);
          const imgRes = await fetch(`/api/videos/${localVideo.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              answerImages: {
                itemId,
                imageUrls: images,
                answerParts: compressedParts,
              },
            }),
          });
          if (imgRes.ok) {
            const imgData = (await imgRes.json()) as {
              video?: VideoRecord;
              warning?: string;
            };
            if (imgData.video) data.video = imgData.video;
            if (imgData.warning) imageWarning = imgData.warning;
            fc.answerImageUrl = images[0];
            fc.answerImageUrls = images.length ? images : undefined;
            fc.answerParts = compressedParts;
          } else {
            imageWarning =
              "답변은 저장됐습니다. 이미지는 용량 문제로 제외됐습니다.";
          }
        } catch {
          imageWarning =
            "답변은 저장됐습니다. 이미지는 용량 문제로 제외됐습니다.";
          compressedParts = textParts;
        }
      }

      if (data.video) {
        // 서버 슬림 응답에 이미지가 없어도, 방금 저장한 항목은 로컬 이미지 유지
        const mergedChecks = [
          ...data.video.factChecks.filter((f) => f.itemId !== itemId),
          {
            ...(data.video.factChecks.find((f) => f.itemId === itemId) ?? fc),
            ...fc,
          },
        ];
        setLocalVideo({ ...data.video, factChecks: mergedChecks });
      } else {
        setLocalVideo((prev) => ({
          ...prev,
          factChecks: [
            ...prev.factChecks.filter((f) => f.itemId !== itemId),
            fc,
          ],
          updatedAt: new Date().toISOString(),
        }));
      }

      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 2500);
      if (imageWarning) {
        // 성공이지만 이미지 제외 안내 — 빨간 에러가 아니라 상태 문구로
        setError(null);
        window.setTimeout(() => {
          setError(imageWarning);
          window.setTimeout(() => setError(null), 4000);
        }, 100);
      }
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
      const res = await fetch(`/api/videos/${localVideo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          completeManual: true,
          reportType: localVideo.reportType,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        video?: VideoRecord;
      };
      if (!res.ok) throw new Error(data.error || "보고서 생성 실패");
      if (data.video) setLocalVideo(data.video);
      router.push("/#reports");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "보고서 생성 실패");
    } finally {
      setCompleting(false);
    }
  }

  async function updateTarget(
    itemId: string,
    patch: { statement: string; detail: string }
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
            statement: patch.statement,
            detail: patch.detail.trim() ? patch.detail : null,
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
    if (progress.complete) {
      router.push("/#reports");
    } else {
      router.push("/#drafts");
    }
    router.refresh();
  }

  if (required.length === 0) {
    return (
      <div className="rounded-2xl border border-ink-200 bg-white p-5 text-center space-y-4">
        <p className="text-ink-700">
          검증이 필요한 주장이 없습니다. 바로 보고서를 만들 수 있습니다.
        </p>
        <div className="flex flex-col sm:flex-row gap-2 justify-center">
          <button
            type="button"
            onClick={saveDraftAndLeave}
            className="w-full sm:w-auto min-h-12 rounded-xl border border-accent/40 bg-accent-muted/40 px-5 py-3 font-medium hover:bg-accent-muted"
          >
            보고서 저장 목록으로
          </button>
          <button
            type="button"
            onClick={completeAndGenerate}
            disabled={completing}
            className="w-full sm:w-auto min-h-12 rounded-xl bg-ink-900 px-5 py-3 text-white font-medium hover:bg-accent disabled:opacity-60"
          >
            {completing ? "생성 중…" : "보고서 저장 → PDF·인포그래픽"}
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
        <FactCheckRevisedBanner
          video={localVideo}
          onDismissed={setLocalVideo}
        />
        <p className="text-sm text-ink-600">
          아래 <strong>AI 질문</strong>을 복사해 제미나이 등에 물어본 뒤,{" "}
          <strong>AI 답변·팩트체크 결과</strong>를 이 화면에 붙여넣으세요.
        </p>

        <div className="mt-4">
          <ReportTypePicker
            video={localVideo}
            compact
            onVideoUpdate={setLocalVideo}
          />
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
              const done = isItemChecked(item.id, localVideo.factChecks);
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
                  {done ? (
                    <span className="inline-flex items-center justify-center gap-0.5">
                      <CheckCircle2 className="h-4 w-4" />
                      <span className="sr-only">완료</span>
                    </span>
                  ) : (
                    i + 1
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {current && (
        <StepEditor
          key={current.id}
          videoId={localVideo.id}
          item={current}
          index={step}
          total={required.length}
          imageFallback={localVideo.thumbnailUrl}
          fc={fcMap.get(current.id)}
          saving={saving}
          onVideoUpdate={setLocalVideo}
          onUpdateTarget={(statement, detail) =>
            updateTarget(current.id, { statement, detail })
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
          }}
        />
      )}

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
              onClick={() =>
                setStep((s) => Math.min(required.length - 1, s + 1))
              }
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1 min-h-12 rounded-xl border border-ink-200 px-4 text-sm font-medium disabled:opacity-40"
            >
              다음
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <button
            type="button"
            onClick={saveDraftAndLeave}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 min-h-12 rounded-xl border border-accent/40 bg-accent-muted/40 px-5 text-sm font-medium text-ink-900 hover:bg-accent-muted transition-colors"
          >
            <Save className="h-4 w-4" />
            {progress.complete
              ? "보고서 저장 목록으로"
              : "임시 저장하고 목록으로"}
          </button>
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
                ? "보고서 저장 → PDF·인포그래픽"
                : `미완료 ${progress.total - progress.doneCount}건`}
          </button>
        </div>
        <p className="text-xs text-ink-500 text-center sm:text-left">
          {progress.complete
            ? "팩트체크가 끝났습니다. 보고서를 만들면 «보고서 저장» 완료로 이동합니다."
            : "「이 항목 저장하고 다음」을 누르면 바로 저장됩니다. 한 번이면 충분합니다."}
        </p>
      </div>
    </section>
  );
}

function StepEditor({
  videoId,
  item,
  index,
  total,
  imageFallback,
  fc,
  saving,
  onVideoUpdate,
  onUpdateTarget,
  onDeleteTarget,
  onSave,
}: {
  videoId: string;
  item: SummaryItem;
  index: number;
  total: number;
  imageFallback: string;
  fc?: FactCheckResult;
  saving: boolean;
  onVideoUpdate: (video: VideoRecord) => void;
  onUpdateTarget: (statement: string, detail: string) => Promise<boolean>;
  onDeleteTarget: () => Promise<boolean>;
  onSave: (
    answer: string,
    verdict: FactCheckVerdict,
    answerImageUrls?: string[],
    answerParts?: AnswerPart[]
  ) => Promise<void>;
}) {
  const router = useRouter();
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
  const [itemImages, setItemImages] = useState<string[]>(() =>
    normalizeImageUrls(item.imageUrl, item.imageUrls)
  );
  const [itemImageBusy, setItemImageBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editStatement, setEditStatement] = useState(item.statement);
  const [editDetail, setEditDetail] = useState(item.detail || "");

  const [answerParts, setAnswerParts] = useState<AnswerPart[]>(() =>
    resolveAnswerParts({
      explanation: existingAnswer,
      answerImageUrl: fc?.answerImageUrl,
      answerImageUrls: fc?.answerImageUrls,
      answerParts: fc?.answerParts,
    })
  );

  useEffect(() => {
    setItemImages(normalizeImageUrls(item.imageUrl, item.imageUrls));
    const nextAnswer =
      fc?.explanation && !/^다음 주장을/.test(fc.explanation)
        ? fc.explanation
        : "";
    setAnswer(nextAnswer);
    setAnswerParts(
      resolveAnswerParts({
        explanation: nextAnswer,
        answerImageUrl: fc?.answerImageUrl,
        answerImageUrls: fc?.answerImageUrls,
        answerParts: fc?.answerParts,
      })
    );
  }, [
    item.id,
    item.imageUrl,
    item.imageUrls,
    fc?.explanation,
    fc?.answerImageUrl,
    fc?.answerImageUrls,
    fc?.answerParts,
  ]);

  function syncPartsFromAnswer(raw: string) {
    const normalized = normalizeAiAnswer(raw);
    setAnswer(normalized);
    setAnswerParts((prev) =>
      pairAnswerParts(normalized, partsToImageUrls(prev), prev)
    );
  }

  async function persistItemImages(urls: string[]) {
    setItemImageBusy(true);
    try {
      const compressed = await compressDataUrls(urls);
      const res = await fetch(`/api/videos/${videoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemImages: { itemId: item.id, imageUrls: compressed },
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        video?: VideoRecord;
      };
      if (!res.ok) throw new Error(data.error || "이미지 저장 실패");
      setItemImages(compressed);
      if (data.video) onVideoUpdate(data.video);
      router.refresh();
    } catch (e) {
      alert(
        e instanceof Error
          ? e.message
          : "이미지 저장에 실패했습니다. 다시 시도해 주세요."
      );
    } finally {
      setItemImageBusy(false);
    }
  }

  async function persistPartImages(partNumber: number, urls: string[]) {
    // 이미지 첨부는 화면에만 반영 → 「이 항목 저장하고 다음」에서 한꺼번에 저장
    // (중간 API 호출은 용량·타임아웃으로 실패해 체크 미표시의 원인이었음)
    const nextParts = answerParts.map((p) =>
      p.number === partNumber ? { ...p, imageUrls: urls } : p
    );
    const has = nextParts.some((p) => p.number === partNumber);
    const finalParts = has
      ? nextParts
      : [
          ...nextParts,
          { number: partNumber, text: "", imageUrls: urls },
        ].sort((a, b) => a.number - b.number);

    setAnswerParts(finalParts);
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

      <div className="overflow-hidden rounded-xl border border-ink-100">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={itemImages[0] || imageFallback}
          alt=""
          className="w-full aspect-video object-cover bg-ink-900"
        />
        <div className="p-3 bg-ink-50 border-t border-ink-100">
          <ImageAttachArea
            images={itemImages}
            busy={itemImageBusy}
            label="대상 이미지 추가"
            hint="붙여넣기 · 텍스트→이미지"
            initialText={item.statement}
            onChange={(urls) => void persistItemImages(urls)}
          />
        </div>
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

      <label className="block text-sm text-ink-700">
        AI 답변 · 팩트체크 결과 입력{" "}
        <span className="text-verify-false">*</span>
        <span className="block text-xs text-ink-500 font-normal mt-0.5">
          제미나이·ChatGPT 답변을 붙여넣으세요.{" "}
          <strong>1. 2. 번호</strong>로 쓰면 아래 이미지와 같은 번호로
          묶입니다.
        </span>
        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onBlur={() => syncPartsFromAnswer(answer)}
          rows={7}
          className="mt-1.5 w-full rounded-xl border border-ink-200 px-3 py-3 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          placeholder={"예)\n1. 첫 번째 검증 결과…\n2. 두 번째 검증 결과…"}
        />
      </label>

      <div className="rounded-xl border border-accent/25 bg-accent-muted/30 p-3 space-y-3">
        <div>
          <p className="text-xs font-medium text-accent">
            번호별 텍스트 · 이미지 묶음
          </p>
          <p className="text-[11px] text-ink-500 mt-0.5">
            같은 번호의 텍스트와 이미지가 보고서에도 함께 표시됩니다. 이미지는
            붙인 뒤 「이 항목 저장하고 다음」으로 함께 저장됩니다.
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
                    <span className="text-ink-400">
                      (이 번호 텍스트 없음 — 이미지만)
                    </span>
                  )}
                </p>
              </div>
              <ImageAttachArea
                images={part.imageUrls}
                label={`${part.number}번 이미지 추가`}
                hint="같은 번호로 묶임 · 붙여넣기 · 텍스트→이미지"
                initialText={part.text}
                maxImages={6}
                onChange={(urls) => void persistPartImages(part.number, urls)}
              />
            </div>
          ))
        )}
      </div>

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
        disabled={saving || editing || answer.trim().length < 20}
        onClick={() => {
          const parts = pairAnswerParts(
            answer,
            partsToImageUrls(answerParts),
            answerParts
          );
          void onSave(
            partsToExplanation(parts) || answer,
            verdict,
            partsToImageUrls(parts),
            parts
          );
        }}
        className="w-full min-h-12 rounded-xl bg-ink-900 text-white font-medium hover:bg-accent disabled:opacity-50 transition-colors inline-flex items-center justify-center gap-2"
      >
        {saving ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            저장 중… (이미지 포함)
          </>
        ) : (
          "이 항목 저장하고 다음"
        )}
      </button>
    </div>
  );
}
