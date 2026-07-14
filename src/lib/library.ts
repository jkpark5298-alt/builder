import type { PipelineStatus, VideoRecord } from "./types";
import { factCheckProgress } from "./factcheck-client";

export type LibraryStage =
  | "processing"
  | "factcheck_draft"
  | "report_pending"
  | "complete"
  | "error";

/** 완료: 보고서·인포그래픽까지 생성됨 */
export function isComplete(video: Pick<VideoRecord, "status">): boolean {
  return video.status === "ready";
}

/**
 * 1) 임시 저장 — 팩트체크를 이어서 할 수 있는 단계
 * (진행 중·오류·팩트체크 미완료)
 */
export function isFactCheckDraft(
  video: Pick<VideoRecord, "status" | "items" | "factChecks">
): boolean {
  if (video.status === "ready") return false;
  if (video.status === "error") return true;
  if (
    video.status === "queued" ||
    video.status === "fetching" ||
    video.status === "summarizing" ||
    video.status === "fact_checking"
  ) {
    return true;
  }
  if (video.status === "awaiting_factcheck") {
    return !factCheckProgress(video).complete;
  }
  return true;
}

/**
 * 2) 보고서 작성 — 팩트체크 완료 후, 보고서 생성 전
 */
export function isReportPending(
  video: Pick<VideoRecord, "status" | "items" | "factChecks">
): boolean {
  if (video.status !== "awaiting_factcheck") return false;
  return factCheckProgress(video).complete;
}

export function libraryStage(
  video: Pick<VideoRecord, "status" | "items" | "factChecks">
): LibraryStage {
  if (video.status === "ready") return "complete";
  if (video.status === "error") return "error";
  if (isReportPending(video)) return "report_pending";
  if (
    video.status === "queued" ||
    video.status === "fetching" ||
    video.status === "summarizing" ||
    video.status === "fact_checking"
  ) {
    return "processing";
  }
  return "factcheck_draft";
}

export function libraryCardLabel(
  video: Pick<VideoRecord, "status" | "items" | "factChecks">
): string {
  switch (libraryStage(video)) {
    case "complete":
      return "완료";
    case "report_pending":
      return "보고서 저장";
    case "factcheck_draft":
      return "임시 저장";
    case "error":
      return "오류";
    case "processing":
      return libraryStatusLabel(video.status);
    default:
      return "임시 저장";
  }
}

export function libraryStatusLabel(status: PipelineStatus): string {
  switch (status) {
    case "ready":
      return "완료";
    case "awaiting_factcheck":
      return "임시 저장";
    case "queued":
      return "대기";
    case "fetching":
      return "수집 중";
    case "summarizing":
      return "요약 중";
    case "fact_checking":
      return "자동 검증";
    case "error":
      return "오류";
    default:
      return status;
  }
}
