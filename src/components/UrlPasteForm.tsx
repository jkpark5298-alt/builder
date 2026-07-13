"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { AlertTriangle, Loader2, Link2 } from "lucide-react";
import { ScriptCopyHelper } from "./ScriptCopyHelper";

export function UrlPasteForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [creatorNotes, setCreatorNotes] = useState("");
  const [pastedScript, setPastedScript] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scriptWarn, setScriptWarn] = useState<string | null>(null);

  async function startAnalyze(_forceWithoutScript: boolean) {
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

    // 스크립트 없이 시작하면 안내만 하고 진행 (복사·붙여넣기가 권장 경로)
    if (!pastedScript.trim()) {
      setScriptWarn(
        "스크립트 없이 시작하면 요약 품질이 떨어질 수 있습니다. 가능하면 아래 도우미로 자막을 복사해 붙여넣은 뒤 다시 시작해 주세요."
      );
    }
    await startAnalyze(false);
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
                분석 중…
              </>
            ) : (
              "요약 · 검증 시작"
            )}
          </button>
        </div>

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
