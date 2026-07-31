import type {
  ReportSectionBlock,
  ReportType,
  Topic,
  TypedReport,
  VideoRecord,
} from "./types";
import { buildTypedReport, highlightConclusion } from "./report";
import {
  collectEntryTags,
  formatTag,
  formatTagList,
  normalizeTagList,
  selectEntriesByTags,
} from "./tags";

export { collectEntryTags, selectEntriesByTags };

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 태그로 선별된 Entry들의 요약·팩트체크(이미지 포함)를 하나의 TypedReport로 통합.
 */
export function composeTopicReport(
  topic: Pick<Topic, "title" | "themeTag" | "reportType">,
  entries: VideoRecord[],
  selectedTags: string[]
): TypedReport {
  const tags = normalizeTagList(selectedTags);
  const filtered = selectEntriesByTags(entries, tags);
  const writtenAt = new Date().toLocaleString("ko-KR");
  const tagLabel = tags.length
    ? tags.map(formatTag).join(" ")
    : formatTag(topic.themeTag) || "전체";

  const sections: ReportSectionBlock[] = [];
  const factChecks: TypedReport["factChecks"] = [];

  const conclusionBits = filtered
    .map((e) => e.title.trim())
    .filter(Boolean)
    .slice(0, 8);
  sections.push({
    sectionId: "topic-conclusion",
    heading: "결론",
    body: highlightConclusion(
      conclusionBits.length
        ? `「${topic.title}」 — ${tagLabel} 기준 ${filtered.length}건을 통합했습니다. (${conclusionBits.join(" · ")})`
        : `「${topic.title}」 — 선별된 항목이 없습니다. 태그를 확인하거나 항목을 추가하세요.`
    ),
    rich: true,
  });

  sections.push({
    sectionId: "topic-intro",
    heading: "도입",
    body: `<p>${escapeHtml(
      `분류: ${tagLabel}. 작성일 기준으로 오래된 항목부터 요약·팩트체크를 모았습니다.`
    )}</p>`,
    rich: true,
  });

  if (!filtered.length) {
    sections.push({
      sectionId: "topic-empty",
      heading: "항목 없음",
      body: `<p>${escapeHtml(
        "선택한 태그와 일치하는 저장된 항목이 없습니다."
      )}</p>`,
      rich: true,
    });
  }

  for (const entry of filtered) {
    const entryTags = formatTagList(entry.userTags) || formatTag(topic.themeTag);
    const dateLabel = new Date(entry.createdAt).toLocaleDateString("ko-KR");
    const single = buildTypedReport(entry);

    sections.push({
      sectionId: `topic-entry-${entry.id}-meta`,
      heading: entry.title.slice(0, 80) || "제목 없음",
      body: `<p><strong>${escapeHtml(entryTags)}</strong> · 작성 ${escapeHtml(
        dateLabel
      )}</p>${
        entry.overview.trim()
          ? `<p>${escapeHtml(entry.overview.trim().slice(0, 1200))}${
              entry.overview.trim().length > 1200 ? "…" : ""
            }</p>`
          : ""
      }`,
      rich: true,
    });

    for (const sec of single.sections) {
      if (sec.heading === "결론" || sec.heading === "도입") continue;
      sections.push({
        ...sec,
        sectionId: `topic-entry-${entry.id}-${sec.sectionId ?? sec.heading}`,
        heading: `${entry.title.slice(0, 40)} · ${sec.heading}`.slice(0, 80),
      });
    }

    for (const fc of single.factChecks ?? []) {
      factChecks.push({
        ...fc,
        itemId: fc.itemId ? `${entry.id}:${fc.itemId}` : undefined,
        statement: `[${entry.title}] ${fc.statement}`,
      });
    }
  }

  const reportType = (topic.reportType ||
    filtered[0]?.reportType ||
    "C") as ReportType;

  return {
    meta: {
      title: `${topic.title} (${tagLabel})`,
      channel: "주제 통합",
      url: "Topic compose",
      writtenAt,
    },
    reportType,
    reportTypeLabel: "일반 보고서",
    format: "general_v5",
    sections,
    summaryExcerpt: [
      `주제: ${topic.title}`,
      `분류: ${tagLabel}`,
      `항목 ${filtered.length}건`,
      ...filtered.slice(0, 6).map((e, i) => `${i + 1}. ${e.title}`),
    ].join("\n"),
    factChecks,
  };
}
