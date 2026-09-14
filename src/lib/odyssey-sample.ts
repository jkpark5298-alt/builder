import snapshot from "@/data/odyssey-sample.json";
import type { VideoRecord } from "./types";

export const ODYSSEY_VIDEO_ID = "709b4400-460d-48e0-8e29-5c049c437c99";
export const ODYSSEY_PROD_ORIGIN = "https://builder-zeta-eight.vercel.app";

/** 로컬 DB·배포 API에 의존하지 않는 오딧세이 샘플 (이미지는 배포 미디어 URL) */
export function getOdysseySampleVideo(): VideoRecord {
  return snapshot as unknown as VideoRecord;
}

/** 완료 후속(공유·PDF·인포)을 샘플에서 보여 주기 위한 화면용 복제 — DB에 쓰지 않음 */
export function withReadyPreview(video: VideoRecord): VideoRecord {
  return { ...video, status: "ready" };
}
