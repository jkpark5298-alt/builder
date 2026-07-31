"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PencilLine, X } from "lucide-react";

/** 완료(ready) → 임시 저장(awaiting_factcheck)으로 되돌림 */
export function ReopenAsDraftButton({ videoId }: { videoId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"keep_body" | "rewrite">("keep_body");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reopen() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/videos/${videoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reopenAsDraft: true,
          keepReportBody: mode === "keep_body",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "이동 실패");
      setOpen(false);
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
        onClick={() => {
          setError(null);
          setMode("keep_body");
          setOpen(true);
        }}
        className="inline-flex w-full sm:w-auto items-center justify-center gap-2 min-h-11 rounded-xl border border-accent/40 bg-accent-muted/50 px-4 py-2.5 text-sm font-medium text-ink-900 hover:bg-accent-muted disabled:opacity-60"
      >
        <PencilLine className="h-4 w-4" />
        팩트체크 다시하기
      </button>
      <p className="text-xs text-ink-500">
        이미 팩트체크는 완료된 상태입니다. 답변·판정만 다시 손볼 때 쓰세요.
        문장만 고치려면 <strong>본문 수정</strong>이면 됩니다.
      </p>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink-900/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reopen-fc-title"
          onClick={() => !busy && setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-ink-200 bg-white shadow-lg p-4 sm:p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3
                  id="reopen-fc-title"
                  className="font-display text-lg text-ink-900"
                >
                  팩트체크 다시하기
                </h3>
                <p className="mt-1 text-sm text-ink-600">
                  완료 후 보고서 본문을 어떻게 할지 선택하세요.
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => setOpen(false)}
                className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100"
                aria-label="닫기"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <fieldset className="space-y-2">
              <legend className="sr-only">본문 처리 방식</legend>
              <label
                className={`flex gap-3 rounded-xl border p-3 cursor-pointer ${
                  mode === "keep_body"
                    ? "border-accent bg-accent-muted/40"
                    : "border-ink-200 hover:border-ink-300"
                }`}
              >
                <input
                  type="radio"
                  name="finalize-mode"
                  className="mt-1"
                  checked={mode === "keep_body"}
                  onChange={() => setMode("keep_body")}
                />
                <span>
                  <span className="block text-sm font-medium text-ink-900">
                    본문 유지 (권장)
                  </span>
                  <span className="block text-xs text-ink-600 mt-0.5">
                    기존 보고서 문장·서식은 그대로 두고, 팩트체크만 반영합니다.
                  </span>
                </span>
              </label>
              <label
                className={`flex gap-3 rounded-xl border p-3 cursor-pointer ${
                  mode === "rewrite"
                    ? "border-accent bg-accent-muted/40"
                    : "border-ink-200 hover:border-ink-300"
                }`}
              >
                <input
                  type="radio"
                  name="finalize-mode"
                  className="mt-1"
                  checked={mode === "rewrite"}
                  onChange={() => setMode("rewrite")}
                />
                <span>
                  <span className="block text-sm font-medium text-ink-900">
                    본문 새로 작성
                  </span>
                  <span className="block text-xs text-ink-600 mt-0.5">
                    완료 시 글쓰기 AI·조립으로 보고서를 다시 만듭니다.{" "}
                    <strong className="text-verify-false">
                      기존 본문 수정 내용은 사라집니다.
                    </strong>
                  </span>
                </span>
              </label>
            </fieldset>

            {error && (
              <p className="text-sm text-verify-false" role="alert">
                {error}
              </p>
            )}

            <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
              <button
                type="button"
                disabled={busy}
                onClick={() => setOpen(false)}
                className="min-h-11 rounded-xl border border-ink-200 px-4 text-sm font-medium hover:bg-ink-50 disabled:opacity-60"
              >
                취소
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void reopen()}
                className="min-h-11 rounded-xl bg-accent px-4 text-sm font-medium text-white hover:opacity-95 disabled:opacity-60"
              >
                {busy ? "이동 중…" : "팩트체크 단계로 이동"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
