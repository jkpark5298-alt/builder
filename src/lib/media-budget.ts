import type { AnswerPart, FactCheckResult, SummaryItem, VideoRecord } from "./types";

/** Neon/서버리스 요청·응답이 버틸 수 있는 대략적 JSON 문자 수 */
export const VIDEO_JSON_SOFT_LIMIT = 1_200_000;
export const VIDEO_JSON_HARD_LIMIT = 2_000_000;

function isHeavyDataUrl(url: string | undefined | null): boolean {
  return Boolean(url && url.startsWith("data:image/") && url.length > 8_000);
}

function dropHeavy(urls?: string[]): string[] | undefined {
  if (!urls?.length) return undefined;
  const kept = urls.filter((u) => u && !isHeavyDataUrl(u));
  return kept.length ? kept : undefined;
}

function slimParts(parts?: AnswerPart[]): AnswerPart[] | undefined {
  if (!parts?.length) return undefined;
  return parts.map((p) => ({
    ...p,
    imageUrls: dropHeavy(p.imageUrls) ?? [],
  }));
}

function slimFactCheck(fc: FactCheckResult, dropImages: boolean): FactCheckResult {
  if (!dropImages) return fc;
  return {
    ...fc,
    answerImageUrl: isHeavyDataUrl(fc.answerImageUrl) ? undefined : fc.answerImageUrl,
    answerImageUrls: dropHeavy(fc.answerImageUrls),
    answerParts: slimParts(fc.answerParts),
  };
}

function slimItem(item: SummaryItem, dropImages: boolean): SummaryItem {
  if (!dropImages) return item;
  return {
    ...item,
    imageUrl: isHeavyDataUrl(item.imageUrl) ? undefined : item.imageUrl,
    imageUrls: dropHeavy(item.imageUrls),
  };
}

/** 첫 장과 배열에 같은 data URL이 중복 저장되지 않도록 정리 */
function dedupeVideoImageFields(video: VideoRecord): VideoRecord {
  return {
    ...video,
    items: video.items.map((item) => {
      const urls = [
        ...(item.imageUrls ?? []),
        ...(item.imageUrl ? [item.imageUrl] : []),
      ];
      const uniq = Array.from(new Set(urls.filter(Boolean)));
      const [first, ...rest] = uniq;
      return {
        ...item,
        imageUrl: first,
        imageUrls: rest.length ? rest : undefined,
      };
    }),
    factChecks: video.factChecks.map((fc) => {
      const fromParts = (fc.answerParts ?? []).flatMap((p) => p.imageUrls ?? []);
      const urls = [
        ...fromParts,
        ...(fc.answerImageUrls ?? []),
        ...(fc.answerImageUrl ? [fc.answerImageUrl] : []),
      ];
      const uniq = Array.from(new Set(urls.filter(Boolean)));
      const [first, ...rest] = uniq;
      return {
        ...fc,
        answerImageUrl: first,
        answerImageUrls: rest.length ? rest : undefined,
        answerParts: fc.answerParts,
      };
    }),
  };
}

/** API 응답용: data URL 이미지를 빼고 텍스트·판정만 남김 (모바일 JSON 파싱 실패 방지) */
export function slimVideoForClient(video: VideoRecord): VideoRecord {
  return {
    ...video,
    items: video.items.map((i) => slimItem(i, true)),
    factChecks: video.factChecks.map((f) => slimFactCheck(f, true)),
    report: video.report
      ? {
          ...video.report,
          sections: video.report.sections.map((s) => ({
            ...s,
            entries: s.entries?.map((e) => ({
              ...e,
              imageUrl: isHeavyDataUrl(e.imageUrl) ? undefined : e.imageUrl,
              answerImageUrl: isHeavyDataUrl(e.answerImageUrl)
                ? undefined
                : e.answerImageUrl,
              answerImageUrls: dropHeavy(e.answerImageUrls),
              answerParts: slimParts(e.answerParts),
            })),
          })),
          factChecks: video.report.factChecks?.map((f) => ({
            ...f,
            answerImageUrl: isHeavyDataUrl(f.answerImageUrl)
              ? undefined
              : f.answerImageUrl,
            answerImageUrls: dropHeavy(f.answerImageUrls),
            answerParts: slimParts(f.answerParts),
          })),
        }
      : video.report,
    // 인포그래픽 SVG/HTML도 클 수 있음 — 저장 응답에서는 생략
    infographic: null,
  };
}

/**
 * DB 저장 전 용량 초과 시 무거운 data URL을 제거해 upsert가 타임아웃되지 않게 함.
 * 텍스트·판정은 유지. 반환: { video, droppedImages }
 */
export function compactVideoForStorage(video: VideoRecord): {
  video: VideoRecord;
  droppedImages: boolean;
  bytes: number;
} {
  // 저장 전에 이미지 필드 중복(첫 장 + 전체 배열)을 정리
  let next = dedupeVideoImageFields(video);
  let droppedImages = false;
  let bytes = JSON.stringify(next).length;

  if (bytes <= VIDEO_JSON_SOFT_LIMIT) {
    return { video: next, droppedImages, bytes };
  }

  // 1단계: 인포그래픽 제거
  if (next.infographic) {
    next = { ...next, infographic: null };
    droppedImages = true;
    bytes = JSON.stringify(next).length;
  }

  if (bytes <= VIDEO_JSON_SOFT_LIMIT) {
    return { video: next, droppedImages, bytes };
  }

  // 2단계: 모든 data URL 이미지 제거 (텍스트 팩트체크는 유지)
  next = {
    ...next,
    items: next.items.map((i) => slimItem(i, true)),
    factChecks: next.factChecks.map((f) => slimFactCheck(f, true)),
    report: next.report
      ? {
          ...next.report,
          sections: next.report.sections.map((s) => ({
            ...s,
            entries: s.entries?.map((e) => ({
              ...e,
              imageUrl: isHeavyDataUrl(e.imageUrl) ? undefined : e.imageUrl,
              answerImageUrl: isHeavyDataUrl(e.answerImageUrl)
                ? undefined
                : e.answerImageUrl,
              answerImageUrls: dropHeavy(e.answerImageUrls),
              answerParts: slimParts(e.answerParts),
            })),
          })),
        }
      : next.report,
  };
  droppedImages = true;
  bytes = JSON.stringify(next).length;

  return { video: next, droppedImages, bytes };
}
