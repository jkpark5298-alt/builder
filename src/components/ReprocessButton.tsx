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
        "스크립트(또는 설명·챕터)를 기준으로 요약·자동 팩트체크 초안을 다시 만들까요? (기존 수동 수정·보고서는 삭제됩니다)"
      )
    ) {
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/videos/${videoId}/reprocess`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "재분석 실패");
      router.push(`/videos/${data.video.id}`);
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "재분석 실패");
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
      {loading ? "재분석 중…" : "스크립트 기준 재요약"}
    </button>
  );
}
