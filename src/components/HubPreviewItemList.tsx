"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Trash2 } from "lucide-react";
import type { VideoRecord } from "@/lib/types";

export function HubPreviewItemList({
  items,
  accent,
  empty,
  hrefFor,
}: {
  items: VideoRecord[];
  accent?: boolean;
  empty: ReactNode;
  hrefFor?: (video: VideoRecord) => string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(items);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    setRows(items);
  }, [items]);

  async function remove(video: VideoRecord) {
    if (!confirm(`「${video.title}」을(를) 삭제할까요?`)) return;
    setBusyId(video.id);
    try {
      const res = await fetch(`/api/videos/${video.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "삭제에 실패했습니다.");
      }
      setRows((prev) => prev.filter((r) => r.id !== video.id));
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "삭제에 실패했습니다.");
    } finally {
      setBusyId(null);
    }
  }

  if (rows.length === 0) return <>{empty}</>;

  return (
    <ol
      className={`mt-3 space-y-1 text-xs font-medium ${
        accent ? "text-accent" : "text-ink-700"
      }`}
    >
      {rows.map((v, i) => {
        const href = hrefFor?.(v);
        const title = v.title || "제목 없음";
        const busy = busyId === v.id;
        return (
          <li key={v.id} className="flex gap-1.5 min-w-0 items-center">
            <span className="shrink-0 tabular-nums">{i + 1}.</span>
            {href ? (
              <a
                href={href}
                className="truncate min-w-0 flex-1 hover:underline"
                title={title}
              >
                {title}
              </a>
            ) : (
              <span className="truncate min-w-0 flex-1" title={title}>
                {title}
              </span>
            )}
            <button
              type="button"
              disabled={busy}
              aria-label={`${title} 삭제`}
              onClick={() => void remove(v)}
              className="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-md text-verify-false hover:bg-verify-false/10 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </li>
        );
      })}
    </ol>
  );
}
