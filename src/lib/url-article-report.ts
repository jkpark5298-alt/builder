import { plainTextToHtml } from "./report";
import { reportSourceLink } from "./input-mode";
import { stabilizeReportFcAnchors } from "./fc-markers";
import {
  bindSectionSlotUrls,
  upsertRoomUrls,
  normalizeRoomItems,
} from "./report-images";
import { ensureTrailingSMarkers } from "./report-body-s-slots";
import { REPORT_TYPE_LABELS } from "./types";
import type { ReportSectionBlock, TypedReport, VideoRecord } from "./types";

/** 기사 말미 통신사 출처·메일·저작권 안내 */
export function stripPressBoilerplate(text: string): string {
  const dropLine = (line: string) => {
    const t = line.replace(/\u00a0/g, " ").trim();
    if (!t) return true;
    if (/◎\s*공감언론\s*뉴시스/i.test(t)) return true;
    if (/^(ⓒ|©|Copyright\b)/i.test(t)) return true;
    if (/무단전재|재배포\s*금지/.test(t)) return true;
    if (/^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/.test(t)) return true;
    if (
      t.length <= 80 &&
      /뉴시스|연합뉴스|뉴스1|오마이뉴스/.test(t) &&
      /@|기자/.test(t)
    ) {
      return true;
    }
    return false;
  };
  const lines = text.replace(/\u00a0/g, " ").split(/\n/);
  while (lines.length && dropLine(lines[lines.length - 1] || "")) {
    lines.pop();
  }
  return lines
    .join("\n")
    .replace(/(?:\n|^)\s*◎\s*공감언론\s*뉴시스[^\n]*$/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 본문에 끼워 둔 `[이미지 N]` 표시 — 실제 사진은 S칸으로 붙이므로 글자는 제거 */
export function stripArticleImageMarkers(text: string): string {
  return stripPressBoilerplate(
    text
      .replace(/\[이미지\s*\d+\]/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/**
 * URL 원문 → 보고서.
 * 본문은 평문 문단(HTML `<p>`). 받은 사진은 본문 끝 S칸에 붙여,
 * 기존처럼 S/s → 붙여넣기·사진첩으로 더 넣을 수 있게 한다.
 */
export function buildUrlArticleReport(
  video: Pick<
    VideoRecord,
    | "title"
    | "channel"
    | "sourceUrl"
    | "youtubeUrl"
    | "inputMode"
    | "transcript"
    | "articleImages"
    | "reportType"
    | "updatedAt"
    | "createdAt"
  >
): TypedReport {
  const bodyText = stripArticleImageMarkers(video.transcript ?? "");
  const images = (video.articleImages ?? []).map((u) => u.trim()).filter(Boolean);
  let body = bodyText ? plainTextToHtml(bodyText) : "<p></p>";
  if (images.length) {
    body = ensureTrailingSMarkers(body, images.length);
  }

  const section: ReportSectionBlock = {
    sectionId: "sec-url-body",
    heading: "본문",
    body,
    rich: true,
  };
  const bound = images.length
    ? bindSectionSlotUrls(section, [], images, { body, rich: true })
    : { room: [], section };

  const writtenAt = new Date(
    video.updatedAt || video.createdAt
  ).toLocaleString("ko-KR");

  return {
    meta: {
      title: video.title,
      channel: video.channel,
      url: reportSourceLink(video),
      writtenAt,
    },
    reportType: video.reportType || "C",
    reportTypeLabel: REPORT_TYPE_LABELS[video.reportType || "C"] || "일반 보고서",
    format: "general_v5",
    sections: [bound.section],
    summaryExcerpt: bodyText.slice(0, 400),
    imageRoom: bound.room,
    factChecks: [],
  };
}

export const URL_ARTICLE_REPORT_NOTICE =
  "URL 원문 전체를 보고서 본문(평문)으로 넣었습니다. 받은 사진은 본문 아래 S칸에 붙였습니다. 문장 끝에 S를 치면 붙여넣기·사진첩으로 더 넣을 수 있습니다. 요약·팩트체크는 선택입니다.";

/** 기존 보고서의 팩트체크는 유지하고, 본문만 URL 원문(+S칸 사진)으로 교체 */
export function applyUrlArticleBodyToReport(video: VideoRecord): TypedReport {
  const built = buildUrlArticleReport(video);
  const existing = video.report;
  if (!existing) return built;
  const extraUrls = normalizeRoomItems(existing.imageRoom)
    .map((item) => item.url)
    .filter((url) => !(video.articleImages ?? []).includes(url));
  const { room } = extraUrls.length
    ? upsertRoomUrls(built.imageRoom, extraUrls)
    : { room: built.imageRoom };
  return stabilizeReportFcAnchors({
    ...existing,
    sections: built.sections,
    summaryExcerpt: built.summaryExcerpt,
    imageRoom: room,
    meta: {
      ...existing.meta,
      url: built.meta.url || existing.meta.url,
      writtenAt: built.meta.writtenAt,
    },
    factChecks: existing.factChecks ?? [],
  });
}
