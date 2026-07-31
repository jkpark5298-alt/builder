"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FolderOpen, Trash2 } from "lucide-react";
import type { Topic } from "@/lib/types";
import { formatTag } from "@/lib/tags";
import { formatDistanceToNow } from "date-fns";
import { ko } from "date-fns/locale";

export function TopicListCard({ topic }: { topic: Topic }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`주제 「${topic.title}」을(를) 삭제할까요?`)) return;
    setBusy(true);
    try {
      await fetch(`/api/topics/${topic.id}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="rounded-2xl border border-ink-200 bg-white/90 hover:border-accent/40 hover:shadow-md transition-all overflow-hidden">
      <a href={`/topics/${topic.id}`} className="block p-4 group">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-ink-100 text-ink-700 p-2.5 group-hover:bg-accent-muted group-hover:text-accent transition-colors">
            <FolderOpen className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span
                className={`text-xs px-2 py-0.5 rounded-md ${
                  topic.status === "ready"
                    ? "bg-verify-true/10 text-verify-true"
                    : "bg-ink-100 text-ink-600"
                }`}
              >
                {topic.status === "ready" ? "통합 보고서" : "주제"}
              </span>
              <span className="text-xs text-ink-400">
                {formatTag(topic.themeTag)}
              </span>
            </div>
            <h3 className="font-display text-lg text-ink-900 leading-snug break-words group-hover:text-accent transition-colors">
              {topic.title}
            </h3>
            <p className="text-xs text-ink-500 mt-1">
              항목 {topic.entryIds.length}건 ·{" "}
              {formatDistanceToNow(new Date(topic.updatedAt), {
                addSuffix: true,
                locale: ko,
              })}
            </p>
          </div>
        </div>
      </a>
      <div className="px-4 pb-3 flex justify-end">
        <button
          type="button"
          disabled={busy}
          onClick={remove}
          className="inline-flex items-center gap-1 text-xs text-ink-400 hover:text-verify-false min-h-9 px-2"
        >
          <Trash2 className="h-3.5 w-3.5" />
          삭제
        </button>
      </div>
    </article>
  );
}
