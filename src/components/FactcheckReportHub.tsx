"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ClipboardPaste,
  FileText,
  Library,
  Link2,
  PenLine,
  ShieldCheck,
} from "lucide-react";
import type { VideoRecord } from "@/lib/types";
import {
  isUrlArticleInput,
  needsFactCheckDecision,
} from "@/lib/input-mode";
import {
  isReportInputDraft,
  isReportPending,
  libraryStage,
} from "@/lib/library";
import { ReportCreateForm } from "@/components/ReportCreateForm";
import { UrlArticleForm } from "@/components/UrlArticleForm";
import { ReportListPanel } from "@/components/ReportListPanel";
import { HubPreviewItemList } from "@/components/HubPreviewItemList";
import { VideoListCard } from "@/components/VideoListCard";

type HubView = "home" | "input" | "url" | "status";
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
  video: VideoRecord
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
  if (needsFactCheckDecision(video)) return "summary";
  if (stage === "report_pending") return "report";
  return "factcheck";
}

function stepHref(video: VideoRecord, step: InputStep): string {
  if (step === "summary") {
    if (isReportInputDraft(video)) return `/videos/${video.id}`;
    if (needsFactCheckDecision(video)) return `/videos/${video.id}#fc-decision`;
    return `/videos/${video.id}#general-summary`;
  }
  if (step === "factcheck") return `/videos/${video.id}#manual-factcheck`;
  return `/videos/${video.id}#report`;
}

function openWorkItem(href: string) {
  window.location.assign(href);
}

