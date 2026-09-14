"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Circle,
  Copy,
  Loader2,
  Link2,
} from "lucide-react";
import { FLOW, flowLabel } from "@/lib/flow-steps";
import { hasUsablePastedScript, normalizePastedText } from "@/lib/paste";
import {
  EXTERNAL_APP_LABEL,
  launchExternalApp,
  type ExternalAppId,
} from "@/lib/external-apps";
import { extractVideoId } from "@/lib/youtube";
import { ScriptCopyHelper } from "./ScriptCopyHelper";
import { cacheVideoSnapshot } from "./VideoNotFoundRecovery";

const STORAGE_KEY = "yfc-form-v1";
const POST_TIMEOUT_MS = 20_000;
const POST_SCRIPT_TIMEOUT_MS = 150_000;

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
  const scriptBoxRef = useRef<HTMLTextAreaElement>(null);
  const [url, setUrl] = useState("");
  const [creatorNotes, setCreatorNotes] = useState("");
  const [pastedScript, setPastedScript] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [scriptNotice, setScriptNotice] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const [scriptCopied, setScriptCopied] = useState(false);

  async function copyScript() {
    const text = normalizePastedText(pastedScript);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setScriptCopied(true);
      setScriptNotice({
        ok: true,
        text: `${flowLabel("copyScript")} 완료 · ${text.length.toLocaleString()}자. 제미나이·다글로에 붙여 요약한 뒤 「${flowLabel("openSummary")}」를 누르세요.`,
      });
      setTimeout(() => setScriptCopied(false), 2500);
    } catch {
      setError("복사에 실패했습니다. 스크립트 칸에서 직접 선택·복사해 주세요.");
    }
  }

  /** 같은 탭에서 자막 복사 + 외부 앱 실행 */
  function copyScriptAndOpenApp(app: ExternalAppId) {
    const text = normalizePastedText(pastedScript);
    if (!text) {
      setError("먼저 자막을 가져온 뒤 복사하세요.");
      return;
    }
    setError(null);
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setScriptCopied(true);
        setScriptNotice({
          ok: true,
          text: `${flowLabel("copyScript")} 완료 · ${EXTERNAL_APP_LABEL[app]}에서 붙여 요약하세요. 끝나면 「${flowLabel("openSummary")}」.`,
        });
        setTimeout(() => setScriptCopied(false), 2500);
      })
      .catch(() => {
        setError("복사에 실패했습니다. 자막 복사 후 앱에서 붙여넣기 하세요.");
      });
    launchExternalApp(app);
  }

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

  const videoId = extractVideoId(url.trim());
  const scriptLen = normalizePastedText(pastedScript).length;
  const hasScript = hasUsablePastedScript(pastedScript);
  const step1Done = Boolean(videoId);
  const step2Done = hasScript;
  const nextStep: 1 | 2 | 3 = !step1Done ? 1 : !step2Done ? 2 : 3;

  function goToVideo(id: string) {
    window.location.assign(`/videos/${id}`);
  }

  function onScriptFetched(script: string) {
    setPastedScript(script);
    const len = normalizePastedText(script).length;
    setScriptNotice({
      ok: true,
      text: `${flowLabel("fetchScript")} 완료 · ${len.toLocaleString()}자를 스크립트 칸에 넣었습니다. 다음: 「${flowLabel("copyScript")}」.`,
    });
    setError(null);
    requestAnimationFrame(() => {
      scriptBoxRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
  }

  function onScriptFetchError(message: string) {
    setScriptNotice({
      ok: false,
      text: `자막 가져오기 실패 · ${message}`,
    });
  }

  async function startManualOverview() {
    setError(null);
    if (!url.trim() || !extractVideoId(url.trim())) {
      setError("① 유튜브 주소를 먼저 넣어 주세요.");
      return;
    }
    if (!hasUsablePastedScript(pastedScript)) {
      setError("② 스크립트(자막)를 먼저 넣은 뒤 수동 요약을 시작하세요.");
      return;
    }
    setLoading(true);
    setStatus("요약 화면으로 여는 중…");
    try {
      const res = await fetch("/api/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          youtubeUrl: url.trim(),
          pastedScript: normalizePastedText(pastedScript),
          manualOverview: true,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        video?: { id: string };
      };
      if (!res.ok) throw new Error(data.error || "시작 실패");
      if (!data.video?.id) throw new Error("영상 ID를 받지 못했습니다.");
      cacheVideoSnapshot(data.video);
      goToVideo(data.video.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : "시작 실패";
      if (/정지|suspended/i.test(message)) {
        setError(message);
      } else if (/Blob|BLOB_|자격 증명/i.test(message)) {
        setError(
          `${message}\n\n※ 저장소(Blob) 설정 문제입니다. Vercel Environment Variables를 확인한 뒤 Redeploy 하세요.`
        );
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
      setStatus(null);
    }
  }

  async function startAnalyze(withScript: boolean) {
    setError(null);
    setLoading(true);
    setStatus(
      withScript
        ? "상세 요약·검증 중… (1~3분 걸릴 수 있어요. 화면을 끄지 마세요)"
        : "요청 접수 중… 자막 자동 수집을 시도합니다."
    );
    feedbackRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });

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
        const errText = data.error || `처리 실패 (${res.status})`;
        if (/정지|suspended/i.test(errText)) {
          throw new Error(errText);
        }
        if (/Blob|BLOB_|자격 증명|저장소/i.test(errText)) {
          throw new Error(
            `${errText}\n\n※ 이 오류는 ‘AI 요약 API’ 문제가 아니라 저장소(Blob) 문제입니다. 잠시 후 다시 시도해 주세요.`
          );
        }
        throw new Error(errText);
      }
      if (!data.video?.id) {
        throw new Error("영상 ID를 받지 못했습니다. 다시 시도해 주세요.");
      }

      cacheVideoSnapshot(data.video);
      setStatus("완료. 요약 화면으로 이동합니다…");
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
      feedbackRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
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
      feedbackRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      return;
    }
    if (!extractVideoId(trimmedUrl)) {
      setError(
        "유효한 유튜브 URL이 아닙니다. 공유 → 링크 복사로 다시 붙여넣어 주세요."
      );
      feedbackRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      return;
    }

    if (!hasScript && scriptLen > 0 && scriptLen <= 80) {
      setError(
        `스크립트가 ${scriptLen}자입니다. 80자 이상 붙여넣은 뒤 다시 눌러 주세요.`
      );
      feedbackRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      return;
    }

    if (!hasScript) {
      setError(
        "아직 자막이 없습니다. ②「자막 자동 가져오기」를 먼저 눌러 주세요."
      );
      feedbackRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      return;
    }

    await startManualOverview();
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

          {/* 사용자가 할 일 — 순서 안내 */}
          <div className="mt-3 rounded-xl border border-ink-200 bg-white/95 p-4 space-y-3">
            <p className="text-sm font-semibold text-ink-900">
              이렇게 진행하세요 (순서대로)
            </p>
            <ol className="space-y-2.5 text-sm">
              <li
                className={`flex gap-2.5 rounded-lg px-2.5 py-2 ${
                  nextStep === 1
                    ? "bg-accent-muted/50 ring-1 ring-accent/30"
                    : "bg-ink-50/80"
                }`}
              >
                {step1Done ? (
                  <CheckCircle2 className="h-5 w-5 text-accent shrink-0 mt-0.5" />
                ) : (
                  <Circle className="h-5 w-5 text-ink-400 shrink-0 mt-0.5" />
                )}
                <div>
                  <p className="font-medium text-ink-900">
                    {flowLabel("url", "유튜브 주소 붙여넣기")}
                  </p>
                  <p className="text-xs text-ink-600 mt-0.5">
                    유튜브 공유 → 링크 복사 → 아래 주소 칸에 붙여넣기
                    {step1Done ? " · 완료" : ""}
                  </p>
                </div>
              </li>
              <li
                className={`flex gap-2.5 rounded-lg px-2.5 py-2 ${
                  nextStep === 2
                    ? "bg-accent-muted/50 ring-1 ring-accent/30"
                    : "bg-ink-50/80"
                }`}
              >
                {step2Done ? (
                  <CheckCircle2 className="h-5 w-5 text-accent shrink-0 mt-0.5" />
                ) : (
                  <Circle className="h-5 w-5 text-ink-400 shrink-0 mt-0.5" />
                )}
                <div>
                  <p className="font-medium text-ink-900">
                    {flowLabel("fetchScript", "자막 자동 가져오기")}
                  </p>
                  <p className="text-xs text-ink-600 mt-0.5">
                    「자막 자동 가져오기」→ 스크립트(자막) 칸에 채워짐
                    {step2Done
                      ? ` · 완료 (${scriptLen.toLocaleString()}자)`
                      : ""}
                  </p>
                </div>
              </li>
              <li
                className={`flex gap-2.5 rounded-lg px-2.5 py-2 ${
                  nextStep === 3 && !scriptCopied
                    ? "bg-accent-muted/50 ring-1 ring-accent/30"
                    : "bg-ink-50/80"
                }`}
              >
                {scriptCopied ? (
                  <CheckCircle2 className="h-5 w-5 text-accent shrink-0 mt-0.5" />
                ) : (
                  <Circle className="h-5 w-5 text-ink-400 shrink-0 mt-0.5" />
                )}
                <div>
                  <p className="font-medium text-ink-900">
                    {flowLabel("copyScript", "자막 복사 → 제미나이·다글로 요약")}
                  </p>
                  <p className="text-xs text-ink-600 mt-0.5">
                    「{flowLabel("copyScript")}」또는 제미나이·다글로 → 요약 받기
                  </p>
                </div>
              </li>
              <li
                className={`flex gap-2.5 rounded-lg px-2.5 py-2 ${
                  nextStep === 3 && scriptCopied
                    ? "bg-accent-muted/50 ring-1 ring-accent/30"
                    : "bg-ink-50/80"
                }`}
              >
                {scriptCopied ? (
                  <CheckCircle2 className="h-5 w-5 text-accent shrink-0 mt-0.5" />
                ) : (
                  <Circle className="h-5 w-5 text-ink-400 shrink-0 mt-0.5" />
                )}
                <div>
                  <p className="font-medium text-ink-900">
                    {flowLabel("openSummary")}
                  </p>
                  <p className="text-xs text-ink-600 mt-0.5">
                    다음 화면에서 {FLOW.pasteSummary.n}–{FLOW.saveSummary.n}번
                    (요약 붙여넣기·정리·저장)
                  </p>
                </div>
              </li>
            </ol>
            <p className="text-xs font-medium text-accent" role="status">
              {nextStep === 1 &&
                `👉 지금: ${flowLabel("url")}를 붙여넣으세요.`}
              {nextStep === 2 &&
                `👉 지금: 「${flowLabel("fetchScript")}」를 눌러 주세요.`}
              {nextStep === 3 &&
                !scriptCopied &&
                `👉 지금: 「${flowLabel("copyScript")}」또는 제미나이·다글로.`}
              {nextStep === 3 &&
                scriptCopied &&
                `👉 지금: 요약 후 「${flowLabel("openSummary")}」.`}
            </p>
          </div>
        </div>

        <label className="block text-sm text-ink-600">
          1. 유튜브 주소
          <input
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setScriptNotice(null);
            }}
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
          <ScriptCopyHelper
            youtubeUrl={url || undefined}
            onScriptFetched={onScriptFetched}
            onFetchError={onScriptFetchError}
            autoFetchOnUrl
          />

          {/* 자막 복사 완료/실패 알림 */}
          {scriptNotice && (
            <div
              className={`rounded-xl border px-4 py-3 text-sm font-medium flex gap-2 ${
                scriptNotice.ok
                  ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                  : "border-verify-false/30 bg-verify-false/5 text-verify-false"
              }`}
              role="status"
              aria-live="polite"
            >
              {scriptNotice.ok ? (
                <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
              )}
              <p>{scriptNotice.text}</p>
            </div>
          )}

          <label className="block text-sm text-ink-600">
            2. 스크립트(자막)
            <textarea
              ref={scriptBoxRef}
              value={pastedScript}
              onChange={(e) => {
                setPastedScript(e.target.value);
                if (!e.target.value.trim()) setScriptNotice(null);
              }}
              rows={5}
              placeholder="「2. 자막 자동 가져오기」후 여기에 채워집니다"
              className={`mt-1.5 w-full rounded-xl border bg-white px-3 py-3 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 ${
                hasScript
                  ? "border-emerald-300 ring-1 ring-emerald-200"
                  : "border-ink-200"
              }`}
            />
          </label>
          {scriptLen > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p
                className={`text-xs font-medium ${
                  hasScript ? "text-emerald-700" : "text-ink-500"
                }`}
              >
                {hasScript
                  ? `✓ 자막 준비됨 · ${scriptLen.toLocaleString()}자`
                  : `${scriptLen}자 · 80자 이상 필요`}
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void copyScript()}
                  className="inline-flex items-center gap-1.5 min-h-9 rounded-lg border border-accent/40 bg-accent-muted/40 px-3 text-xs font-medium text-ink-900 hover:border-accent"
                >
                  {scriptCopied ? (
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {scriptCopied
                    ? `${FLOW.copyScript.n}. 복사됨`
                    : flowLabel("copyScript", "자막 복사 (외부 AI용)")}
                </button>
                <button
                  type="button"
                  disabled={!hasScript}
                  onClick={() => copyScriptAndOpenApp("gemini")}
                  className="inline-flex items-center min-h-9 rounded-lg border border-ink-200 bg-white px-3 text-xs font-medium hover:border-accent disabled:opacity-50"
                >
                  제미나이
                </button>
                <button
                  type="button"
                  disabled={!hasScript}
                  onClick={() => copyScriptAndOpenApp("daglo")}
                  className="inline-flex items-center min-h-9 rounded-lg border border-ink-200 bg-white px-3 text-xs font-medium hover:border-accent disabled:opacity-50"
                >
                  다글로
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                <button
                  type="button"
                  disabled={!hasScript || loading}
                  onClick={async () => {
                    setError(null);
                    setLoading(true);
                    setStatus("✨ 외부 제미나이 API로 요약/분석 중...");
                    try {
                      // 1. 외부 API 호출 (iphone-calendar-2026.vercel.app)
                      const res = await fetch("https://iphone-calendar-2026.vercel.app/api/gemini", {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                          // 필요한 경우 Authorization 헤더에 토큰 추가
                          // "Authorization": `Bearer ${process.env.NEXT_PUBLIC_APP_API_TOKEN}` 
                        },
                        body: JSON.stringify({
                          action: "fact-check", // API에 맞게 설정 (또는 summarize 추가 필요)
                          text: pastedScript
                        })
                      });
                      
                      const data = await res.json();
                      if (!res.ok) throw new Error(data.error || "요약 API 호출 실패");
                      
                      const resultText = data.result;
                      
                      // 2. 결과를 클립보드에 복사
                      await navigator.clipboard.writeText(resultText);
                      setScriptNotice({
                        ok: true,
                        text: "✨ 요약 완료 및 복사됨! 다음 화면에서 붙여넣기(Ctrl+V) 하세요."
                      });
                      
                      // 3. 기존 'startManualOverview' 파이프라인 태우기 (요약 화면으로 이동)
                      setStatus("요약 화면으로 이동 중...");
                      const createRes = await fetch("/api/videos", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          youtubeUrl: url.trim(),
                          pastedScript: normalizePastedText(pastedScript),
                          manualOverview: true,
                        }),
                      });
                      const createData = await createRes.json();
                      if (!createRes.ok) throw new Error(createData.error || "이동 실패");
                      
                      window.location.assign(`/videos/${createData.video.id}`);
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "요약 중 오류가 발생했습니다.");
                    } finally {
                      setLoading(false);
                      setStatus(null);
                    }
                  }}
                  className="inline-flex items-center min-h-9 rounded-lg border border-accent bg-accent/10 px-3 text-xs font-medium text-accent hover:bg-accent/20 disabled:opacity-50"
                >
                  ✨ 제미나이 API 자동 요약
                </button>
              </div>
            </div>
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

      <div className="fixed bottom-0 inset-x-0 z-40 sm:static sm:z-auto border-t border-ink-200 sm:border-0 bg-white/95 sm:bg-transparent backdrop-blur px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-0 sm:mt-4 space-y-2">
        <button
          type="submit"
          disabled={busy}
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-accent min-h-12 px-5 py-3.5 text-white font-medium hover:bg-ink-900 disabled:opacity-60 transition-colors shadow-lg sm:shadow-none"
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              여는 중…
            </>
          ) : hasScript ? (
            flowLabel("openSummary", "요약 화면으로 (AI 요약 붙여넣기)")
          ) : step1Done ? (
            `먼저 ${flowLabel("fetchScript")}`
          ) : (
            `먼저 ${flowLabel("url")}`
          )}
        </button>
        {hasScript && step1Done && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void startAnalyze(true)}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-ink-300 bg-white min-h-11 px-5 text-sm font-medium text-ink-800 hover:border-accent disabled:opacity-60"
          >
            고급 · 앱에서 AI 요약 실행
          </button>
        )}
      </div>
    </form>
  );
}
