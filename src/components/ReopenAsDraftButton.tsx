"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PencilLine } from "lucide-react";

/** 완료(ready) → 임시 저장(awaiting_factcheck)으로 되돌림 */
export function ReopenAsDraftButton({ videoId }: { videoId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reopen() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/videos/${videoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reopenAsDraft: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "이동 실패");
      router.refresh();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "이동 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={busy}
        onClick={reopen}
        className="inline-flex w-full sm:w-auto items-center justify-center gap-2 min-h-11 rounded-xl border border-accent/40 bg-accent-muted/50 px-4 py-2.5 text-sm font-medium text-ink-900 hover:bg-accent-muted disabled:opacity-60"
      >
        <PencilLine className="h-4 w-4" />
        {busy ? "이동 중…" : "수정 (팩트체크 다시 열기)"}
      </button>
      {error && (
        <p className="text-sm text-verify-false" role="alert">
          {error}
        </p>
      )}
      <p className="text-xs text-ink-500">
        임시 저장으로 옮긴 뒤 팩트체크·이미지를 수정할 수 있습니다. 다시
        완료하려면 검증을 마친 뒤 «보고서 저장 → PDF·인포그래픽»을 누르세요.
      </p>
    </div>
  );
}
