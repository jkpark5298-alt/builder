import type { FactCheckResult, SummaryItem, VideoRecord } from "./types";

/** Client-safe copy of fact-check progress helpers (no Node APIs). */
export function requiredFactCheckItems(items: SummaryItem[]): SummaryItem[] {
  return items.filter((i) => i.needsFactCheck);
}

export function isItemChecked(
  itemId: string,
  factChecks: FactCheckResult[]
): boolean {
  const fc = factChecks.find((f) => f.itemId === itemId);
  if (!fc) return false;
  const answer = fc.explanation.trim();
  // AI 질문(프롬프트)만 있고 답변이 없으면 미완료
  if (answer.length < 20) return false;
  if (/^다음 주장을/.test(answer) && /팩트체크해 주세요/.test(answer)) {
    return false;
  }
  return fc.verdict !== "pending";
}

export function factCheckProgress(video: Pick<VideoRecord, "items" | "factChecks">) {
  const required = requiredFactCheckItems(video.items);
  const done = required.filter((i) => isItemChecked(i.id, video.factChecks));
  return {
    required,
    doneCount: done.length,
    total: required.length,
    complete: required.length > 0 ? done.length === required.length : true,
    remainingIds: required
      .filter((i) => !isItemChecked(i.id, video.factChecks))
      .map((i) => i.id),
  };
}

export function canExportArtifacts(video: VideoRecord): boolean {
  // PDF·공유는 보고서만 있으면 가능. 인포그래픽은 없어도 재생성 가능.
  return video.status === "ready" && Boolean(video.report);
}

export function hasInfographic(video: VideoRecord): boolean {
  return Boolean(
    video.infographic?.svgUrl || video.infographic?.svgMarkup?.trim()
  );
}
