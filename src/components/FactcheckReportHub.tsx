"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ClipboardPaste,
  FileText,
  Library,
  PenLine,
  ShieldCheck,
} from "lucide-react";
import type { VideoRecord } from "@/lib/types";
import {
  isReportInputDraft,
  isReportPending,
  libraryStage,
} from "@/lib/library";
import { ReportCreateForm } from "@/components/ReportCreateForm";
import { ReportListPanel } from "@/components/ReportListPanel";
import { VideoListCard } from "@/components/VideoListCard";

type HubView = "home" | "input" | "status";
type InputStep = "summary" | "factcheck" | "report";

function listKindFor(
  video: VideoRecord
): "draft" | "report-pending" | "report-complete" {
  if (video.status === "ready") return "report-complete";
  if (isReportPending(video)) return "report-pending";
  return "draft";
}

/** 팩트체크보고서 작업 단계 (유튜브 제외) */
export function factcheckWorkStep(
  video: Pick<VideoRecord, "status" | "items" | "factChecks">
): InputStep {
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
  return "factcheck";
}

function stepHref(video: VideoRecord, step: InputStep): string {
  if (step === "summary") {
    if (isReportInputDraft(video)) return `/videos/${video.id}`;
    return `/videos/${video.id}#overview`;
  }
  if (step === "factcheck") return `/videos/${video.id}#manual-factcheck`;
  return `/videos/${video.id}#report`;
}

