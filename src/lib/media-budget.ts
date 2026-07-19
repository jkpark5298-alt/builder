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

/** 첫 장과 배열에 같은 URL이 중복 저장되지 않도록 정리 (첫 장 우선) */
function dedupeVideoImageFields(video: VideoRecord): VideoRecord {
  return {
    ...video,
    items: video.items.map((item) => {
      const urls = [
        ...(item.imageUrl ? [item.imageUrl] : []),
        ...(item.imageUrls ?? []),
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
        ...(fc.answerImageUrl ? [fc.answerImageUrl] : []),
        ...(fc.answerImageUrls ?? []),
        ...fromParts,
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

function stripInlineSvg(video: VideoRecord): VideoRecord {
  if (!video.infographic?.svgMarkup) return video;
  // 외부 URL이 있으면 인라인 SVG는 제거해 JSON을 가볍게
  if (video.infographic.svgUrl) {
    return {
      ...video,
      infographic: { ...video.infographic, svgMarkup: "" },
    };
  }
  return video;
}

/** API 응답용: 무거운 data URL만 빼고 HTTP(S)·/api/media URL은 유지 */
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
            imageUrl: isHeavyDataUrl(s.imageUrl) ? undefined : s.imageUrl,
            images: dropHeavy(s.images),
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
    // 인포그래픽: 메타·svgUrl 유지, 인라인 markup만 생략
    infographic: video.infographic
      ? {
          ...video.infographic,
          svgMarkup: "",
        }
      : null,
  };
}

/**
 * DB 저장 전 용량 초과 시 무거운 data URL을 제거해 upsert가 타임아웃되지 않게 함.
 * 외부 URL·svgUrl은 유지. 반환: { video, droppedImages }
 */
export function compactVideoForStorage(video: VideoRecord): {
  video: VideoRecord;
  droppedImages: boolean;
  bytes: number;
} {
  let next = stripInlineSvg(dedupeVideoImageFields(video));
  let droppedImages = false;
  let bytes = JSON.stringify(next).length;

  if (bytes <= VIDEO_JSON_SOFT_LIMIT) {
    return { video: next, droppedImages, bytes };
  }

  // 1단계: 인라인 SVG만 제거 (svgUrl 있으면 인포그래픽 유지)
  if (next.infographic?.svgMarkup) {
    next = {
      ...next,
      infographic: { ...next.infographic, svgMarkup: "" },
    };
    bytes = JSON.stringify(next).length;
  }

  if (bytes <= VIDEO_JSON_SOFT_LIMIT) {
    return { video: next, droppedImages, bytes };
  }

  // 2단계: 남은 data URL만 제거 (HTTP 이미지는 유지)
  next = {
    ...next,
    items: next.items.map((i) => slimItem(i, true)),
    factChecks: next.factChecks.map((f) => slimFactCheck(f, true)),
    report: next.report
      ? {
          ...next.report,
          sections: next.report.sections.map((s) => ({
            ...s,
            imageUrl: isHeavyDataUrl(s.imageUrl) ? undefined : s.imageUrl,
            images: dropHeavy(s.images),
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
