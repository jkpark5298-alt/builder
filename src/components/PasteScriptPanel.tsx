"use client";

import { Loader2, ClipboardPaste } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { ScriptCopyHelper } from "./ScriptCopyHelper";

/** 배포 서버에서 자막을 못 가져왔을 때: 붙여넣고 재요약 */
export function PasteScriptPanel({
  videoId,
  youtubeUrl,
}: {
  videoId: string;
  youtubeUrl: string;
}) {
  const router = useRouter();
  const [script, setScript] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (script.trim().length < 80) {
      setError("자막 텍스트를 조금 더 붙여넣어 주세요. (너무 짧으면 요약이 어렵습니다)");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/videos/${videoId}/reprocess`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pastedScript: script.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "재요약 실패");
      router.push(`/videos/${data.video.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "재요약 실패");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-xl border border-accent/40 bg-accent-muted/40 p-4 space-y-3"
    >
      <div className="flex items-start gap-2">
        <ClipboardPaste className="h-5 w-5 text-accent shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-ink-900">
            스크립트를 붙여넣어 재요약하세요
          </p>
          <p className="text-xs text-ink-600 mt-1 leading-relaxed">
            Vercel에서는 유튜브 자막을 자동으로 가져오지 않습니다. 아래 도우미로
            복사한 뒤 붙여넣으면 요약·팩트체크가 정상 진행됩니다.
          </p>
        </div>
      </div>

      <ScriptCopyHelper youtubeUrl={youtubeUrl} />

      <textarea
        value={script}
        onChange={(e) => setScript(e.target.value)}
        rows={6}
        placeholder="여기에 스크립트 붙여넣기 (Ctrl+V)…"
        className="w-full rounded-xl border border-ink-200 bg-white px-3 py-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
      />
      {error && (
        <p className="text-sm text-verify-false" role="alert">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={loading}
        className="inline-flex items-center justify-center gap-2 min-h-11 rounded-xl bg-ink-900 px-4 text-sm font-medium text-white hover:bg-accent disabled:opacity-60"
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            스크립트로 재요약 중…
          </>
        ) : (
          "붙여넣은 스크립트로 재요약"
        )}
      </button>
    </form>
  );
}
