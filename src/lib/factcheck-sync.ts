import { syncFactChecksIntoExistingReport } from "./report-write";
import type { PipelineStatus, VideoRecord } from "./types";

/**
 * 증분 FC 수정(답변·이미지·항목 편집·DETAIL 삭제 등) 후 상태.
 * 완료(ready)는 reopenAsDraft 없이 절대 내리지 않는다.
 */
export function statusAfterIncrementalFactEdit(
  status: PipelineStatus
): PipelineStatus {
  if (status === "ready") return "ready";
  if (status === "error" || status === "report_input_draft") return status;
  return "awaiting_factcheck";
}

/** report가 있으면 video.factChecks·items를 report entries/부록에 반영 */
export function withFactCheckMirrorsSynced(video: VideoRecord): VideoRecord {
  if (!video.report) return video;
  return {
    ...video,
    report: syncFactChecksIntoExistingReport(video.report, video),
  };
}

/**
 * FC 관련 PATCH 공통 마무리:
 * - ready 유지(또는 awaiting으로만 정리)
 * - 보고서 미러 동기화
 */
export function afterIncrementalFactEdit(video: VideoRecord): VideoRecord {
  const status = statusAfterIncrementalFactEdit(video.status);
  const next = status === video.status ? video : { ...video, status };
  return withFactCheckMirrorsSynced(next);
}