export function FactcheckReportHub({
  workItems,
  completedReports,
}: {
  workItems: VideoRecord[];
  completedReports: VideoRecord[];
}) {
  const [view, setView] = useState<HubView>("home");
  const [inputStep, setInputStep] = useState<InputStep>("summary");
  const [showAllReports, setShowAllReports] = useState(false);

  useEffect(() => {
    function sync() {
      if (typeof window === "undefined") return;
      const hash = window.location.hash.replace(/^#/, "");
      if (hash === "fc-status" || hash === "report-list") {
        setView("status");
        setShowAllReports(hash === "report-list");
      } else if (hash === "fc-input" || hash === "report-create") {
        setView("input");
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
      if (href.includes("#fc-status") || href.includes("#report-list")) {
        setView("status");
        if (href.includes("#report-list")) setShowAllReports(true);
      } else if (href.includes("#fc-input") || href.includes("#report-create")) {
        setView("input");
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

  const latestFive = sortedCompleted.slice(0, 5);
  const statusList = showAllReports ? sortedCompleted : latestFive;

  const stepItems = useMemo(
    () => workItems.filter((v) => factcheckWorkStep(v) === inputStep),
    [workItems, inputStep]
  );

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
              팩트체크보고서 전용 · 요약 → 팩트체크 → 보고서 작성
            </p>
          </div>
        </div>

        <div
          className="grid gap-2 sm:grid-cols-3"
          role="tablist"
          aria-label="입력 단계"
        >
          {(
            [
              {
                id: "summary" as const,
                label: "요약",
                hint: "복사·붙여넣기 입력",
                icon: ClipboardPaste,
              },
              {
                id: "factcheck" as const,
                label: "팩트체크 내용",
                hint: "요약 기반 검증 입력",
                icon: ShieldCheck,
              },
              {
                id: "report" as const,
                label: "보고서 작성",
                hint: "정리 + 이미지",
                icon: PenLine,
              },
            ] as const
          ).map((s) => {
            const Icon = s.icon;
            const active = inputStep === s.id;
            const count = workItems.filter(
              (v) => factcheckWorkStep(v) === s.id
            ).length;
            return (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setInputStep(s.id)}
                className={`rounded-xl border px-3 py-3 text-left transition-colors ${
                  active
                    ? "border-accent bg-accent-muted/40 shadow-sm"
                    : "border-ink-200 bg-white hover:border-accent/50"
                }`}
              >
                <span className="flex items-center gap-2 font-semibold text-ink-900 text-sm">
                  <Icon className="h-4 w-4 text-accent shrink-0" />
                  {s.label}
                  {count > 0 && (
                    <span className="ml-auto text-xs font-medium text-ink-500">
                      {count}
                    </span>
                  )}
                </span>
                <span className="block text-[11px] text-ink-500 mt-1 pl-6">
                  {s.hint}
                </span>
              </button>
            );
          })}
        </div>

        {inputStep === "summary" && (
          <div className="space-y-4">
            <ReportCreateForm />
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-ink-700">
                요약·입력 이어하기
              </h3>
              {stepItems.length === 0 ? (
                <p className="text-sm text-ink-500 rounded-xl border border-dashed border-ink-200 px-4 py-6 text-center">
                  진행 중인 요약 항목이 없습니다. 위에서 새로 입력하세요.
                </p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {stepItems.map((v) => (
                    <div key={v.id} className="space-y-2">
                      <VideoListCard video={v} listKind={listKindFor(v)} />
                      <a
                        href={stepHref(v, "summary")}
                        className="flex items-center justify-center gap-1.5 min-h-10 rounded-lg border border-ink-900 bg-ink-900 text-sm font-medium text-white hover:opacity-90"
                      >
                        <ClipboardPaste className="h-4 w-4" />
                        요약 이어서
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {inputStep === "factcheck" && (
          <div className="space-y-3">
            <p className="text-sm text-ink-600 rounded-xl border border-ink-200 bg-ink-50/80 px-3 py-2">
              요약한 내용에 대해 팩트체크를 입력합니다. 항목을 고르면 해당
              화면으로 이동합니다.
            </p>
            {stepItems.length === 0 ? (
              <p className="text-sm text-ink-500 rounded-xl border border-dashed border-ink-200 px-4 py-8 text-center">
                팩트체크 진행 항목이 없습니다. 「요약」에서 먼저 입력·요약을
                마치고 오세요.
              </p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {stepItems.map((v) => (
                  <div key={v.id} className="space-y-2">
                    <VideoListCard video={v} listKind={listKindFor(v)} />
                    <a
                      href={stepHref(v, "factcheck")}
                      className="flex items-center justify-center gap-1.5 min-h-10 rounded-lg border border-ink-900 bg-ink-900 text-sm font-medium text-white hover:opacity-90"
                    >
                      <ShieldCheck className="h-4 w-4" />
                      팩트체크 입력
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {inputStep === "report" && (
          <div className="space-y-3">
            <p className="text-sm text-ink-600 rounded-xl border border-ink-200 bg-ink-50/80 px-3 py-2">
              요약·팩트체크를 정리하고 이미지를 넣습니다. 작성 화면으로
              이동합니다.
            </p>
            {stepItems.length === 0 ? (
              <p className="text-sm text-ink-500 rounded-xl border border-dashed border-ink-200 px-4 py-8 text-center">
                보고서 작성 대기 항목이 없습니다. 팩트체크를 마치면 여기로
                옵니다.
              </p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {stepItems.map((v) => (
                  <div key={v.id} className="space-y-2">
                    <VideoListCard video={v} listKind={listKindFor(v)} />
                    <a
                      href={stepHref(v, "report")}
                      className="flex items-center justify-center gap-1.5 min-h-10 rounded-lg border border-ink-900 bg-ink-900 text-sm font-medium text-white hover:opacity-90"
                    >
                      <PenLine className="h-4 w-4" />
                      보고서 작성
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
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
              팩트체크 보고서 현황
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

  return (
    <section id="fc-home" className="space-y-4 scroll-mt-24">
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => go("input", "fc-input")}
          className="group rounded-2xl border border-ink-200 bg-white p-5 sm:p-6 text-left shadow-sm hover:border-accent hover:shadow-md transition-all"
        >
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-accent-muted text-accent">
            <ClipboardPaste className="h-5 w-5" />
          </span>
          <span className="mt-4 block font-display text-xl text-ink-900 group-hover:text-accent">
            정보/요약 입력
          </span>
          <span className="mt-1.5 block text-sm text-ink-500 leading-relaxed">
            요약 붙여넣기 → 팩트체크 입력 → 보고서 작성·이미지
          </span>
          <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-accent">
            <FileText className="h-3.5 w-3.5" />
            작업 중 {workItems.length}건
          </span>
        </button>

        <button
          type="button"
          onClick={() => go("status", "fc-status")}
          className="group rounded-2xl border border-ink-200 bg-white p-5 sm:p-6 text-left shadow-sm hover:border-accent hover:shadow-md transition-all"
        >
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-ink-900 text-white">
            <Library className="h-5 w-5" />
          </span>
          <span className="mt-4 block font-display text-xl text-ink-900 group-hover:text-accent">
            팩트체크 보고서 현황
          </span>
          <span className="mt-1.5 block text-sm text-ink-500 leading-relaxed">
            최신 5건 · 전체 보기 · 조회·삭제
          </span>
          <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-ink-600">
            확정 {completedReports.length}건
          </span>
        </button>
      </div>
    </section>
  );
}
