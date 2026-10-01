"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ClipboardPaste,
  FileText,
  Library,
} from "lucide-react";
import type { VideoRecord } from "@/lib/types";
import {
  isReportInputDraft,
  isReportPending,
  libraryStage,
} from "@/lib/library";
import { ReportCreateForm } from "@/components/ReportCreateForm";
import { ReportListPanel } from "@/components/ReportListPanel";
import { HubPreviewItemList } from "@/components/HubPreviewItemList";
import { ArchiveAppFileList, ArchiveAppFileRow } from "@/components/ArchiveAppFileList";

type HubView = "home" | "input" | "status" | "appfiles";
type InputStep = "summary" | "report";

/** 정보 보관소 작업 단계 (유튜브 제외) — 요약 → 보고서 */
export function factcheckWorkStep(video: VideoRecord): InputStep {
  if (isReportPending(video)) return "report";
  if (isReportInputDraft(video)) return "summary";
  const stage = libraryStage(video);
  if (
    stage === "processing" ||
    video.status === "summarizing" ||
    video.status === "queued" ||
    video.status === "fetching"
  ) {
    return "summary";
  }
  if (stage === "report_pending") return "report";
  if (video.report || video.status === "awaiting_factcheck") {
    return video.overview.trim().length >= 40 ? "report" : "summary";
  }
  return "summary";
}

function stepHref(video: VideoRecord, step: InputStep): string {
  if (step === "summary") {
    if (isReportInputDraft(video)) return `/videos/${video.id}`;
    return `/videos/${video.id}#general-summary`;
  }
  return `/videos/${video.id}#report`;
}

