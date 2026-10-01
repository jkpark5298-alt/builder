"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  ARCHIVE_FLOW,
  YOUTUBE_STAGES,
  type ArchiveStepId,
  type YoutubeStageId,
} from "@/lib/flow-steps";

const ARCHIVE_VISIBLE = ARCHIVE_FLOW.filter((s) => s.id !== "image");

type StepId = YoutubeStageId;

export function VideoStepNav({
  videoId,
  isArchive,
  current,
  reportReady,
  archivePhase = "report",
}: {
  videoId: string;
  isArchive: boolean;
  current: StepId;
  reportReady: boolean;
  archivePhase?: "report" | "done";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<
    "paste" | "edit" | "image" | null
  >(null);
  const [flowOpen, setFlowOpen] = useState(false);

  useEffect(() => {
    if (!isArchive) return;
    const onTool = (e: Event) => {
      const id = (e as CustomEvent<"paste" | "edit" | "image">).detail;
      if (id === "paste" || id === "edit" || id === "image") {
        setActiveTool(id);
      }
    };
    window.addEventListener("yfc-archive-tool", onTool);
    return () => window.removeEventListener("yfc-archive-tool", onTool);
  }, [isArchive]);
  const currentIndex = YOUTUBE_STAGES.findIndex((s) => s.id === current);

  async function openInput() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/videos/${videoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnToReportInput: true }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "입력 화면으로 가지 못했습니다.");
      router.refresh();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "입력 화면으로 가지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  function select(id: StepId) {
    if (id === "script" && isArchive && current !== "script") {
      void openInput();
      return;
    }
    const href =
      id === "script"
        ? "#step-script"
        : id === "summary"
          ? "#step-summary"
          : "#report";
    document.querySelector(href)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (isArchive) {
    const activeIndex = archivePhase === "done" ? 9 : 6;
    const currentMark = archivePhase === "done" ? 9 : 4;
    const currentStep =
      archivePhase === "done"
        ? (ARCHIVE_VISIBLE.find((s) => s.id === "done") ??
          ARCHIVE_VISIBLE[ARCHIVE_VISIBLE.length - 1]!)
        : activeTool === "paste" || activeTool === "edit"
          ? (ARCHIVE_VISIBLE.find((s) => s.id === activeTool) ??
            ARCHIVE_VISIBLE[4]!)
          : (ARCHIVE_VISIBLE.find((s) => s.id === "report") ??
            ARCHIVE_VISIBLE[4]!);
    const nextStep =
      ARCHIVE_VISIBLE[
        ARCHIVE_VISIBLE.findIndex((s) => s.id === currentStep.id) + 1
      ] ?? null;
    function archiveSelect(id: ArchiveStepId) {
      if (id === "input") {
        void openInput();
        return;
      }
      if (id === "paste" || id === "edit" || id === "image") {
        window.dispatchEvent(
          new CustomEvent("yfc-archive-tool", { detail: id })
        );
      }
      const href =
        id === "report" || id === "edit" || id === "paste" || id === "image"
          ? "#report"
          : id === "confirm"
            ? "#report-confirm"
            : "#step-done";
      document.querySelector(href)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    return (
      <div className="space-y-2">
        <div className="rounded-xl border border-ink-200 bg-white">
          <button
            type="button"
            onClick={() => setFlowOpen((v) => !v)}
            className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
            aria-expanded={flowOpen}
          >
            <span className="text-sm font-semibold text-ink-900">절차</span>
            {flowOpen ? (
              <ChevronUp className="h-4 w-4 text-ink-500" />
            ) : (
              <ChevronDown className="h-4 w-4 text-ink-500" />
            )}
          </button>
          <div className="grid grid-cols-2 gap-2 border-t border-ink-100 px-3 py-2 text-xs">
            <p>
              <span className="text-ink-500">현재</span>{" "}
              <strong className="font-semibold text-ink-900">
                {currentStep.n}. {currentStep.short}
              </strong>
            </p>
            <p>
              <span className="text-ink-500">다음</span>{" "}
              <strong className="font-semibold text-ink-900">
                {nextStep ? `${nextStep.n}. ${nextStep.short}` : "끝"}
              </strong>
            </p>
          </div>
        </div>
        {flowOpen ? (
        <ol className="grid grid-cols-2 gap-1.5 text-center text-[11px] sm:grid-cols-5 sm:text-xs">
          {ARCHIVE_FLOW.map((s, index) => {
            if (s.id === "image") return null;
            const isTool = s.id === "paste" || s.id === "edit";
            const isCurrent = isTool
              ? activeTool === s.id
              : index === currentMark;
            const selectable =
              s.id === "input" ||
              (s.id === "report" && reportReady && !isCurrent) ||
              ((s.id === "paste" || s.id === "edit") &&
                reportReady &&
                archivePhase !== "done") ||
              (s.id === "confirm" && reportReady && archivePhase !== "done") ||
              (s.id === "done" && archivePhase === "done" && !isCurrent);
            const reached = index <= activeIndex;
            const className = `w-full rounded-lg border px-1.5 py-2 font-medium ${
              isCurrent
                ? "border-accent bg-accent-muted/70 text-ink-900"
                : selectable
                  ? "border-accent/40 bg-white text-ink-900 hover:border-accent"
                  : reached
                    ? "border-ink-200 bg-white text-ink-700"
                    : "border-ink-200 bg-white/60 text-ink-400"
            }`;
            if (!selectable) {
              return (
                <li key={s.id}>
                  <div className={className} aria-current={isCurrent ? "step" : undefined}>
                    {s.n}. {s.short}
                  </div>
                </li>
              );
            }
            return (
              <li key={s.id}>
                <button type="button" disabled={busy} onClick={() => archiveSelect(s.id)} className={className}>
                  {s.n}. {s.short}
                </button>
              </li>
            );
          })}
        </ol>
        ) : null}
        {error ? (
          <p className="rounded-xl border border-red-600 bg-red-50 px-3 py-2 text-sm font-medium text-red-700" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <ol className="grid grid-cols-3 gap-2 text-center text-xs sm:text-sm">
        {YOUTUBE_STAGES.map((s, index) => {
          const reached = index <= currentIndex || (s.id === "report" && reportReady);
          const selectable =
            reached && (index < currentIndex || s.id === "report" && reportReady && current !== "report");
          const isCurrent = s.id === current;
          const className = `w-full rounded-xl border px-2 py-2.5 font-medium ${
            isCurrent
              ? "border-accent bg-accent-muted/70 text-ink-900"
              : selectable
                ? "border-accent/40 bg-white text-ink-900 hover:border-accent"
                : "border-ink-200 bg-white/60 text-ink-400"
          }`;
          if (!selectable) {
            return (
              <li key={s.id}>
                <div className={className} aria-current={isCurrent ? "step" : undefined}>
                  {s.n}. {s.short}
                </div>
              </li>
            );
          }
          return (
            <li key={s.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => select(s.id)}
                className={className}
              >
                {s.n}. {s.short}
              </button>
            </li>
          );
        })}
      </ol>
      {error ? (
        <p className="rounded-xl border border-red-600 bg-red-50 px-3 py-2 text-sm font-medium text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
