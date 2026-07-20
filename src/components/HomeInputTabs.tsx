"use client";

import { useState } from "react";
import { UrlPasteForm } from "./UrlPasteForm";
import { ReportCreateForm } from "./ReportCreateForm";

type Tab = "youtube" | "report";

export function HomeInputTabs() {
  const [tab, setTab] = useState<Tab>("youtube");

  const items: Array<{ id: Tab; label: string; hint: string }> = [
    { id: "youtube", label: "유튜브", hint: "URL · 자막 자동 가져오기" },
    { id: "report", label: "Report 생성", hint: "스크립트 직접 입력" },
  ];

  return (
    <div className="space-y-4">
      <div
        className="flex gap-1 rounded-xl bg-ink-100/80 p-1"
        role="tablist"
        aria-label="입력 방식"
      >
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={`flex-1 min-h-11 rounded-lg px-3 py-2 text-left transition-colors ${
              tab === item.id
                ? "bg-white text-ink-900 shadow-sm"
                : "text-ink-500 hover:text-ink-800"
            }`}
          >
            <span className="block text-sm font-semibold">{item.label}</span>
            <span className="block text-[11px] mt-0.5 opacity-80">
              {item.hint}
            </span>
          </button>
        ))}
      </div>
      {tab === "youtube" ? <UrlPasteForm /> : <ReportCreateForm />}
    </div>
  );
}
