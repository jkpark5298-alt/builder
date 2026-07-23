"use client";

import {
  Check,
  ClipboardPaste,
  FileText,
  Loader2,
  Save,
} from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { hasUsablePastedScript, normalizePastedText } from "@/lib/paste";
import { cacheVideoSnapshot } from "./VideoNotFoundRecovery";

const STORAGE_KEY = "yfc-report-form-v1";
const POST_TIMEOUT_MS = 150_000;

export type ReportFormValues = {
  title: string;
  channel: string;
  creatorNotes: string;
  pastedScript: string;
};

function loadSaved(): Partial<ReportFormValues> {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<ReportFormValues>) : {};
  } catch {
    return {};
  }
}

function saveForm(data: ReportFormValues) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* quota */
  }
}

export function ReportCreateForm({
  draftId,
  initial,
}: {
  /** 서버 임시 저장 항목 ID — 있으면 PATCH로 이어쓰기 */
  draftId?: string;
  initial?: Partial<ReportFormValues>;
}) {
  const feedbackRef = useRef<HTMLDivElement>(null);
  const [activeDraftId, setActiveDraftId] = useState(draftId);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [channel, setChannel] = useState(initial?.channel ?? "");
  const [creatorNotes, setCreatorNotes] = useState(initial?.creatorNotes ?? "");
  const [pastedScript, setPastedScript] = useState(initial?.pastedScript ?? "");
  const [loading, setLoading] = useState(false);
  const [draftSaving, setDraftSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(Boolean(draftId || initial));

  useEffect(() => {
    if (draftId || initial) return;
    const saved = loadSaved();
    if (saved.title) setTitle(saved.title);
    if (saved.channel) setChannel(saved.channel);
    if (saved.creatorNotes) setCreatorNotes(saved.creatorNotes);
    if (saved.pastedScript) setPastedScript(saved.pastedScript);
    setHydrated(true);
  }, [draftId, initial]);

  useEffect(() => {
    if (!hydrated || draftId || initial) return;
    saveForm({ title, channel, creatorNotes, pastedScript });
  }, [title, channel, creatorNotes, pastedScript, hydrated, draftId, initial]);

  const scriptLen = normalizePastedText(pastedScript).length;
  const hasScript = hasUsablePastedScript(pastedScript);
  const step1Done = title.trim().length >= 2;
  const step2Done = hasScript;
  const isContinuing = Boolean(activeDraftId);

  function formPayload() {
    return {
      title: title.trim(),
      channel: channel.trim() || undefined,
      creatorNotes: creatorNotes.trim() || undefined,
      pastedScript: normalizePastedText(pastedScript),
    };
  }

  async function saveDraft() {
    setError(null);
    if (!step1Done) {
      setError("제목을 2자 이상 입력해 주세요.");
      return;
    }

    setDraftSaving(true);
    setStatus(null);
    try {
      if (activeDraftId) {
        const res = await fetch(`/api/videos/${activeDraftId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ updateReportInput: formPayload() }),
        });
        const data = (await res.json()) as { error?: string; video?: { id: string } };
        if (!res.ok) {
          throw new Error(data.error || "임시 저장 실패");
        }
        setStatus("임시 저장됨. 나중에 이어서 작성할 수 있습니다.");
      } else {
        const res = await fetch("/api/videos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "report_draft", ...formPayload() }),
        });
        const data = (await res.json()) as {
          error?: string;
          video?: { id: string };
        };
        if (!res.ok || !data.video?.id) {
          throw new Error(data.error || "임시 저장 실패");
        }
        setActiveDraftId(data.video.id);
        cacheVideoSnapshot(data.video);
        setStatus("임시 저장됨. 홈 「임시 저장」 목록에서 이어서 작성할 수 있습니다.");
        if (!draftId) {
          window.history.replaceState(null, "", `/videos/${data.video.id}`);
        }
      }
      feedbackRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "임시 저장 실패");
    } finally {
      setDraftSaving(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!step1Done) {
      setError("제목을 2자 이상 입력해 주세요.");
      return;
    }
    if (!hasScript) {
      setError(
        scriptLen > 0
          ? `스크립트가 ${scriptLen}자입니다. 80자 이상 붙여넣어 주세요.`
          : "스크립트(본문)를 붙여넣어 주세요."
      );
      return;
    }

    setLoading(true);
    setStatus("요약·검증 중… (1~3분 걸릴 수 있어요)");
    feedbackRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), POST_TIMEOUT_MS);

    try {
      if (activeDraftId) {
        const res = await fetch(`/api/videos/${activeDraftId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            startReportPipeline: true,
            updateReportInput: formPayload(),
          }),
        });
        const data = (await res.json()) as {
          error?: string;
          video?: { id: string };
        };
        if (!res.ok || !data.video?.id) {
          throw new Error(data.error || "Report 생성 실패");
        }
        cacheVideoSnapshot(data.video);
        setStatus("완료. 팩트체크 화면으로 이동합니다…");
        window.location.assign(`/videos/${data.video.id}`);
        return;
      }

      const res = await fetch("/api/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          mode: "report",
          ...formPayload(),
        }),
      });

      const data = (await res.json()) as {
        error?: string;
        video?: { id: string };
      };
      if (!res.ok || !data.video?.id) {
        throw new Error(data.error || "Report 생성 실패");
      }

      cacheVideoSnapshot(data.video);
      setStatus("완료. 팩트체크 화면으로 이동합니다…");
      window.location.assign(`/videos/${data.video.id}`);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError(
          "요약에 시간이 오래 걸렸습니다. Wi‑Fi를 확인하고 다시 시도해 주세요."
        );
      } else {
        setError(err instanceof Error ? err.message : "처리 실패");
      }
      setStatus(null);
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  }

  return (
    <form
      id="report-create"
      onSubmit={onSubmit}
      className="relative overflow-hidden rounded-2xl border border-ink-200 bg-white/80 p-5 sm:p-6 shadow-sm pb-28 sm:pb-6"
    >
      <div className="relative space-y-4">
        <div className="flex items-center gap-2 text-accent">
          <FileText className="h-5 w-5" />
          <span className="text-sm font-medium tracking-wide uppercase">
            Report 생성
          </span>
        </div>
        <div>
          <h2 className="font-display text-2xl sm:text-3xl text-ink-900 mb-2">
            {isContinuing ? "입력 이어서 작성" : "스크립트로 보고서 만들기"}
          </h2>
          <p className="text-sm text-ink-600 leading-relaxed">
            {isContinuing ? (
              <>
                제목·스크립트를 채운 뒤 <strong>임시 저장</strong>하거나, 스크립트가
                80자 이상이면 <strong>요약 · 검증 시작</strong>으로 다음 단계로
                넘어갑니다.
              </>
            ) : (
              <>
                유튜브 URL·자막 자동 가져오기 없이,{" "}
                <strong>제목·스크립트만</strong> 넣으면 요약·팩트체크·보고서·인포그래픽
                흐름은 유튜브와 동일합니다. 일부만 입력해도{" "}
                <strong>임시 저장</strong>할 수 있습니다.
              </>
            )}
          </p>
        </div>

        <label className="block text-sm text-ink-600">
          ① 제목 <span className="text-verify-false">*</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="보고서·강연·기사 제목"
            className="mt-1.5 w-full rounded-xl border border-ink-200 bg-white px-4 py-3.5 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </label>

        <label className="block text-sm text-ink-600">
          채널·작성자 (선택)
          <input
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            placeholder="예: 직접 입력, 홍길동, ○○신문"
            className="mt-1.5 w-full rounded-xl border border-ink-200 bg-white px-4 py-3 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </label>

        <label className="block text-sm text-ink-600">
          메모·목차 (선택)
          <textarea
            value={creatorNotes}
            onChange={(e) => setCreatorNotes(e.target.value)}
            rows={2}
            placeholder="0:00 서론, 5:30 본론… 또는 배경 설명"
            className="mt-1.5 w-full rounded-xl border border-ink-200 bg-white px-3 py-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </label>

        <label className="block text-sm text-ink-600">
          ② 스크립트(본문)
          {!isContinuing && <span className="text-verify-false"> *</span>}
          {isContinuing && (
            <span className="text-ink-400"> (80자 이상이면 다음 단계 가능)</span>
          )}
          <textarea
            value={pastedScript}
            onChange={(e) => setPastedScript(e.target.value)}
            rows={8}
            placeholder="강연 원고, 기사 본문, 회의록 등 — 일부만 넣어도 임시 저장 가능"
            className={`mt-1.5 w-full rounded-xl border bg-white px-3 py-3 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 ${
              hasScript
                ? "border-emerald-300 ring-1 ring-emerald-200"
                : "border-ink-200"
            }`}
          />
        </label>
        {scriptLen > 0 && (
          <p
            className={`text-xs font-medium ${
              hasScript ? "text-emerald-700" : "text-ink-500"
            }`}
          >
            {hasScript
              ? `✓ 스크립트 준비됨 · ${scriptLen.toLocaleString()}자`
              : `${scriptLen}자 · 80자 이상이면 요약·검증 시작 가능`}
          </p>
        )}

        <div ref={feedbackRef} className="space-y-2">
          {(loading || draftSaving || status) && (
            <div
              className="rounded-xl border border-ink-200 bg-ink-50 px-4 py-3 text-sm text-ink-700"
              role="status"
            >
              {status || (draftSaving ? "임시 저장 중…" : "처리 중…")}
            </div>
          )}
          {error && (
            <p
              className="rounded-xl border border-verify-false/30 bg-verify-false/5 px-4 py-3 text-sm text-verify-false font-medium"
              role="alert"
            >
              {error}
            </p>
          )}
        </div>
      </div>

      <div className="fixed bottom-0 inset-x-0 z-40 sm:static sm:z-auto border-t border-ink-200 sm:border-0 bg-white/95 sm:bg-transparent backdrop-blur px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-0 sm:mt-4 space-y-2">
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            onClick={saveDraft}
            disabled={loading || draftSaving || !step1Done}
            className="w-full sm:flex-1 inline-flex items-center justify-center gap-2 rounded-xl border border-ink-300 bg-white min-h-12 px-5 py-3.5 text-ink-800 font-medium hover:border-accent hover:bg-accent-muted/30 disabled:opacity-50 transition-colors"
          >
            {draftSaving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                저장 중…
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                임시 저장
              </>
            )}
          </button>
          <button
            type="submit"
            disabled={loading || draftSaving}
            className="w-full sm:flex-[1.4] inline-flex items-center justify-center gap-2 rounded-xl bg-accent min-h-12 px-5 py-3.5 text-white font-medium hover:bg-ink-900 disabled:opacity-60 transition-colors shadow-lg sm:shadow-none"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                요약·검증 중…
              </>
            ) : !step1Done ? (
              "먼저 ① 제목 입력"
            ) : !step2Done ? (
              "80자 이상 스크립트 필요"
            ) : (
              <>
                <ClipboardPaste className="h-4 w-4" />
                3. 요약 · 검증 시작
              </>
            )}
          </button>
        </div>
        {step1Done && step2Done && !loading && (
          <p className="text-center text-xs text-ink-500 flex items-center justify-center gap-1">
            <Check className="h-3.5 w-3.5 text-emerald-600" />
            유튜브와 동일한 팩트체크·보고서·PDF·인포그래픽
          </p>
        )}
        {step1Done && !step2Done && !loading && (
          <p className="text-center text-xs text-ink-500">
            스크립트가 부족해도 <strong>임시 저장</strong>으로 나중에 이어쓸 수
            있습니다.
          </p>
        )}
      </div>
    </form>
  );
}