function UrlContinuePicker({ items }: { items: VideoRecord[] }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-ink-700">
        URL 본문·요약 이어하기
      </h3>
      <p className="text-xs text-ink-500">
        저장한 항목을 누르면 이어서 작성합니다.
      </p>
      <ul className="space-y-2">
        {items.map((v) => {
          const href = stepHref(v, "summary");
          const label = needsFactCheckDecision(v)
            ? "팩트체크 여부"
            : isReportInputDraft(v)
              ? "이어서 작성"
              : "열기";
          return (
            <li key={v.id}>
              <a
                href={href}
                onClick={(e) => {
                  e.preventDefault();
                  openWorkItem(href);
                }}
                className="flex items-center gap-3 min-h-12 rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-left hover:border-accent hover:bg-accent-muted/30"
              >
                <span className="min-w-0 flex-1 truncate font-medium text-ink-900">
                  {v.title || "제목 없음"}
                </span>
                <span className="shrink-0 text-xs font-medium text-accent">
                  {label}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
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
      } else if (hash === "fc-url") {
        setView("url");
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
      } else if (href.includes("#fc-url")) {
        setView("url");
      }
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  function go(next: HubView, hash: string) {
    setView(next);
    if (next === "url" || next === "input") setInputStep("summary");
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

  const urlWorkItems = useMemo(
    () => sortedWorkItems.filter(isUrlArticleInput),
    [sortedWorkItems]
  );
  const pasteWorkItems = useMemo(
    () => sortedWorkItems.filter((v) => !isUrlArticleInput(v)),
    [sortedWorkItems]
  );

  const latestFive = sortedCompleted.slice(0, 5);
  const latestPasteWork = pasteWorkItems.slice(0, 5);
  const latestUrlWork = urlWorkItems.slice(0, 5);
  const statusList = showAllReports ? sortedCompleted : latestFive;

  const stepPool = view === "url" ? urlWorkItems : pasteWorkItems;
  const stepItems = stepPool.filter((v) => factcheckWorkStep(v) === inputStep);

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
            const count = pasteWorkItems.filter(
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

  if (view === "url") {
    return (
      <section id="fc-url" className="space-y-5 scroll-mt-24 pb-36 sm:pb-8">
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
              <Link2 className="h-5 w-5 text-accent" />
              URL 입력
            </h2>
            <p className="text-sm text-ink-500 mt-0.5">
              제목·URL → 원문 전체를 보고서 본문(평문) · 사진은 본문 아래 ·
              요약·팩트체크는 선택
            </p>
          </div>
        </div>

        <div
          className="grid gap-2 sm:grid-cols-3"
          role="tablist"
          aria-label="URL 입력 단계"
        >
          {(
            [
              {
                id: "summary" as const,
                label: "원문",
                hint: "가져오기 · 보고서 본문",
                icon: Link2,
              },
              {
                id: "factcheck" as const,
                label: "팩트체크 내용",
                hint: "실시 선택 후 검증 입력",
                icon: ShieldCheck,
              },
              {
                id: "report" as const,
                label: "보고서 작성",
                hint: "정리 + 이미지 · 확정",
                icon: PenLine,
              },
            ] as const
          ).map((s) => {
            const Icon = s.icon;
            const active = inputStep === s.id;
            const count = urlWorkItems.filter(
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
            <UrlContinuePicker items={stepItems} />
            <UrlArticleForm />
          </div>
        )}

        {inputStep === "factcheck" && (
          <div className="space-y-3">
            <p className="text-sm text-ink-600 rounded-xl border border-ink-200 bg-ink-50/80 px-3 py-2">
              요약한 뒤 「팩트체크 실시」를 고른 항목입니다. URL 원문 보고서는
              팩트체크가 선택이며, 아래에서 이어서 할 수 있습니다.
            </p>
            {stepItems.length === 0 ? (
              <p className="text-sm text-ink-500 rounded-xl border border-dashed border-ink-200 px-4 py-8 text-center">
                팩트체크 진행 항목이 없습니다. URL은 원문 보고서 확정만으로도
                됩니다. 검증이 필요하면 항목에서 「팩트체크 하기」를 고르세요.
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
              원문 보고서를 다듬고 확정합니다. 받은 사진은 본문 아래에 있습니다.
              요약·팩트체크는 선택입니다.
            </p>
            {stepItems.length === 0 ? (
              <p className="text-sm text-ink-500 rounded-xl border border-dashed border-ink-200 px-4 py-8 text-center">
                보고서 작성 대기 항목이 없습니다. URL에서 원문을 가져와
                「보고서 만들기」를 누르면 여기로 옵니다.
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

  const emptyWork = (
    <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-ink-400">
      <FileText className="h-3.5 w-3.5" />
      작업 중 없음
    </span>
  );

  return (
    <section id="fc-home" className="space-y-4 scroll-mt-24">
      <div className="grid gap-3 sm:grid-cols-3">
        <article className="group rounded-2xl border border-ink-200 bg-white p-5 sm:p-6 text-left shadow-sm hover:border-accent hover:shadow-md transition-all">
          <button
            type="button"
            onClick={() => go("url", "fc-url")}
            className="w-full text-left"
          >
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-accent-muted text-accent">
              <Link2 className="h-5 w-5" />
            </span>
            <span className="mt-4 block font-display text-xl text-ink-900 group-hover:text-accent">
              URL 입력
            </span>
            <span className="mt-1.5 block text-sm text-ink-500 leading-relaxed">
              제목·URL → 원문 보고서 · 사진은 본문 아래 · 삭제
            </span>
          </button>
          <HubPreviewItemList
            items={latestUrlWork}
            accent
            empty={emptyWork}
            hrefFor={(v) => `/videos/${v.id}`}
          />
        </article>

        <article className="group rounded-2xl border border-ink-200 bg-white p-5 sm:p-6 text-left shadow-sm hover:border-accent hover:shadow-md transition-all">
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
              요약 붙여넣기 → 팩트체크 입력 → 보고서 작성·이미지 · 삭제
            </span>
          </button>
          <HubPreviewItemList
            items={latestPasteWork}
            accent
            empty={emptyWork}
            hrefFor={(v) => `/videos/${v.id}`}
          />
        </article>

        <article className="group rounded-2xl border border-ink-200 bg-white p-5 sm:p-6 text-left shadow-sm hover:border-accent hover:shadow-md transition-all">
          <button
            type="button"
            onClick={() => go("status", "fc-status")}
            className="w-full text-left"
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
          </button>
          <HubPreviewItemList
            items={latestFive}
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
