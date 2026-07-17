"use client";

import { Check, ChevronDown, ChevronRight, Copy } from "lucide-react";
import { useMemo, useState } from "react";
import type { VideoRecord } from "@/lib/types";

/** 저장된 자막(스크립트) — 선택(펼침) 시 표시 + 복사 */
export function SavedTranscriptPanel({ video }: { video: VideoRecord }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const text = (video.transcript ?? "").trim();
  const hasScript = text.length > 80;
  const sourceLabel = useMemo(() => {
    switch (video.transcriptSource) {
      case "pasted":
        return "붙여넣기";
      case "youtube":
        return "유튜브 자막";
      case "youtube_auto":
        return "자동자막";
      case "speech_text":
        return "음성→텍스트";
      case "creator_meta":
        return "설명·챕터";
      default:
        return "없음";
    }
  }, [video.transcriptSource]);

  async function copyAll() {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  if (!hasScript) {
    return (
      <div className="rounded-xl border border-ink-200 bg-ink-50/80 px-4 py-3 text-sm text-ink-600">
        저장된 자막이 없습니다. 홈에서 자막을 가져와 요약하면 여기에 보관됩니다.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-ink-200 bg-white overflow-hidden">
      <div className="flex items-stretch gap-1 px-2 py-1.5 sm:px-3 sm:py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex-1 min-w-0 flex items-center gap-2 px-2 py-2 text-left rounded-lg hover:bg-ink-50 transition-colors"
          aria-expanded={open}
        >
          {open ? (
            <ChevronDown className="h-4 w-4 text-accent shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-ink-400 shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-ink-900">
              저장된 자막 (스크립트)
            </p>
            <p className="text-xs text-ink-500 mt-0.5">
              {sourceLabel} · {text.length.toLocaleString()}자 · 눌러서{" "}
              {open ? "접기" : "보기"}
            </p>
          </div>
        </button>
        <button
          type="button"
          onClick={() => void copyAll()}
          className="self-center shrink-0 inline-flex items-center gap-1.5 min-h-10 rounded-lg border border-ink-200 bg-white px-3 text-xs font-medium hover:border-accent"
          aria-label="저장된 자막 복사"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-emerald-600" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          {copied ? "복사됨" : "자막 복사"}
        </button>
      </div>

      {open && (
        <div className="border-t border-ink-100 px-4 pb-4 pt-3">
          <pre className="max-h-72 overflow-auto rounded-lg border border-ink-100 bg-ink-50/80 p-3 text-xs sm:text-sm text-ink-800 whitespace-pre-wrap leading-relaxed">
            {text}
          </pre>
        </div>
      )}
    </div>
  );
}
