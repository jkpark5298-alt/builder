"use client";

import { useEffect, useState } from "react";
import type { AppFileListItem } from "@/lib/archive-app-file";
import { AppFileMark } from "@/components/AppFileMark";
import { ArchiveAppFileLoadButton } from "@/components/ArchiveAppFileButtons";

export function ArchiveAppFileRow({
  scope,
  onOpenList,
}: {
  scope: "youtube" | "report";
  onOpenList: () => void;
}) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await fetch(`/api/app-files?scope=${scope}`);
      const data = (await res.json().catch(() => ({}))) as {
        items?: AppFileListItem[];
      };
      if (!cancelled) setCount(data.items?.length ?? 0);
    }
    void load();
    function onSaved() {
      void load();
    }
    window.addEventListener("yfc-archive-saved", onSaved);
    return () => {
      cancelled = true;
      window.removeEventListener("yfc-archive-saved", onSaved);
    };
  }, [scope]);

  return (
    <div className="grid grid-cols-2 gap-2 min-w-0">
      <ArchiveAppFileLoadButton
        variant="button"
        className="flex w-full min-w-0 items-center justify-center gap-1.5 min-h-12 rounded-2xl border border-accent/40 bg-amber-50 px-2 text-sm font-medium text-ink-900 sm:gap-2 sm:px-3 sm:text-base"
      />
      <button
        type="button"
        onClick={onOpenList}
        className="inline-flex min-w-0 items-center justify-center gap-1.5 min-h-12 rounded-2xl border border-ink-300 bg-white px-2 text-sm font-medium text-ink-900 sm:gap-2 sm:px-3 sm:text-base"
      >
        <AppFileMark size="sm" />
        <span className="sm:hidden">목록</span>
        <span className="hidden sm:inline">앱 파일 목록</span>
        {count > 0 ? (
          <span className="rounded-md bg-ink-100 px-1.5 py-0.5 text-xs font-medium text-ink-700">
            {count}
          </span>
        ) : null}
      </button>
    </div>
  );
}

export function ArchiveAppFileList({
  scope,
}: {
  scope: "youtube" | "report";
}) {
  const [items, setItems] = useState<AppFileListItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await fetch(`/api/app-files?scope=${scope}`);
      const data = (await res.json().catch(() => ({}))) as {
        items?: AppFileListItem[];
      };
      if (!cancelled) setItems(data.items ?? []);
    }
    void load();
    function onSaved() {
      void load();
    }
    window.addEventListener("yfc-archive-saved", onSaved);
    return () => {
      cancelled = true;
      window.removeEventListener("yfc-archive-saved", onSaved);
    };
  }, [scope]);

  if (items === null) {
    return <p className="text-sm text-ink-500">목록을 읽는 중…</p>;
  }

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-ink-300 bg-white/50 px-6 py-12 text-center">
        <p className="font-display text-lg text-ink-700">앱 파일 목록이 없습니다</p>
        <p className="text-sm text-ink-500 mt-2">
          「앱 파일 불러오기」로 ★ .yfc 를 열면 여기에 제목만 남습니다. 보고서를
          지워도 목록은 유지됩니다.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-500">
        앱 파일로 만든 항목 <strong className="text-ink-800">{items.length}</strong>
        건 · 제목을 누르면 상세로 갑니다.
      </p>
      <ul className="divide-y divide-ink-100 rounded-2xl border border-ink-200 bg-white">
        {items.map((item) => {
          if (!item.exists) {
            return (
              <li
                key={item.id}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <AppFileMark size="sm" />
                  <span className="min-w-0 truncate text-sm text-ink-800">
                    {item.title}
                  </span>
                </span>
                <span className="shrink-0 text-sm font-medium text-red-600">
                  삭제
                </span>
              </li>
            );
          }
          return (
            <li key={item.id}>
              <a
                href={item.href || `/videos/${item.id}`}
                className="flex items-center gap-2 px-4 py-3 text-sm text-ink-900 hover:bg-ink-50"
              >
                <AppFileMark size="sm" />
                <span className="min-w-0 truncate">{item.title}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
