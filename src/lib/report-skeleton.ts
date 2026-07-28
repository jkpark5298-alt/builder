import { buildTypedReport } from "./report";
import { buildInfographic } from "./infographic";
import { stabilizeReportFcAnchors } from "./fc-markers";
import type { TypedReport, VideoRecord } from "./types";

export const SKELETON_REPORT_NOTICE =
  "요약·팩트체크 항목으로 골격 보고서를 만들었습니다. 팩트체크를 이어가며 아래에서 미리 보거나 본문을 다듬을 수 있습니다. 팩트체크 완료 후 「보고서 만들기」를 누르면 글쓰기 AI로 본문을 다시 쓰거나, 이미 수정한 본문은 그대로 유지됩니다.";

/** 요약·FC 항목만으로 조립 보고서(골격) 생성 */
export function buildSkeletonReport(
  video: Parameters<typeof buildTypedReport>[0]
): TypedReport {
  return stabilizeReportFcAnchors(buildTypedReport(video));
}

/** report가 없으면 골격 보고서·인포그래픽을 채운다 */
export async function ensureSkeletonReport(
  video: VideoRecord
): Promise<VideoRecord> {
  if (video.report) return video;
  if (!video.overview?.trim() || video.overview.trim().length < 40) {
    return video;
  }
  const report = buildSkeletonReport(video);
  const withReport: VideoRecord = {
    ...video,
    report,
    reportSource: "assembled",
    reportWriteNotice: SKELETON_REPORT_NOTICE,
    updatedAt: new Date().toISOString(),
  };
  return {
    ...withReport,
    infographic: await buildInfographic(withReport),
  };
}

/** finalize 시 골격을 사용자가 손댔으면 본문 유지 */
export function shouldKeepReportBodyOnFinalize(video: VideoRecord): boolean {
  if (!video.report) return false;
  if (video.pendingReportFinalize === "rewrite") return false;
  if (video.pendingReportFinalize === "keep_body") return true;
  return Boolean(video.reportSkeletonEdited);
}
