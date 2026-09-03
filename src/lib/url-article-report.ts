import { plainTextToHtml } from "./report";
import { reportSourceLink } from "./input-mode";
import { bindSectionSlotUrls } from "./report-images";
import { ensureTrailingSMarkers } from "./report-body-s-slots";
import { REPORT_TYPE_LABELS } from "./types";
import type { ReportSectionBlock, TypedReport, VideoRecord } from "./types";

/** 본문에 끼워 둔 `[이미지 N]` 표시 — 실제 사진은 S칸으로 붙이므로 글자는 제거 */
export function stripArticleImageMarkers(text: string): string {
  return text
    .replace(/\[이미지\s*\d+\]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
