"use client";

import { CheckCircle2, FileText, Loader2, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { VideoRecord } from "@/lib/types";

/** 유튜브 요약 이후 — 팩트체크 실시 vs pass */
export function FactCheckDecisionPanel({ video }: { video: VideoRecord }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"do" | "pass" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(decision: "do" | "pass") {
    setError(null);
    setBusy(decision);
    try {
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        decision === "pass" ? 150_000 : 20_000
      );
      const res = await fetch(`/api/videos/${video.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          expectedUpdatedAt: video.updatedAt,
          factCheckDecision: decision,
        }),
      });
      clearTimeout(timer);
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "선택 저장 실패");
      router.refresh();
      window.setTimeout(() => {
        const id = decision === "pass" ? "report" : "manual-factcheck";
        document
          .getElementById(id)
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 250);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setError(
          "시간이 오래 걸렸습니다. 화면을 새로고침한 뒤 진행 상태를 확인해 주세요."
        );
        router.refresh();
      } else {
        setError(e instanceof Error ? e.message : "선택 저장 실패");
      }
    } finally {
      setBusy(null);
    }
  }

  const waiting = busy !== null;

  return (
    <section
      id="fc-decision"
      className="rounded-2xl border border-accent/30 bg-white shadow-sm overflow-hidden print:hidden"
    >
      <div className="bg-accent px-4 sm:px-5 py-3.5">
        <h2 className="font-display text-xl sm:text-2xl text-white text-center sm:text-left">
          2. 팩트체크 실시 또는 pass
        </h2>
      </div>
      <div className="p-4 sm:p-5 space-y-4">
        <p className="text-sm text-ink-700 leading-relaxed">
          유튜브 요약이 끝났습니다. 이제{" "}
          <strong>팩트체크를 진행</strong>하거나,{" "}
          <strong>pass</strong>하여 요약만으로 보고서 초안을 만들 수 있습니다.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            disabled={waiting}
            onClick={() => void choose("do")}
            className="rounded-2xl border border-ink-200 bg-white p-5 text-left hover:border-accent hover:shadow-md transition-all disabled:opacity-60"
          >
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-ink-900 text-white">
              {busy === "do" ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <ShieldCheck className="h-5 w-5" />
              )}
            </span>
            <span className="mt-3 block font-display text-lg text-ink-900">
              팩트체크 실시
            </span>
            <span className="mt-1.5 block text-sm text-ink-500 leading-relaxed">
              주장별 검증을 입력한 뒤 보고서를 만듭니다. 기존과 같은 팩트체크
              화면으로 이동합니다.
            </span>
          </button>
          <button
            type="button"
            disabled={waiting}
            onClick={() => void choose("pass")}
            className="rounded-2xl border border-accent/40 bg-accent-muted/40 p-5 text-left hover:border-accent hover:shadow-md transition-all disabled:opacity-60"
          >
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-white">
              {busy === "pass" ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <FileText className="h-5 w-5" />
              )}
            </span>
            <span className="mt-3 block font-display text-lg text-ink-900">
              팩트체크 pass
            </span>
            <span className="mt-1.5 block text-sm text-ink-500 leading-relaxed">
              검증 없이 요약을 바탕으로 AI가 상세 보고서 초안을 작성합니다.
              1~2분 걸릴 수 있습니다.
            </span>
          </button>
        </div>
        {busy === "pass" && (
          <p className="text-sm text-ink-600 rounded-xl border border-ink-200 bg-ink-50 px-4 py-3">
            AI가 유튜브 요약을 조합해 상세 보고서를 작성하는 중입니다. 화면을
            끄지 마세요.
          </p>
        )}
        {error && (
          <p className="text-sm text-verify-false font-medium" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

/** pass 초안을 확정 보고서로 저장 */
export function PassReportConfirmBar({ video }: { video: VideoRecord }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/videos/${video.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedUpdatedAt: video.updatedAt,
          completeManual: true,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "확정 실패");
      router.refresh();
      window.setTimeout(() => {
        document
          .getElementById("report")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 250);
    } catch (e) {
      setError(e instanceof Error ? e.message : "확정 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-accent/30 bg-accent-muted/40 px-4 py-3 space-y-2 print:hidden">
      <p className="text-sm text-ink-800 leading-relaxed">
        <strong>보고서 초안</strong> — 유튜브 요약을 참고해 AI가 작성했습니다.
        본문을 다듬은 뒤 확정하세요. 팩트체크 탭은 보이지 않습니다.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => void confirm()}
        className="inline-flex items-center gap-1.5 min-h-11 rounded-xl bg-ink-900 px-4 text-sm font-medium text-white hover:bg-accent disabled:opacity-60"
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <CheckCircle2 className="h-4 w-4" />
        )}
        {busy ? "확정 중…" : "보고서 확정"}
      </button>
      {error && (
        <p className="text-sm text-verify-false" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
