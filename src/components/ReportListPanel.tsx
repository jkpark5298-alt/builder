"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Eye, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ko } from "date-fns/locale";
import type { VideoRecord } from "@/lib/types";
import { isReportInput } from "@/lib/input-mode";
import { formatTagList } from "@/lib/tags";

/** 확정 보고서 목록 — 조회 · 삭제 */
export function ReportListPanel({
  initialReports,
}: {
  initialReports: VideoRecord[];
}) {
  const router = useRouter();
  const [reports, setReports] = useState(initialReports);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    setReports(initialReports);
  }, [initialReports]);

  async function remove(video: VideoRecord) {
    if (!confirm(`「${video.title}」을(를) 삭제할까요?`)) return;
    setBusyId(video.id);
    try {
      const res = await fetch(`/api/videos/${video.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "삭제에 실패했습니다.");
      }
      setReports((prev) => prev.filter((r) => r.id !== video.id));
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "삭제에 실패했습니다.");
    } finally {
      setBusyId(null);
    }
  }

  if (reports.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-ink-300 bg-white/50 px-6 py-12 text-center">
        <p className="font-display text-lg text-ink-700">
          완성된 보고서가 없습니다
        </p>
        <p className="text-ink-500 mt-2 text-sm">
          유튜브·팩트체크 보고서에서 확정하면 여기에 보관됩니다.
        </p>
      </div>
    );
  }

  const btn =
    "inline-flex items-center justify-center gap-1.5 min-h-10 rounded-lg border px-3 text-sm font-medium transition-colors";

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-500">
        확정된 보고서 <strong className="text-ink-800">{reports.length}</strong>
        건 · 조회·삭제만 이 목록에서 합니다.
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {reports.map((video) => {
          const busy = busyId === video.id;
          return (
            <article
              key={video.id}
              className="overflow-hidden rounded-2xl border border-ink-200 bg-white/90"
            >
              <a href={`/videos/${video.id}#report`} className="block group">
                <div className="aspect-video overflow-hidden bg-ink-900">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={video.thumbnailUrl}
                    alt=""
                    className="h-full w-full object-cover opacity-95 group-hover:scale-[1.03] transition-transform duration-500"
                  />
                </div>
                <div className="p-4 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs px-2 py-0.5 rounded-md bg-verify-true/10 text-verify-true">
                      확정
                    </span>
                    {isReportInput(video) ? (
                      <span className="text-xs px-2 py-0.5 rounded-md bg-ink-900/90 text-white">
                        팩트체크보고서
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-md bg-ink-100 text-ink-600">
                        유튜브
                      </span>
                    )}
                    <span className="text-xs text-ink-400">
                      {formatDistanceToNow(new Date(video.updatedAt), {
                        addSuffix: true,
                        locale: ko,
                      })}
                    </span>
                  </div>
                  <h3 className="font-medium text-ink-900 line-clamp-2 group-hover:text-accent transition-colors">
                    {video.title}
                  </h3>
                  <p className="text-sm text-ink-500">{video.channel}</p>
                  {!!video.userTags?.length && (
                    <p className="text-xs text-accent line-clamp-1">
                      {formatTagList(video.userTags)}
                    </p>
                  )}
                </div>
              </a>
              <div className="px-4 pb-4 flex flex-wrap gap-2 border-t border-ink-100 pt-3">
                <a
                  href={`/videos/${video.id}#report`}
                  className={`${btn} flex-1 border-ink-900 bg-ink-900 text-white hover:opacity-90`}
                >
                  <Eye className="h-4 w-4" />
                  조회
                </a>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void remove(video)}
                  className={`${btn} border-verify-false/30 text-verify-false hover:bg-verify-false/5 disabled:opacity-50`}
                >
                  <Trash2 className="h-4 w-4" />
                  {busy ? "삭제 중…" : "삭제"}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
