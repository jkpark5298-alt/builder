/** 붙여넣기 텍스트 정규화 (아이폰 보이지 않는 문자 제거, 줄바꿈 유지) */
export function normalizePastedText(text: string): string {
  return text.replace(/[\u200B-\u200D\uFEFF\u00A0]/g, " ").trim();
}

export function hasUsablePastedScript(text?: string): boolean {
  return normalizePastedText(text ?? "").length > 80;
}
