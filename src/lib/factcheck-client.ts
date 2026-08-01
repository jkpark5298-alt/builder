import { htmlToPlainText } from "./text-format";
import type { FactCheckResult, SummaryItem, VideoRecord } from "./types";

/** Client-safe copy of fact-check progress helpers (no Node APIs). */
export function requiredFactCheckItems(items: SummaryItem[]): SummaryItem[] {
  return items.filter((i) => i.needsFactCheck);
}

/** 보고서 만들기 필수 게이트에 포함되는 항목 */
export function gatedFactCheckItems(items: SummaryItem[]): SummaryItem[] {
  return items.filter((i) => i.needsFactCheck && !i.factCheckOptional);
}

export function isItemChecked(
  itemId: string,
  factChecks: FactCheckResult[]
): boolean {
  const fc = factChecks.find((f) => f.itemId === itemId);
  if (!fc) return false;
  const answer = htmlToPlainText(fc.explanation).trim();
  // AI 질문(프롬프트)만 있고 답변이 없으면 미완료
  if (answer.length < 20) return false;
  if (/^다음 주장을/.test(answer) && /팩트체크해 주세요/.test(answer)) {
    return false;
  }
  return fc.verdict !== "pending";
}

export function factCheckProgress(video: Pick<VideoRecord, "items" | "factChecks">) {
  const required = requiredFactCheckItems(video.items);
  const gated = gatedFactCheckItems(video.items);
  /** 전부 선택 항목이면 최소 1건 완료를 게이트로 */
  const gateItems = gated.length > 0 ? gated : required;
  const done = required.filter((i) => isItemChecked(i.id, video.factChecks));
  const gatedDone = gateItems.filter((i) =>
    isItemChecked(i.id, video.factChecks)
  );
  const complete =
    required.length > 0 ? done.length === required.length : true;
  const gateComplete =
    gateItems.length > 0 ? gatedDone.length === gateItems.length : complete;
  return {
    required,
    gated,
    gateItems,
    doneCount: done.length,
    total: required.length,
    gateDoneCount: gatedDone.length,
    gateTotal: gateItems.length,
    optionalCount: required.filter((i) => i.factCheckOptional).length,
    complete,
    gateComplete,
    canFinalizePartial: done.length >= 1 && !gateComplete,
    remainingIds: required
      .filter((i) => !isItemChecked(i.id, video.factChecks))
      .map((i) => i.id),
    remainingGatedIds: gateItems
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