export function FactcheckReportHub({
  workItems,
  completedReports,
}: {
  workItems: VideoRecord[];
  completedReports: VideoRecord[];
}) {
  const [savedNow, setSavedNow] = useState<VideoRecord[]>([]);
  const [view, setView] = useState<HubView>("home");
  const [inputStep, setInputStep] = useState<InputStep>("summary");
  const [showAllReports, setShowAllReports] = useState(false);

  useEffect(() => {
    function sync() {
      if (typeof window === "undefined") return;
      const hash = window.location.hash.replace(/^#/, "");
      if (hash === "fc-app-files") {
        setView("appfiles");
      } else if (hash === "fc-status" || hash === "report-list") {
        setView("status");
        setShowAllReports(hash === "report-list");
      } else if (
        hash === "fc-input" ||
        hash === "report-create" ||
        hash === "fc-url"
      ) {
        // fc-url은 삭제된 URL 입력 — 정보/요약 입력으로 안내
        setView("input");
        if (hash === "fc-url") {
          window.history.replaceState(null, "", "/#fc-input");
        }
      } else if (
        hash === "fc-home" ||
        hash === "paste" ||
        hash === "factcheck"
      ) {
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
      if (href.includes("#fc-app-files")) {
        setView("appfiles");
      } else if (href.includes("#fc-status") || href.includes("#report-list")) {
        setView("status");
        if (href.includes("#report-list")) setShowAllReports(true);
      } else if (
        href.includes("#fc-input") ||
        href.includes("#report-create") ||
        href.includes("#fc-url")
      ) {
        setView("input");
      }
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  function go(next: HubView, hash: string) {
    const run = () => {
      setView(next);
      if (next === "input") setInputStep("summary");
      if (next !== "status") setShowAllReports(false);
      if (typeof window !== "undefined") {
        window.history.replaceState(null, "", `/#${hash}`);
      }
    };
    if (typeof window !== "undefined" && view === "input" && next !== "input") {
      const ev = new CustomEvent("yfc-archive-leave", { cancelable: true });
      if (!window.dispatchEvent(ev)) return;
    }
    run();
  }

  useEffect(() => {
    function onContinue() {
      /* 저장하지 않고 나가기 — 폼이 dirty를 끈 뒤 한 번 더 뒤로를 누르게 하지 않고
         홈으로 되돌린다. */
      setView("home");
      setInputStep("summary");
      setShowAllReports(false);
      window.history.replaceState(null, "", "/#fc-home");
    }
    window.addEventListener("yfc-archive-leave-continue", onContinue);
    return () =>
      window.removeEventListener("yfc-archive-leave-continue", onContinue);
  }, []);

  const sortedCompleted = useMemo(
    () =>
      [...completedReports].sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      ),
    [completedReports]
  );

  useEffect(() => {
    function onSaved(e: Event) {
      const video = (e as CustomEvent<VideoRecord>).detail;
      if (!video?.id) return;
      setSavedNow((prev) => [video, ...prev.filter((v) => v.id !== video.id)]);
    }
    window.addEventListener("yfc-archive-saved", onSaved);
    return () => window.removeEventListener("yfc-archive-saved", onSaved);
  }, []);

  const mergedWorkItems = useMemo(() => {
    const ids = new Set(workItems.map((v) => v.id));
    return [...savedNow.filter((v) => !ids.has(v.id)), ...workItems];
  }, [workItems, savedNow]);

  const sortedWorkItems = useMemo(
    () =>
      [...mergedWorkItems].sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      ),
    [mergedWorkItems]
  );

  const latestFive = sortedCompleted.slice(0, 5);
  const latestWork = sortedWorkItems.slice(0, 5);
  const statusList = showAllReports ? sortedCompleted : latestFive;

  if (view === "input") {
    return (
      <section id="fc-input" className="space-y-5 scroll-mt-24">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => go("home", "fc-home")}
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
              붙여넣기 · 임시 저장 · 보고서
            </p>
          </div>
        </div>

        <ReportCreateForm />
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-ink-700">입력 이어하기</h3>
          {sortedWorkItems.filter(isReportInputDraft).length === 0 ? (
            <p className="text-sm text-ink-500 rounded-xl border border-dashed border-ink-200 px-4 py-6 text-center">
              임시 저장한 항목이 없습니다. 위에서 입력하세요.
            </p>
          ) : (
            <ul className="divide-y divide-ink-100 rounded-2xl border border-ink-200 bg-white">
              {sortedWorkItems.filter(isReportInputDraft).map((v) => (
                <li
                  key={v.id}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <a
                    href={`/videos/${v.id}`}
                    className="min-w-0 truncate text-sm font-medium text-ink-900 hover:underline"
                  >
                    {v.title}
                  </a>
                  <a
                    href={`/videos/${v.id}`}
                    className="shrink-0 text-sm font-medium text-accent"
                  >
                    이어서
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    );
  }

  if (view === "status") {
    return (
      <section id="fc-status" className="space-y-5 scroll-mt-24">
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => go("home", "fc-home")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-700 hover:border-accent"
          >
            <ArrowLeft className="h-4 w-4" />
            뒤로
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-xl text-ink-900 flex items-center gap-2">
              <Library className="h-5 w-5 text-accent" />
              정보 보관소 현황
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
                    next ? "/#report-list" : "/#fc-status"
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

  if (view === "appfiles") {
    return (
      <section id="fc-app-files" className="space-y-5 scroll-mt-24">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => go("home", "fc-home")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-700 hover:border-accent"
          >
            <ArrowLeft className="h-4 w-4" />
            뒤로
          </button>
          <div>
            <h2 className="font-display text-xl text-ink-900">앱 파일 목록</h2>
            <p className="text-sm text-ink-500 mt-0.5">
              앱 파일로 만든 제목 · 선택하면 상세로 갑니다. 보고서가 없으면 삭제로 표시합니다.
            </p>
          </div>
        </div>
        <ArchiveAppFileList scope="report" />
      </section>
    );
  }

  const emptyWork = (
    <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-ink-400">
      <FileText className="h-3.5 w-3.5" />
      작업 중 없음
    </span>
  );

  return (
    <section id="fc-home" className="space-y-4 scroll-mt-24 min-w-0">
      <ArchiveAppFileRow
        scope="report"
        onOpenList={() => go("appfiles", "fc-app-files")}
      />
      <div className="grid gap-3 sm:grid-cols-2 min-w-0">
        <article className="group min-w-0 max-w-full overflow-hidden rounded-2xl border border-ink-200 bg-white p-5 sm:p-6 text-left shadow-sm hover:border-accent hover:shadow-md transition-all">
          <button
            type="button"
            onClick={() => go("input", "fc-input")}
            className="w-full text-left"
          >
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-accent-muted text-accent">
              <ClipboardPaste className="h-5 w-5" />
            </span>
            <span className="mt-4 block font-display text-xl text-ink-900 group-hover:text-accent">
              정보/요약 입력
            </span>
            <span className="mt-1.5 block text-sm text-ink-500 leading-relaxed">
              요약 붙여넣기 → 보고서 작성·이미지 · 삭제
            </span>
          </button>
          <HubPreviewItemList
            items={latestWork}
            accent
            showStatus
            appFileSave
            empty={emptyWork}
            hrefFor={(v) => `/videos/${v.id}`}
          />
        </article>

        <article className="group min-w-0 max-w-full overflow-hidden rounded-2xl border border-ink-200 bg-white p-5 sm:p-6 text-left shadow-sm hover:border-accent hover:shadow-md transition-all">
          <button
            type="button"
            onClick={() => go("status", "fc-status")}
            className="w-full text-left"
          >
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-ink-900 text-white">
              <Library className="h-5 w-5" />
            </span>
            <span className="mt-4 block font-display text-xl text-ink-900 group-hover:text-accent">
              정보 보관소 현황
            </span>
            <span className="mt-1.5 block text-sm text-ink-500 leading-relaxed">
              최신 5건 · 전체 보기 · 조회·삭제
            </span>
          </button>
          <HubPreviewItemList
            items={latestFive}
            showStatus
            appFileSave
            empty={
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-ink-400">
                확정 보고서 없음
              </span>
            }
            hrefFor={(v) => `/videos/${v.id}#report`}
          />
        </article>
      </div>
    </section>
  );
}
