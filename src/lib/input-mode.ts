import type { InputMode, VideoRecord } from "./types";

export type { InputMode };

export function isYoutubeInput(
  video: Pick<VideoRecord, "inputMode">
): boolean {
  return (video.inputMode ?? "youtube") === "youtube";
}

export function isReportInput(
  video: Pick<VideoRecord, "inputMode">
): boolean {
  return video.inputMode === "report";
}

/** Report 생성 항목용 썸네일 (외부 URL 없음) */
export function reportThumbnailUrl(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270" viewBox="0 0 480 270"><rect fill="#1a2430" width="480" height="270"/><rect x="40" y="50" width="400" height="170" rx="12" fill="#2a3648"/><text x="240" y="125" text-anchor="middle" fill="#f4f6f8" font-family="system-ui,sans-serif" font-size="22" font-weight="600">Report</text><text x="240" y="155" text-anchor="middle" fill="#c45c26" font-family="system-ui,sans-serif" font-size="14">직접 입력 · 요약 · 팩트체크</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
