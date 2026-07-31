import type { VideoRecord } from "./types";

/** 역사 팩트체크 전용 흐름: 요약→FC→초안→재수정→확정→번호 이미지 */
export function isHistoryFactCheckFlow(
  video: Pick<VideoRecord, "reportType">
): boolean {
  return video.reportType === "H";
}
