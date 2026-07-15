"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, Link2 } from "lucide-react";
import { hasUsablePastedScript, normalizePastedText } from "@/lib/paste";
import { extractVideoId } from "@/lib/youtube";
import { ScriptCopyHelper } from "./ScriptCopyHelper";
import { cacheVideoSnapshot } from "./VideoNotFoundRecovery";

const STORAGE_KEY = "yfc-form-v1";
const POST_TIMEOUT_MS = 20_000;
const POST_SCRIPT_TIMEOUT_MS = 90_000;

type SavedForm = {
  url: string;
  creatorNotes: string;
  pastedScript: string;
};

function loadSaved(): Partial<SavedForm> {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<SavedForm>) : {};
  } catch {
    return {};
  }
}

function saveForm(data: SavedForm) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* quota */
  }
}

export function UrlPasteForm() {
  const feedbackRef = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState("");
  const [creatorNotes, setCreatorNotes] = useState("");
  const [pastedScript, setPastedScript] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const saved = loadSaved();
    if (saved.url) setUrl(saved.url);
    if (saved.creatorNotes) setCreatorNotes(saved.creatorNotes);
    if (saved.pastedScript) setPastedScript(saved.pastedScript);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveForm({ url, creatorNotes, pastedScript });
  }, [url, creatorNotes, pastedScript, hydrated]);

  const scriptLen = normalizePastedText(pastedScript).length;
  const hasScript = hasUsablePastedScript(pastedScript);

  function goToVideo(id: string) {
    window.location.assign(`/videos/${id}`);
  }

  async function startAnalyze(withScript: boolean) {
    setError(null);
    setLoading(true);
    setStatus(
      withScript
        ? "스크립트로 요약·검증 중… (최대 1~2분, 화면을 끄지 마세요)"
        : "요청 접수 중… 자막 자동 수집을 시도합니다."
    );
    feedbackRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      withScript ? POST_SCRIPT_TIMEOUT_MS : POST_TIMEOUT_MS
    );

    try {
      const res = await fetch("/api/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          youtubeUrl: url.trim(),
          creatorNotes: creatorNotes.trim() || undefined,
          pastedScript: withScript
            ? normalizePastedText(pastedScript)
            : undefined,
        }),
      });

      const raw = await res.text();
      let data: {
        error?: string;
        video?: { id: string };
        processing?: boolean;
      } = {};
      try {
        data = raw ? (JSON.parse(raw) as typeof data) : {};
      } catch {
        throw new Error(
          res.ok
            ? "서버 응답을 읽지 못했습니다."
            : `서버 오류 (${res.status}). 잠시 후 다시 시도해 주세요.`
        );
      }

      if (!res.ok) {
        throw new Error(data.error || `처리 실패 (${res.status})`);
      }
      if (!data.video?.id) {
        throw new Error("영상 ID를 받지 못했습니다. 다시 시도해 주세요.");
      }

      cacheVideoSnapshot(data.video);
      setStatus("완료. 팩트체크 화면으로 이동합니다…");
      goToVideo(data.video.id);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError(
          withScript
            ? "요약에 시간이 오래 걸렸습니다. Wi‑Fi를 확인하고 다시 눌러 주세요. (스크립트는 화면에 남아 있습니다)"
            : "접수 시간이 초과됐습니다. Wi‑Fi/데이터를 확인한 뒤 다시 시도해 주세요."
        );
      } else {
        const message = err instanceof Error ? err.message : "처리 실패";
        if (/Failed to fetch|NetworkError|Load failed|fetch/i.test(message)) {
          setError(
            "서버에 연결할 수 없습니다. Wi‑Fi/데이터를 확인한 뒤 다시 시도해 주세요."
          );
        } else {
          setError(message);
        }
      }
      setStatus(null);
      feedbackRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      setError(
        "유튜브 주소가 비어 있습니다. 유튜브 앱에서 링크 복사 후 ① 주소 칸에 붙여넣어 주세요."
      );
      feedbackRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (!extractVideoId(trimmedUrl)) {
      setError(
        "유효한 유튜브 URL이 아닙니다. 공유 → 링크 복사로 다시 붙여넣어 주세요."
      );
      feedbackRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    if (!hasScript && scriptLen > 0 && scriptLen <= 80) {
      setError(
        `스크립트가 ${scriptLen}자입니다. 80자 이상 붙여넣은 뒤 다시 눌러 주세요.`
      );
      feedbackRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    await startAnalyze(hasScript);
  }

  const busy = loading;

  return (
    <form
      id="paste"
      onSubmit={onSubmit}
      className="relative overflow-hidden rounded-2xl border border-ink-200 bg-white/80 p-5 sm:p-6 shadow-sm pb-28 sm:pb-6"
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "radial-gradient(circle at 10% 20%, rgba(196,92,38,0.15), transparent 40%), radial-gradient(circle at 90% 80%, rgba(26,36,48,0.08), transparent 35%)",
        }}
      />
      <div className="relative space-y-4">
        <div className="flex items-center gap-2 text-accent">
          <Link2 className="h-5 w-5" />
          <span className="text-sm font-medium tracking-wide uppercase">
            Share & Summarize
          </span>
        </div>
        <div>
          <h1 className="font-display text-2xl sm:text-3xl md:text-4xl text-ink-900 mb-2">
            YouTube FactCheck
          </h1>
          <div className="mt-3 rounded-xl border border-ink-200 bg-white/90 overflow-hidden text-sm">
            <div className="px-3 py-2 bg-ink-50 border-b border-ink-200 text-ink-700 text-xs sm:text-sm">
              배포(아이폰)에서는 <strong>자동 자막 버튼이 없습니다</strong>.
              주소 + 스크립트(또는 AI 요약)를 넣고 하단 버튼으로 진행하세요.
            </div>
            <div className="grid grid-cols-[1fr_1.2fr] bg-ink-50 border-b border-ink-200 font-medium text-ink-800">
              <div className="px-3 py-2">어디에 붙여넣나</div>
              <div className="px-3 py-2">무엇을 붙여넣나</div>
            </div>
            <div className="grid grid-cols-[1fr_1.2fr] border-b border-ink-100">
              <div className="px-3 py-2.5 text-accent font-medium">① 유튜브 주소</div>
              <div className="px-3 py-2.5 text-ink-700">
                공유 → <strong>링크 복사</strong> (앱 전환해도 주소 유지)
              </div>
            </div>
            <div className="grid grid-cols-[1fr_1.2fr]">
              <div className="px-3 py-2.5 text-accent font-medium">② 스크립트</div>
              <div className="px-3 py-2.5 text-ink-700">
                「자막 요청」→ youtubetranscript.com → 복사 → 붙여넣기 (80자+)
              </div>
            </div>
          </div>
        </div>

        <label className="block text-sm text-ink-600">
          ① 유튜브 주소
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="유튜브에서 공유 → 링크 붙여넣기"
            inputMode="url"
            enterKeyHint="go"
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="url"
            className="mt-1.5 w-full rounded-xl border border-ink-200 bg-white px-4 py-3.5 text-base text-ink-900 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </label>

        <div className="space-y-2">
          <ScriptCopyHelper youtubeUrl={url || undefined} />
          <label className="block text-sm text-ink-600">
            ② 스크립트(자막) · AI 요약
            <textarea
              value={pastedScript}
              onChange={(e) => setPastedScript(e.target.value)}
              rows={5}
              placeholder="자막 또는 AI 요약을 여기에 붙여넣기 (80자 이상)"
              className="mt-1.5 w-full rounded-xl border border-ink-200 bg-white px-3 py-3 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </label>
          {scriptLen > 0 && (
            <p className="text-xs text-ink-500">
              {scriptLen}자
              {hasScript ? " · 검증 가능" : " · 80자 이상 필요"}
            </p>
          )}
        </div>

        <div ref={feedbackRef} className="space-y-2">
          {(busy || status) && (
            <div
              className="rounded-xl border border-ink-200 bg-ink-50 px-4 py-3 text-sm text-ink-700"
              role="status"
              aria-live="polite"
            >
              {status || "처리 중…"}
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

        {!url.trim() && pastedScript.length > 0 && (
          <div className="rounded-xl border border-accent/40 bg-accent-muted/50 px-4 py-3 text-sm text-ink-800 flex gap-2">
            <AlertTriangle className="h-5 w-5 text-accent shrink-0" />
            <p>
              스크립트만 있고 <strong>유튜브 주소가 비어</strong> 있습니다. ①
              주소 칸에 링크를 다시 붙여넣어 주세요.
            </p>
          </div>
        )}
      </div>

      {/* 아이폰: 항상 보이는 하단 버튼 */}
      <div className="fixed bottom-0 inset-x-0 z-40 sm:static sm:z-auto border-t border-ink-200 sm:border-0 bg-white/95 sm:bg-transparent backdrop-blur px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-0 sm:mt-4">
        <button
          type="submit"
          disabled={busy}
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-accent min-h-12 px-5 py-3.5 text-white font-medium hover:bg-ink-900 disabled:opacity-60 transition-colors shadow-lg sm:shadow-none"
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              접수 중…
            </>
          ) : hasScript ? (
            "스크립트로 요약 · 검증"
          ) : (
            "조회 · 검증 시작"
          )}
        </button>
      </div>
    </form>
  );
}
