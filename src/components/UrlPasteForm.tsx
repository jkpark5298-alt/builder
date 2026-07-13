"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { AlertTriangle, Loader2, Link2 } from "lucide-react";

export function UrlPasteForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [creatorNotes, setCreatorNotes] = useState("");
  const [pastedScript, setPastedScript] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scriptWarn, setScriptWarn] = useState<string | null>(null);

  async function startAnalyze(forceWithoutScript: boolean) {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          youtubeUrl: url,
          creatorNotes: creatorNotes.trim() || undefined,
          pastedScript: pastedScript.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "처리 실패");
      router.push(`/videos/${data.video.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "처리 실패");
    } finally {
      setLoading(false);
      setChecking(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setScriptWarn(null);

    // 붙여넣은 스크립트가 있으면 바로 진행
    if (pastedScript.trim().length > 80) {
      await startAnalyze(false);
      return;
    }

    setChecking(true);
    try {
      const probeRes = await fetch("/api/videos/check-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ youtubeUrl: url }),
      });
      const probe = await probeRes.json();
      if (!probeRes.ok) throw new Error(probe.error || "자막 확인 실패");

      if (!probe.available) {
        setScriptWarn(probe.message);
        setChecking(false);
        return;
      }

      await startAnalyze(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "확인 실패");
      setChecking(false);
    }
  }

  const busy = loading || checking;

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
            스크립트(자막)가 있으면 그걸로 요약합니다. 없으면 자동생성 자막을
            텍스트로 변환해 보고, 그래도 없으면 <strong>요약 시작 전에 알려드립니다</strong>.
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
            required
          />
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-ink-900 min-h-12 px-5 py-3.5 text-white font-medium hover:bg-accent disabled:opacity-60 transition-colors"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {checking ? "자막 확인 중…" : "분석 중…"}
              </>
            ) : (
              "요약 · 검증 시작"
            )}
          </button>
        </div>

        {scriptWarn && (
          <div
            className="rounded-xl border border-accent/40 bg-accent-muted/60 p-4 space-y-3"
            role="alert"
          >
            <div className="flex gap-2 items-start">
              <AlertTriangle className="h-5 w-5 text-accent shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm text-ink-800 leading-relaxed">{scriptWarn}</p>
                <p className="text-xs text-ink-600">
                  유튜브에 자막이 보이는데도 이 안내가 뜨면, 아래 「계속」을 눌러
                  주세요. 분석 단계에서 자막을 다시 가져옵니다.
                </p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => startAnalyze(true)}
                className="min-h-11 rounded-xl bg-ink-900 text-white text-sm px-4 font-medium hover:bg-accent disabled:opacity-60"
              >
                그래도 분석 계속 (자막 재시도)
              </button>
              <button
                type="button"
                onClick={() => setScriptWarn(null)}
                className="min-h-11 rounded-xl border border-ink-200 bg-white text-sm px-4"
              >
                스크립트 붙여넣고 다시
              </button>
            </div>
          </div>
        )}

        <label className="block text-sm text-ink-600">
          스크립트(자막) 텍스트 붙여넣기 — 자막이 없을 때 권장
          <textarea
            value={pastedScript}
            onChange={(e) => setPastedScript(e.target.value)}
            rows={4}
            placeholder="유튜브 자막/대본을 여기에 붙여넣으면 이 텍스트로 요약합니다."
            className="mt-1.5 w-full rounded-xl border border-ink-200 bg-white px-3 py-3 text-sm sm:text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </label>

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
