"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { Topic, VideoRecord } from "@/lib/types";
import { isComplete, isReportPending } from "@/lib/library";
import { TopicCreateForm } from "./TopicCreateForm";
import { TopicListCard } from "./TopicListCard";
import { FactcheckReportHub } from "./FactcheckReportHub";
import { YoutubeReportHub } from "./YoutubeReportHub";
import { SearchBar } from "./SearchBar";
import { VideoListCard } from "./VideoListCard";

type Tab = "youtube" | "factcheck" | "topic";

function tabFromHash(hash: string): Tab | null {
  const h = hash.replace(/^#/, "");
  if (
    h === "youtube" ||
    h === "yt-home" ||
    h === "yt-input" ||
    h === "yt-status" ||
    h === "youtube-reports"
  ) {
    return "youtube";
  }
  if (h === "topics" || h === "topic") return "topic";
  if (
    h === "factcheck" ||
    h === "fc-home" ||
    h === "fc-input" ||
    h === "fc-url" ||
    h === "fc-status" ||
    h === "report-create" ||
    h === "report-list" ||
    h === "paste" ||
    h === "archive" ||
    h === "search"
  ) {
    return "factcheck";
  }
  return null;
}

function listKindFor(
  video: VideoRecord
): "draft" | "report-pending" | "report-complete" {
  if (isComplete(video)) return "report-complete";
  if (isReportPending(video)) return "report-pending";
  return "draft";
}

export function HomeInputTabs({
  youtubeItems,
  youtubeCompletedReports,
  reportWorkItems,
  completedReports,
  topics,
  searchQuery = "",
  searchResults = [],
}: {
  youtubeItems: VideoRecord[];
  youtubeCompletedReports: VideoRecord[];
  reportWorkItems: VideoRecord[];
  completedReports: VideoRecord[];
  topics: Topic[];
  searchQuery?: string;
  /** 유튜브·정보 보관소·작업 중·확정 전체 */
  searchResults?: VideoRecord[];
}) {
  const [tab, setTab] = useState<Tab>("youtube");
  const q = searchQuery.trim();
  const searching = q.length > 0;

  useEffect(() => {
    function sync() {
      if (typeof window === "undefined") return;
      const next = tabFromHash(window.location.hash);
      if (next) setTab(next);
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
      const hash = href.includes("#") ? href.split("#")[1] ?? "" : "";
      const next = tabFromHash(hash);
      if (next) setTab(next);
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  function selectTab(next: Tab) {
    setTab(next);
    const hash =
      next === "youtube"
        ? "youtube"
        : next === "topic"
          ? "topics"
          : "factcheck";
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(
        typeof window !== "undefined" ? window.location.search : ""
      );
      const qs = params.toString();
      window.history.replaceState(
        null,
        "",
        qs ? `/?${qs}#${hash}` : `/#${hash}`
      );
    }
  }

  const items: Array<{ id: Tab; label: string; hint: string }> = [
    { id: "youtube", label: "유튜브", hint: "URL · 자막 · 요약 · 보고서" },
    {
      id: "factcheck",
      label: "정보 보관소",
      hint: "붙여넣기 · 요약 · 보고서",
    },
    { id: "topic", label: "주제", hint: "태그 모아 통합 보고서" },
  ];

  let body: ReactNode;
  if (searching) {
    body = (
      <section id="search" className="space-y-4 scroll-mt-24">
        <div>
          <h2 className="font-display text-xl text-ink-900">
            {q === "전체" || q.toLowerCase() === "all" || q === "*"
              ? "전체 목록"
              : "검색 결과"}
          </h2>
          <p className="text-sm text-ink-500 mt-0.5">
            {q === "전체" || q.toLowerCase() === "all" || q === "*"
              ? "작성된 유튜브·정보 보관소 항목 전부"
              : `「${q}」 · 유튜브·정보 보관소 전체`}{" "}
            <strong className="text-ink-800">{searchResults.length}</strong>건
          </p>
        </div>
        {searchResults.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-ink-300 bg-white/50 px-6 py-12 text-center">
            <p className="font-display text-lg text-ink-700">검색 결과가 없습니다</p>
            <p className="text-ink-500 mt-2 text-sm">
              제목·채널·요약·본문·태그로 다시 검색해 보세요.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {searchResults.map((v) => (
              <VideoListCard key={v.id} video={v} listKind={listKindFor(v)} />
            ))}
          </div>
        )}
      </section>
    );
  } else if (tab === "youtube") {
    body = (
      <div id="youtube" className="scroll-mt-24">
        <YoutubeReportHub
          workItems={youtubeItems}
          completedReports={youtubeCompletedReports}
        />
      </div>
    );
  } else if (tab === "factcheck") {
    body = (
      <div id="factcheck" className="scroll-mt-24">
        <FactcheckReportHub
          workItems={reportWorkItems}
          completedReports={completedReports}
        />
      </div>
    );
  } else {
    body = (
      <div id="topics" className="space-y-4 scroll-mt-24">
        <TopicCreateForm />
        {topics.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-ink-300 bg-white/50 px-6 py-12 text-center">
            <p className="font-display text-lg text-ink-700">주제가 없습니다</p>
            <p className="text-ink-500 mt-2 text-sm">
              위에서 주제를 만들면 여기에 표시됩니다.
            </p>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {topics.map((t) => (
              <TopicListCard key={t.id} topic={t} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div id="paste" className="space-y-4 scroll-mt-24">
      <SearchBar
        initialQuery={searchQuery}
        placeholder="제목·채널·요약·본문·태그 검색 · 「전체」로 모든 목록"
      />

      {!searching && (
        <div
          className="flex gap-1 rounded-xl bg-ink-100/80 p-1"
          role="tablist"
          aria-label="홈 메뉴"
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => selectTab(item.id)}
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
      )}

      {searching && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-ink-500">전체 보고서 검색 중</p>
          <a
            href="/#paste"
            className="text-sm font-medium text-accent hover:underline"
          >
            검색 닫기
          </a>
        </div>
      )}

      {body}
    </div>
  );
}
