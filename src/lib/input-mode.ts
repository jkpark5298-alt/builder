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

/** 파이프라인에서 tags를 다시 짜도 url-article 표시는 유지 */
export function withUrlArticleTag(
  record: Pick<VideoRecord, "sourceUrl" | "transcriptSource" | "tags">,
  tags: string[]
): string[] {
  const keep = isUrlArticleInput(record);
  return Array.from(new Set([...tags, ...(keep ? ["url-article"] : [])]));
}

/** 보고서 메타·PDF에 넣을 원문 링크 */
export function reportSourceLink(
  video: Pick<VideoRecord, "inputMode" | "youtubeUrl" | "sourceUrl">
): string {
  const src = video.sourceUrl?.trim();
  if (src) return src;
  if (video.inputMode === "report") return "정보 보관소 (직접 입력)";
  return video.youtubeUrl;
}

/**
 * 팩트체크 중간 단계 제거 — 항상 요약→보고서(pass) 경로.
 * 기존 skipFactCheck / factCheckDecision=pass 기록과도 호환.
 */
export function isFactCheckPass(
  _video?: Pick<VideoRecord, "skipFactCheck" | "factCheckDecision">
): boolean {
  return true;
}

/** 팩트체크 실시/pass 선택 UI는 더 이상 쓰지 않음 */
export function offersFactCheckDecision(
  _video?: Pick<VideoRecord, "inputMode" | "sourceUrl" | "tags" | "transcriptSource">
): boolean {
  return false;
}

/** 팩트체크 선택 화면 — 비활성 */
export function needsFactCheckDecision(
  _video?: Pick<
    VideoRecord,
    | "inputMode"
    | "status"
    | "overview"
    | "skipFactCheck"
    | "factCheckDecision"
    | "sourceUrl"
    | "tags"
    | "transcriptSource"
    | "factChecks"
  >
): boolean {
  return false;
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
  return isYoutubeInput(video) ? "유튜브 요약 보고서" : "정보 보관소 보고서";
}

/** 정보 보관소 항목용 썸네일 (외부 URL 없음) */
export function reportThumbnailUrl(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270" viewBox="0 0 480 270"><rect fill="#1a2430" width="480" height="270"/><rect x="40" y="50" width="400" height="170" rx="12" fill="#2a3648"/><text x="240" y="125" text-anchor="middle" fill="#f4f6f8" font-family="system-ui,sans-serif" font-size="20" font-weight="600">정보 보관소</text><text x="240" y="155" text-anchor="middle" fill="#c45c26" font-family="system-ui,sans-serif" font-size="14">직접 입력 · 요약 · 보고서</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
