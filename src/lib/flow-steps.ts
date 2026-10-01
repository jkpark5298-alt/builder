/** 전 화면 공통 절차 번호 (홈 → 요약 → 보고서) */
export const FLOW = {
  url: { n: 1, short: "유튜브 주소" },
  fetchScript: { n: 2, short: "자막 가져오기" },
  copyScript: { n: 3, short: "자막 복사" },
  openSummary: { n: 4, short: "수동 요약" },
  pasteSummary: { n: 5, short: "요약 붙여넣기" },
  tidySummary: { n: 6, short: "AI 답변 정리" },
  saveSummary: { n: 7, short: "요약 저장" },
  copySummary: { n: 8, short: "요약 복사 → 보고서 AI" },
  pasteReport: { n: 9, short: "보고서 붙여넣기" },
  confirmReport: { n: 10, short: "보고서 확정" },
} as const;

export function flowLabel(
  key: keyof typeof FLOW,
  extra?: string
): string {
  const s = FLOW[key];
  return extra ? `${s.n}. ${extra}` : `${s.n}. ${s.short}`;
}

/** 화면에 보이는 유튜브 큰 단계. 1–10은 안내 번호로만 씁니다. */
export const YOUTUBE_STAGES = [
  { id: "script", n: 1, short: "자막" },
  { id: "summary", n: 2, short: "수동 요약" },
  { id: "report", n: 3, short: "보고서" },
] as const;

export type YoutubeStageId = (typeof YOUTUBE_STAGES)[number]["id"];

/** 정보 보관소 절차. 유튜브 1–10과는 따로 둡니다. */
export const ARCHIVE_FLOW = [
  { n: 1, id: "input", short: "입력" },
  { n: 2, id: "instagram", short: "인스타 주소" },
  { n: 3, id: "meta", short: "메타 보기" },
  { n: 4, id: "save", short: "임시 저장" },
  { n: 5, id: "report", short: "보고서" },
  { n: 6, id: "paste", short: "AI 붙여넣기" },
  { n: 7, id: "edit", short: "수정" },
  { n: 8, id: "image", short: "이미지" },
  { n: 9, id: "confirm", short: "완료" },
  { n: 10, id: "done", short: "조회·공유" },
] as const;

export type ArchiveStepId = (typeof ARCHIVE_FLOW)[number]["id"];

export function archiveFlowLabel(id: ArchiveStepId): string {
  const step = ARCHIVE_FLOW.find((s) => s.id === id)!;
  return `${step.n}. ${step.short}`;
}

/** Gemini API 자동 요약 → 요약 붙여넣기 칸으로 넘길 때 */
export const PENDING_OVERVIEW_KEY = "yfc-pending-overview";
