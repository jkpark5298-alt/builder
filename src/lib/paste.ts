/** 붙여넣기 텍스트 정규화 (아이폰 보이지 않는 문자 제거, 줄바꿈 유지) */
export function normalizePastedText(text: string): string {
  return text.replace(/[\u200B-\u200D\uFEFF\u00A0]/g, " ").trim();
}

export function hasUsablePastedScript(text?: string): boolean {
  return normalizePastedText(text ?? "").length > 80;
}

const CJK_TAIL = /[\u3000-\u9fff\uac00-\ud7af\uf900-\ufaff]$/;
const CJK_HEAD = /^[\u3000-\u9fff\uac00-\ud7af\uf900-\ufaff]/;
const SENTENCE_END = /[.。!！?？…」』”"'”)\]】]$/;
const LIST_OR_HEADING =
  /^(?:[-*•▪◦\u2022\uF0B7]\s+|\d+[.)]\s+|#{1,6}\s+|■\s+|제\s*\d+\s*장)/;

/**
 * PDF·Word·웹에서 문장 중간에 들어간 소프트 줄바꿈을 이어 붙입니다.
 * 빈 줄(문단)과 목록·제목 줄은 유지합니다.
 */
export function unwrapSoftLineBreaks(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.includes("\n")) return normalized;

  return normalized
    .split(/\n{2,}/)
    .map((para) => {
      const lines = para.split("\n").map((l) => l.replace(/[ \t]+$/g, ""));
      let out = "";
      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        if (!out) {
          out = line;
          continue;
        }
        if (LIST_OR_HEADING.test(line)) {
          out = `${out}\n${line}`;
          continue;
        }
        const prevEndsSentence = SENTENCE_END.test(out);
        const prevIsList = LIST_OR_HEADING.test(out.split("\n").at(-1) || "");
        // 목록 한 줄이 짧게 끝나면 다음 줄을 같은 항목으로 이어 붙임
        if (prevIsList && !prevEndsSentence && out.split("\n").at(-1)!.length < 120) {
          const prevLine = out.split("\n").at(-1)!;
          const join =
            CJK_TAIL.test(prevLine) && CJK_HEAD.test(line) ? "" : " ";
          const parts = out.split("\n");
          parts[parts.length - 1] = `${prevLine}${join}${line}`;
          out = parts.join("\n");
          continue;
        }
        if (!prevEndsSentence && CJK_TAIL.test(out) && CJK_HEAD.test(line)) {
          out = `${out}${line}`;
          continue;
        }
        if (!prevEndsSentence) {
          out = `${out} ${line}`;
          continue;
        }
        // 문장 끝 다음 줄 → 같은 문단 안 공백으로 이음 (문단 분리는 빈 줄만)
        out = `${out} ${line}`;
      }
      return out;
    })
    .filter(Boolean)
    .join("\n\n");
}
