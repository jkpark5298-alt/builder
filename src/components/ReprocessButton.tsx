"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function ReprocessButton({ videoId }: { videoId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function onClick() {
    if (
      !confirm(
        "저장된 스크립트로 상세 요약을 다시 만들까요?\n1~3분 걸릴 수 있습니다. (기존 팩트체크·보고서는 초기됩니다)"
      )
    ) {
      return;
    }
    setLoading(true);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 170_000);
      const res = await fetch(`/api/videos/${videoId}/reprocess`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        signal: controller.signal,
      });
      clearTimeout(timer);

      const data = (await res.json()) as {
        error?: string;
        video?: { id: string };
        message?: string;
        weak?: boolean;
      };
      if (!res.ok) throw new Error(data.error || "재요약 실패");

      alert(data.message || "재요약이 완료되었습니다.");
      router.push(`/videos/${data.video?.id || videoId}`);
      router.refresh();
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        alert(
          "재요약 시간이 초과되었습니다. 페이지를 새로고침해 진행 상태를 확인해 주세요."
        );
        router.refresh();
      } else {
        alert(e instanceof Error ? e.message : "재요약 실패");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="inline-flex items-center justify-center gap-2 min-h-11 rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm font-medium hover:border-accent hover:text-accent disabled:opacity-60"
    >
      <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
      {loading ? "상세 요약 중… (1~3분)" : "스크립트 기준 재요약"}
    </button>
  );
}
