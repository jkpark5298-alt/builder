"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { AlertTriangle, Loader2, Link2 } from "lucide-react";
import { extractVideoId } from "@/lib/youtube";
import { ScriptCopyHelper } from "./ScriptCopyHelper";

export function UrlPasteForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [creatorNotes, setCreatorNotes] = useState("");
  const [pastedScript, setPastedScript] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scriptWarn, setScriptWarn] = useState<string | null>(null);

  async function startAnalyze() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          youtubeUrl: url.trim(),
          creatorNotes: creatorNotes.trim() || undefined,
          pastedScript: pastedScript.trim() || undefined,
        }),
      });

      const raw = await res.text();
      let data: { error?: string; video?: { id: string } } = {};
      try {
        data = raw ? (JSON.parse(raw) as typeof data) : {};
      } catch {
        throw new Error(
          res.ok
            ? "서버 응답을 읽지 못했습니다."
            : `서버 오류 (${res.status}). 개발 서버가 실행 중인지 확인해 주세요.`
        );
      }

      if (!res.ok) {
        throw new Error(data.error || `처리 실패 (${res.status})`);
      }
      if (!data.video?.id) {
        throw new Error("영상 ID를 받지 못했습니다. 다시 시도해 주세요.");
      }

      router.push(`/videos/${data.video.id}`);
      router.refresh();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "처리 실패";
      if (
        message.includes("Failed to fetch") ||
        message.includes("NetworkError") ||
        message.includes("fetch")
      ) {
        setError(
          "서버에 연결할 수 없습니다. npm run dev 로 개발 서버를 실행한 뒤 다시 시도해 주세요."
        );
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setScriptWarn(null);

    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      setError("유튜브 주소를 입력해 주세요.");
      return;
    }
    if (!extractVideoId(trimmedUrl)) {
      setError(
        "유효한 유튜브 URL이 아닙니다. youtube.com/watch?v=… 또는 youtu.be/… 형식인지 확인해 주세요."
      );
      return;
    }

    if (pastedScript.trim().length > 80) {
      await startAnalyze();
      return;
    }

    if (!pastedScript.trim()) {
      setScriptWarn(
        "스크립트 없이 시작하면 요약 품질이 떨어질 수 있습니다. 가능하면 아래 도우미로 자막을 복사해 붙여넣은 뒤 다시 시작해 주세요."
      );
    }
    await startAnalyze();
  }

  const busy = loading;

  return (
    <form
      id="paste"
      onSubmit={onSubmit}
      className="relative overflow-hidden rounded-2xl border border-ink-200 bg-white/80 p-6 shadow-sm"
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
          <p className="text-ink-600 max-w-2xl text-[15px] sm:text-base leading-relaxed">
            유튜브 주소 + <strong>스크립트(자막) 붙여넣기</strong>로
            요약·팩트체크합니다. (배포 서버에서는 유튜브 자막을 자동으로 못
            가져오므로, 아래 도우미로 복사해 붙여넣으세요.)
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
            inputMode="url"
            enterKeyHint="go"
            autoCapitalize="off"
            autoCorrect="off"
            className="flex-1 rounded-xl border border-ink-200 bg-white px-4 py-3.5 text-base text-ink-900 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-ink-900 min-h-12 px-5 py-3.5 text-white font-medium hover:bg-accent disabled:opacity-60 transition-colors"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                분석 중…
              </>
            ) : (
              "요약 · 검증 시작"
            )}
          </button>
        </div>

        {busy && (
          <div
            className="rounded-xl border border-ink-200 bg-ink-50 px-4 py-3 text-sm text-ink-700"
            role="status"
            aria-live="polite"
          >
            요약·검증을 준비하고 있습니다. 유튜브 정보 조회에 보통 수 초~1분
            정도 걸릴 수 있습니다. 잠시만 기다려 주세요.
          </div>
        )}

        {scriptWarn && (
          <div
            className="rounded-xl border border-accent/40 bg-accent-muted/60 p-4 space-y-2"
            role="status"
          >
            <div className="flex gap-2 items-start">
              <AlertTriangle className="h-5 w-5 text-accent shrink-0 mt-0.5" />
              <p className="text-sm text-ink-800 leading-relaxed">{scriptWarn}</p>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-sm font-medium text-ink-800">
            권장 순서: 주소 입력 → 스크립트 복사·붙여넣기 → 시작
          </p>
          <ScriptCopyHelper youtubeUrl={url || undefined} />
          <label className="block text-sm text-ink-600">
            스크립트(자막) 붙여넣기
            <textarea
              value={pastedScript}
              onChange={(e) => setPastedScript(e.target.value)}
              rows={5}
              placeholder="도우미로 복사한 스크립트를 여기에 Ctrl+V …"
              className="mt-1.5 w-full rounded-xl border border-ink-200 bg-white px-3 py-3 text-sm sm:text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </label>
        </div>

        <label className="block text-sm text-ink-600">
          제작자 설명·챕터 (선택)
          <textarea
            value={creatorNotes}
            onChange={(e) => setCreatorNotes(e.target.value)}
            rows={4}
            placeholder={`예)\n오늘은 … 알아보았습니다!\n\n00:00 인트로\n03:47 …`}
            className="mt-1.5 w-full rounded-xl border border-ink-200 bg-white px-3 py-3 text-sm sm:text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </label>
        {error && (
          <p className="text-sm text-verify-false" role="alert">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}
