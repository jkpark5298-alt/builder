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

/** 팩트체크보고서 · 웹 URL에서 본문을 가져온 항목 */
export function isUrlArticleInput(
  video: Pick<VideoRecord, "sourceUrl" | "tags" | "transcriptSource">
): boolean {
  if (video.sourceUrl?.trim()) return true;
  if (video.transcriptSource === "web") return true;
  return (video.tags ?? []).includes("url-article");
}

/** 보고서 메타·PDF에 넣을 원문 링크 */
export function reportSourceLink(
  video: Pick<VideoRecord, "inputMode" | "youtubeUrl" | "sourceUrl">
): string {
  const src = video.sourceUrl?.trim();
  if (src) return src;
  if (video.inputMode === "report") return "팩트체크보고서 (직접 입력)";
  return video.youtubeUrl;
}

/** 유튜브 팩트체크 pass — 검증 UI·게이트를 건너뛴다 */
export function isFactCheckPass(
  video: Pick<VideoRecord, "skipFactCheck" | "factCheckDecision">
): boolean {
  return video.skipFactCheck === true || video.factCheckDecision === "pass";
}

/** 요약 이후 팩트체크 실시 vs pass 를 고르는 경로 (유튜브 · URL 입력) */
export function offersFactCheckDecision(
  video: Pick<VideoRecord, "inputMode" | "sourceUrl" | "tags" | "transcriptSource">
): boolean {
  return isYoutubeInput(video) || isUrlArticleInput(video);
}

/** 요약 이후, 팩트체크 실시 vs pass 를 아직 고르지 않음 */
export function needsFactCheckDecision(
  video: Pick<
    VideoRecord,
    | "inputMode"
    | "status"
    | "overview"
    | "skipFactCheck"
    | "factCheckDecision"
    | "sourceUrl"
    | "tags"
    | "transcriptSource"
  >
): boolean {
  if (!offersFactCheckDecision(video)) return false;
  if (video.status !== "awaiting_factcheck") return false;
  if ((video.overview ?? "").trim().length < 40) return false;
  if (isFactCheckPass(video)) return false;
  if (video.factCheckDecision === "do") return false;
  return true;
}

/** PDF·인쇄 표지 제목 */
export function reportDocumentTitle(
  video: Pick<
    VideoRecord,
    | "inputMode"
    | "skipFactCheck"
    | "factCheckDecision"
    | "sourceUrl"
    | "tags"
    | "transcriptSource"
  >
): string {
  if (isFactCheckPass(video)) {
    return isYoutubeInput(video) ? "유튜브 요약 보고서" : "요약 보고서";
  }
  return isYoutubeInput(video)
    ? "유튜브 요약 · 팩트체크 보고서"
    : "팩트체크 보고서";
}

/** 팩트체크보고서 항목용 썸네일 (외부 URL 없음) */
export function reportThumbnailUrl(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270" viewBox="0 0 480 270"><rect fill="#1a2430" width="480" height="270"/><rect x="40" y="50" width="400" height="170" rx="12" fill="#2a3648"/><text x="240" y="125" text-anchor="middle" fill="#f4f6f8" font-family="system-ui,sans-serif" font-size="20" font-weight="600">팩트체크보고서</text><text x="240" y="155" text-anchor="middle" fill="#c45c26" font-family="system-ui,sans-serif" font-size="14">직접 입력 · 요약 · 팩트체크</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
