/** 전 화면 공통 절차 번호 (홈 → 요약 → 보고서) */
export const FLOW = {
  url: { n: 1, short: "유튜브 주소" },
  fetchScript: { n: 2, short: "자막 가져오기" },
  copyScript: { n: 3, short: "자막 복사" },
  openSummary: { n: 4, short: "요약 화면으로" },
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
