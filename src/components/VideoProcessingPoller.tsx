"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import type { PipelineStatus } from "@/lib/types";

const PROCESSING: PipelineStatus[] = [
  "queued",
  "fetching",
  "summarizing",
  "fact_checking",
];

const STATUS_LABEL: Partial<Record<PipelineStatus, string>> = {
  queued: "대기열",
  fetching: "유튜브 정보 조회",
  summarizing: "요약 생성",
  fact_checking: "팩트체크 준비",
};

export function VideoProcessingPoller({
  videoId,
  status,
  errorMessage,
}: {
  videoId: string;
  status: PipelineStatus;
  errorMessage?: string;
}) {
  const router = useRouter();
  const lastStatus = useRef(status);

  useEffect(() => {
    lastStatus.current = status;
  }, [status]);

  useEffect(() => {
    if (!PROCESSING.includes(status)) return;

    const poll = async () => {
      try {
        const res = await fetch(`/api/videos/${videoId}?poll=1`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          video?: { status?: PipelineStatus };
        };
        const next = data.video?.status;
        if (next && next !== lastStatus.current) {
          router.refresh();
        }
      } catch {
        /* ignore transient network errors */
      }
    };

    poll();
    const id = window.setInterval(poll, 2500);
    return () => window.clearInterval(id);
  }, [videoId, status, router]);

  if (status === "error") {
    return (
      <div
        className="rounded-xl border border-verify-false/40 bg-verify-false/5 px-4 py-3 text-sm text-verify-false"
        role="alert"
      >
        처리 중 오류: {errorMessage || "다시 시도해 주세요."}
      </div>
    );
  }

  if (!PROCESSING.includes(status)) return null;

  return (
    <div
      className="fixed bottom-0 inset-x-0 z-50 border-t border-accent/30 bg-accent-muted/95 backdrop-blur px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-lg"
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto max-w-6xl flex items-center gap-3 text-sm text-ink-800">
        <Loader2 className="h-5 w-5 animate-spin text-accent shrink-0" />
        <div>
          <p className="font-medium">
            {STATUS_LABEL[status] ?? "처리 중"}…
          </p>
          <p className="text-xs text-ink-600 mt-0.5">
            요약·팩트체크를 준비합니다. 보통 30초~2분 걸립니다. 화면을
            닫지 마세요.
          </p>
        </div>
      </div>
    </div>
  );
}
