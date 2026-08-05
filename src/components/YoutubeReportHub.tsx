"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ClipboardPaste,
  FileText,
  Library,
  Youtube,
} from "lucide-react";
import type { VideoRecord } from "@/lib/types";
import { isComplete, isReportPending } from "@/lib/library";
import { UrlPasteForm } from "@/components/UrlPasteForm";
import { ReportListPanel } from "@/components/ReportListPanel";
import { VideoListCard } from "@/components/VideoListCard";

type HubView = "home" | "input" | "status";

function listKindFor(
  video: VideoRecord
): "draft" | "report-pending" | "report-complete" {
  if (isComplete(video)) return "report-complete";
  if (isReportPending(video)) return "report-pending";
  return "draft";
}

/** 유튜브 탭 — 정보/요약 입력 · 유튜브 보고서 현황 (기존 기능 재조립) */
export function YoutubeReportHub({
  workItems,
  completedReports,
}: {
  workItems: VideoRecord[];
  completedReports: VideoRecord[];
}) {
  const [view, setView] = useState<HubView>("home");
  const [showAllReports, setShowAllReports] = useState(false);

  useEffect(() => {
    function sync() {
      if (typeof window === "undefined") return;
      const hash = window.location.hash.replace(/^#/, "");
      if (hash === "yt-status" || hash === "youtube-reports") {
        setView("status");
        setShowAllReports(hash === "youtube-reports");
      } else if (hash === "yt-input") {
        setView("input");
      } else if (hash === "youtube" || hash === "yt-home") {
        setView("home");
      }
    }
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a) return;
      const href = a.getAttribute("href") || "";
      if (href.includes("#yt-status") || href.includes("#youtube-reports")) {
        setView("status");
        if (href.includes("#youtube-reports")) setShowAllReports(true);
      } else if (href.includes("#yt-input")) {
        setView("input");
      } else if (
        href.endsWith("#youtube") ||
        href.includes("/#youtube") ||
        href.includes("#yt-home")
      ) {
        setView("home");
      }
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  function go(next: HubView, hash: string) {
    setView(next);
    if (next !== "status") setShowAllReports(false);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `/#${hash}`);
    }
  }

  const sortedCompleted = useMemo(
    () =>
      [...completedReports].sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      ),
    [completedReports]
  );

  const sortedWorkItems = useMemo(
    () =>
      [...workItems].sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      ),
    [workItems]
  );

  const latestFive = sortedCompleted.slice(0, 5);
  const latestWorkFive = sortedWorkItems.slice(0, 5);
  const statusList = showAllReports ? sortedCompleted : latestFive;

  if (view === "input") {
    return (
      <section id="yt-input" className="space-y-5 scroll-mt-24">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => go("home", "youtube")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-700 hover:border-accent"
          >
            <ArrowLeft className="h-4 w-4" />
            뒤로
          </button>
          <div>
            <h2 className="font-display text-xl text-ink-900 flex items-center gap-2">
              <ClipboardPaste className="h-5 w-5 text-accent" />
              정보/요약 입력
            </h2>
            <p className="text-sm text-ink-500 mt-0.5">
              유튜브 URL · 자막 자동 가져오기 (기존 기능 그대로)
            </p>
          </div>
        </div>

        <UrlPasteForm />

        <div className="space-y-2">
          <h3 className="text-sm font-medium text-ink-700">작업 중</h3>
          {workItems.length === 0 ? (
            <p className="text-sm text-ink-500 rounded-xl border border-dashed border-ink-200 px-4 py-6 text-center">
              유튜브 작업 항목이 없습니다. 위에서 URL을 붙여 넣어 시작하세요.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {workItems.map((v) => (
                <VideoListCard
                  key={v.id}
                  video={v}
                  listKind={listKindFor(v)}
                />
              ))}
            </div>
          )}
        </div>
      </section>
    );
  }

  if (view === "status") {
    return (
      <section id="yt-status" className="space-y-5 scroll-mt-24">
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => go("home", "youtube")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-700 hover:border-accent"
          >
            <ArrowLeft className="h-4 w-4" />
            뒤로
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-xl text-ink-900 flex items-center gap-2">
              <Library className="h-5 w-5 text-accent" />
              유튜브 보고서 현황
            </h2>
            <p className="text-sm text-ink-500 mt-0.5">
              확정본 조회 · 삭제 ·{" "}
              {showAllReports
                ? `전체 ${sortedCompleted.length}건`
                : `최신 ${Math.min(5, sortedCompleted.length)}건`}
            </p>
          </div>
          {sortedCompleted.length > 5 && (
            <button
              type="button"
              onClick={() => {
                const next = !showAllReports;
                setShowAllReports(next);
                if (typeof window !== "undefined") {
                  window.history.replaceState(
                    null,
                    "",
                    next ? "/#youtube-reports" : "/#yt-status"
                  );
                }
              }}
              className="rounded-lg border border-accent/40 bg-accent-muted/40 px-3 py-2 text-sm font-medium text-ink-900 hover:bg-accent-muted"
            >
              {showAllReports ? "최신 5건만" : "전체 보고서 보기"}
            </button>
          )}
        </div>

        {!showAllReports && sortedCompleted.length > 5 && (
          <p className="text-xs text-ink-500">
            최신 5건을 보여 줍니다. 「전체 보고서 보기」로 모두 조회할 수
            있습니다.
          </p>
        )}

        <ReportListPanel initialReports={statusList} />
      </section>
    );
  }

  return (
    <section id="yt-home" className="space-y-4 scroll-mt-24">
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => go("input", "yt-input")}
          className="group rounded-2xl border border-ink-200 bg-white p-5 sm:p-6 text-left shadow-sm hover:border-accent hover:shadow-md transition-all"
        >
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-accent-muted text-accent">
            <ClipboardPaste className="h-5 w-5" />
          </span>
          <span className="mt-4 block font-display text-xl text-ink-900 group-hover:text-accent">
            정보/요약 입력
          </span>
          <span className="mt-1.5 block text-sm text-ink-500 leading-relaxed">
            URL 붙여넣기 · 자막 자동 가져오기 · 기존 입력 화면
          </span>
          {latestWorkFive.length > 0 ? (
            <ol className="mt-3 space-y-1 text-xs font-medium text-accent">
              {latestWorkFive.map((v, i) => (
                <li key={v.id} className="flex gap-1.5 min-w-0">
                  <span className="shrink-0 tabular-nums">{i + 1}.</span>
                  <span className="truncate">{v.title || "제목 없음"}</span>
                </li>
              ))}
            </ol>
          ) : (
            <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-ink-400">
              <FileText className="h-3.5 w-3.5" />
              작업 중 없음
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => go("status", "yt-status")}
          className="group rounded-2xl border border-ink-200 bg-white p-5 sm:p-6 text-left shadow-sm hover:border-accent hover:shadow-md transition-all"
        >
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-ink-900 text-white">
            <Library className="h-5 w-5" />
          </span>
          <span className="mt-4 block font-display text-xl text-ink-900 group-hover:text-accent">
            유튜브 보고서 현황
          </span>
          <span className="mt-1.5 block text-sm text-ink-500 leading-relaxed">
            최신 5건 · 전체 보기 · 조회·삭제
          </span>
          {latestFive.length > 0 ? (
            <ol className="mt-3 space-y-1 text-xs font-medium text-ink-700">
              {latestFive.map((v, i) => (
                <li key={v.id} className="flex gap-1.5 min-w-0">
                  <span className="shrink-0 tabular-nums">{i + 1}.</span>
                  <span className="truncate">{v.title || "제목 없음"}</span>
                </li>
              ))}
            </ol>
          ) : (
            <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-ink-400">
              <Youtube className="h-3.5 w-3.5" />
              확정 보고서 없음
            </span>
          )}
        </button>
      </div>
    </section>
  );
}
