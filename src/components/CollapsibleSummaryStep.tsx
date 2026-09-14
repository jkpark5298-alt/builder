"use client";

import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";

/**
 * 1. 요약 단계 패널.
 * 보고서가 있으면 기본으로 접어 두고, 필요할 때만 펼칩니다.
 */
export function CollapsibleSummaryStep({
  title,
  defaultCollapsed,
  children,
}: {
  title: string;
  defaultCollapsed: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(!defaultCollapsed);

  return (
    <section
      id="general-summary"
      className="rounded-2xl border border-accent/30 bg-white shadow-sm overflow-hidden print:hidden"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 bg-accent px-4 sm:px-5 py-3.5 text-left"
      >
        <h2 className="font-display text-xl sm:text-2xl text-white">
          1. {title}
        </h2>
        <span className="flex shrink-0 items-center gap-1.5 text-sm text-white/90">
          {open ? "접기" : "펼치기"}
          <ChevronDown
            className={`h-5 w-5 transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden
          />
        </span>
      </button>
      {open ? (
        <div className="p-4 sm:p-5 space-y-3">{children}</div>
      ) : (
        <p className="px-4 sm:px-5 py-3 text-sm text-ink-500">
          {defaultCollapsed
            ? "보고서가 있어 요약을 접어 두었습니다. 수정이 필요하면 펼치세요."
            : "요약이 접혀 있습니다. 필요하면 펼치세요."}
        </p>
      )}
    </section>
  );
}
