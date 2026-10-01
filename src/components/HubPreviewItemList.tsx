"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Trash2 } from "lucide-react";
import type { VideoRecord } from "@/lib/types";
import { isComplete } from "@/lib/library";
import { downloadArchiveAppFile, isAppFileItem } from "@/lib/archive-app-file";

function indexStatusLabel(video: VideoRecord) {
  return isComplete(video) ? "저장" : "임시 저장";
}

export function HubPreviewItemList({
  items,
  accent,
  empty,
  hrefFor,
  showStatus = false,
  appFileSave = false,
}: {
  items: VideoRecord[];
  accent?: boolean;
  empty: ReactNode;
  hrefFor?: (video: VideoRecord) => string;
  /** PC 목록에 상태 칸을 둡니다. */
  showStatus?: boolean;
  /** 고른 제목을 앱 파일로 저장합니다. 임시 저장·저장 모두, 1건도 됩니다. */
  appFileSave?: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(items);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    setRows(items);
  }, [items]);

  useEffect(() => {
    const visible = new Set(rows.map((row) => row.id));
    setSelectedIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (visible.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [rows]);

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function exportSelected() {
    const picked = rows.filter((row) => selectedIds.has(row.id));
    if (picked.length === 0) return;
    setExporting(true);
    try {
      for (const row of picked) {
        const res = await fetch(`/api/videos/${row.id}`);
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          video?: VideoRecord;
        };
        if (!res.ok || !data.video) {
          throw new Error(data.error || `「${row.title}」을 불러오지 못했습니다.`);
        }
        await downloadArchiveAppFile(data.video);
      }
      setSelectedIds(new Set());
      setSelectMode(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : "앱 파일을 저장하지 못했습니다.");
    } finally {
      setExporting(false);
    }
  }

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

  const selectedCount = rows.filter((row) => selectedIds.has(row.id)).length;

  return (
    <div className="mt-3 min-w-0">
      {appFileSave ? (
        <div className="mb-2 space-y-1.5">
          <button
            type="button"
            disabled={exporting || (selectMode && selectedCount === 0)}
            onClick={() => {
              if (!selectMode) {
                setSelectMode(true);
                return;
              }
              void exportSelected();
            }}
            className="w-full rounded-xl border border-ink-300 bg-white px-3 py-2.5 text-sm font-semibold text-ink-800 disabled:opacity-50"
          >
            {exporting
              ? "앱 파일 저장 중…"
              : selectMode
                ? selectedCount > 0
                  ? `선택 앱 파일 저장 (${selectedCount})`
                  : "제목을 선택하세요"
                : "제목별 앱 파일 저장"}
          </button>
          {selectMode ? (
            <button
              type="button"
              disabled={exporting}
              onClick={() => {
                setSelectMode(false);
                setSelectedIds(new Set());
              }}
              className="text-[11px] font-medium text-ink-500 underline-offset-2 hover:underline"
            >
              선택 취소
            </button>
          ) : (
            <p className="text-[11px] leading-relaxed text-ink-400">
              고른 제목만 앱 파일로 만듭니다. 임시 저장은 저장된 내용을 불러온
              뒤 넣고, 이미 저장된 글도 됩니다. 1건도 됩니다.
            </p>
          )}
        </div>
      ) : null}
      {showStatus ? (
        <div className="mb-1 hidden items-center gap-1.5 pr-9 text-[10px] font-semibold text-ink-400 md:flex">
          {selectMode ? <span className="w-4 shrink-0" /> : null}
          <span className="w-4 shrink-0" />
          <span className="min-w-0 flex-1">제목</span>
          <span className="w-16 shrink-0 text-center">상태</span>
        </div>
      ) : null}
      <ol
        className={`space-y-1.5 text-xs font-medium min-w-0 ${
          accent ? "text-accent" : "text-ink-700"
        }`}
      >
        {rows.map((v, i) => {
          const href = hrefFor?.(v);
          const title = v.title || "제목 없음";
          const busy = busyId === v.id;
          const status = indexStatusLabel(v);
          return (
            <li key={v.id} className="flex gap-1.5 min-w-0 items-start">
              {selectMode ? (
                <label className="shrink-0 pt-0.5">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(v.id)}
                    onChange={() => toggleSelected(v.id)}
                    aria-label={`${title} 선택`}
                    className="h-4 w-4 rounded border-ink-300"
                  />
                </label>
              ) : null}
              <span className="shrink-0 tabular-nums pt-0.5">{i + 1}.</span>
              {href && !selectMode ? (
                <a
                  href={href}
                  onClick={(e) => e.stopPropagation()}
                  className="min-w-0 flex-1 line-clamp-2 break-keep hover:underline"
                  title={title}
                >
                  {isAppFileItem(v) ? <span className="text-amber-500">★ </span> : null}
                  {title}
                </a>
              ) : (
                <span className="min-w-0 flex-1 line-clamp-2 break-keep" title={title}>
                  {isAppFileItem(v) ? <span className="text-amber-500">★ </span> : null}
                  {title}
                </span>
              )}
              {showStatus ? (
                <span
                  className={`hidden md:inline-flex mt-0.5 w-16 shrink-0 items-center justify-center rounded px-1 py-0.5 text-[10px] font-bold leading-none ${
                    status === "저장"
                      ? "bg-emerald-700 text-white"
                      : "bg-ink-100 text-ink-600"
                  }`}
                >
                  {status}
                </span>
              ) : null}
              {selectMode ? null : (
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`${title} 삭제`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void remove(v);
                  }}
                  className="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-md text-verify-false hover:bg-verify-false/10 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
