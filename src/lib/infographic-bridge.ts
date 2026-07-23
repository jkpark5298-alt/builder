import type { VideoRecord } from "./types";
import { normalizeImageUrls } from "./image-urls";

function isYoutubeThumb(url?: string | null): boolean {
  if (!url) return false;
  return /i\.ytimg\.com|ytimg\.com\/vi\//i.test(url);
}

/** 인포그래픽 「관련 이미지」 후보 — 보고서 섹션·FC에서 수집 (클라이언트 안전) */
export function collectInfographicBridgeImages(
  video: Pick<VideoRecord, "report" | "factChecks">,
  max = 6
): string[] {
  const report = video.report;
  const fcMap = new Map(video.factChecks.map((f) => [f.itemId, f]));
  const out: string[] = [];
  const seen = new Set<string>();

  const push = (u?: string | null) => {
    if (!u || isYoutubeThumb(u) || seen.has(u)) return;
    seen.add(u);
    out.push(u);
  };

  for (const s of report?.sections ?? []) {
    if (s.heading === "추가 검증" || s.heading === "검증 상세") continue;
    push(s.imageUrl);
    for (const u of s.images ?? []) push(u);
    for (const e of s.entries ?? []) {
      for (const u of normalizeImageUrls(e.answerImageUrl, e.answerImageUrls)) {
        push(u);
      }
      for (const p of e.answerParts ?? []) {
        for (const uu of p.imageUrls ?? []) push(uu);
      }
      if (e.itemId) {
        const fc = fcMap.get(e.itemId);
        if (fc) {
          for (const u of normalizeImageUrls(
            fc.answerImageUrl,
            fc.answerImageUrls
          )) {
            push(u);
          }
          for (const p of fc.answerParts ?? []) {
            for (const uu of p.imageUrls ?? []) push(uu);
          }
        }
      }
    }
    if (out.length >= max) break;
  }

  return out.slice(0, max);
}

/** 실제 인포에 쓸 관련 이미지 URL (수동 지정 우선) */
export function resolveInfographicBridgeImages(
  video: Pick<
    VideoRecord,
    "report" | "factChecks" | "infographicBridgeImages"
  >,
  max = 6
): string[] {
  const custom = video.infographicBridgeImages;
  if (Array.isArray(custom)) {
    return custom
      .filter((u): u is string => Boolean(u?.trim()) && !isYoutubeThumb(u))
      .slice(0, max);
  }
  return collectInfographicBridgeImages(video, max);
}
