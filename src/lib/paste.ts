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
/** 1. 제목 / 2.바빌(공백 없음) / ## / 불릿 / 제 N 장 */
const LIST_OR_HEADING =
  /^(?:[-*•▪◦\u2022\uF0B7]\s+|\d+[.)](?:\s+|(?=[가-힣A-Za-z(「『“"']))|#{1,6}\s+|■\s+|제\s*\d+\s*장)/;
/** 문장 뒤 새 주제로 보이는 `라벨: 본문` 줄 */
const TOPIC_LABEL_LINE =
  /^[가-힣A-Za-z0-9()（）\[\]「」『』·\-\s]{2,40}:\s+\S/;

function isSkippableTopicLabel(label: string): boolean {
  const L = label.replace(/\s+/g, " ").trim();
  if (L.length < 2 || L.length > 40) return true;
  if (/^(https?|www)$/i.test(L)) return true;
  if (/^\d/.test(L)) return true;
  if (/^\d+\./.test(L)) return true;
  return false;
}

/**
 * `아브라함의 이동 경로:` · `지방의 초하루 관습 (엘리야 일화):` 처럼
 * 콜론 주제 라벨이 있으면 그 앞에서 단락을 나눕니다.
 */
export function splitTopicColonLabels(raw: string): string {
  let t = raw || "";
  if (!t.includes(":")) return t;

  // 본문 중간·문장 뒤 어디에 있든 `짧은한글라벨: 본문` → 새 단락
  t = t.replace(
    /(^|[.。!！?？…\n]|[ \t]+)([가-힣A-Za-z][가-힣A-Za-z0-9()（）\[\]「」『』·\-]*(?:[ \t]+[가-힣A-Za-z0-9()（）\[\]「」『』·\-]+){0,7})[ \t]*:[ \t]+(?=\S)/g,
    (full, lead: string, label: string, offset: number, src: string) => {
      const L = label.replace(/\s+/g, " ").trim();
      if (isSkippableTopicLabel(L)) return full;
      // `- 메시지:` / `• 라벨:` 불릿은 그대로 둠 (공백 lead 앞이 불릿 기호)
      if (/^[ \t]+$/.test(lead)) {
        const prev = src[offset - 1];
        if (prev && /[-*•▪◦–—\u2022\uF0B7]/.test(prev)) return full;
      }
      if (lead === "" || lead === "\n") return `${lead}${L}: `;
      if (/[.。!！?？…]/.test(lead)) return `${lead}\n\n${L}: `;
      // 앞이 공백·기타 → 단락 시작
      return `\n\n${L}: `;
    }
  );

  return t;
}

/**
 * 번호·콜론 라벨·문단 경계를 읽기 좋게 맞춤.
 * (정리·분류 / AI 보고서 붙여넣기 공통)
 */
export function tidyReportPasteSpacing(raw: string): string {
  let t = (raw || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!t.trim()) return "";

  // 2.바빌로니아 → 2. 바빌로니아
  t = t.replace(/(\d+)\.(?=[가-힣A-Za-z(「『“"'])/g, "$1. ");

  // 문장 끝 바로 이어진 번호 소제목 → 새 문단 (숫자 뒤 . 은 제외)
  // "삼음. 2. 바빌로니아…"
  t = t.replace(/(?<!\d)([.。!！?？…])\s*(\d+\.\s+)/g, "$1\n\n$2");

  // 한글/닫는괄호 뒤 콜론 붙여쓰기: "기준:28" → "기준: 28" (URL 제외)
  t = t.replace(/([가-힣)）」』])\s*:(?!\/\/)\s*(?=\S)/g, "$1: ");

  // `라벨:` 이 있으면 단락으로 인식 (문장 끝 여부와 무관)
  t = splitTopicColonLabels(t);

  // "2. 짧은제목 라벨: 본문" 이 한 줄이면 제목 / 본문 분리
  t = t
    .split("\n")
    .map((line) => {
      const m = line.match(/^(\d+)\.\s+(.+)$/);
      if (!m) return line;
      const rest = m[2];
      if (rest.length <= 48 || !/:[ \t]+\S/.test(rest)) return line;
      const colonIdx = rest.indexOf(":");
      if (colonIdx < 0) return line;
      const before = rest.slice(0, colonIdx).trimEnd();
      const after = rest.slice(colonIdx + 1).trim();
      if (!after || before.length < 12) return line;
      const words = before.split(/\s+/).filter(Boolean);
      if (words.length < 4) return line;
      // 뒤에서 2~3어절을 라벨로 (예: 나보니두스 왕의 개혁)
      for (let n = 3; n >= 2; n--) {
        if (words.length - n < 2) continue;
        const heading = words.slice(0, words.length - n).join(" ");
        const label = words.slice(words.length - n).join(" ");
        if (heading.length < 8 || heading.length > 60) continue;
        if (label.length < 4 || label.length > 28) continue;
        if (/[은는이가을를의과와]$/.test(label)) continue;
        return `${m[1]}. ${heading}\n\n${label}: ${after}`;
      }
      return line;
    })
    .join("\n");

  t = t.replace(/[ \t]{2,}/g, " ");
  t = t.replace(/[ \t]+\n/g, "\n");
  return t.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * PDF·Word·웹에서 문장 중간에 들어간 소프트 줄바꿈을 이어 붙입니다.
 * 빈 줄(문단)·목록·번호 제목·`라벨:` 주제 줄은 유지합니다.
 */
export function unwrapSoftLineBreaks(text: string): string {
  const normalized = tidyReportPasteSpacing(
    text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  );
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
          out = `${out}\n\n${line}`;
          continue;
        }
        const prevLine = out.split("\n").at(-1) || "";
        // `1. 대주제` 같은 짧은 번호 제목은 다음 줄과 이어 붙이지 않음
        const prevIsNumberedTitle =
          /^\d+[.)]\s+\S/.test(prevLine) &&
          prevLine.length <= 80 &&
          !/[.。]$/.test(prevLine) &&
          !/:/.test(prevLine.slice(0, 40));
        if (prevIsNumberedTitle) {
          out = `${out}\n\n${line}`;
          continue;
        }
        const prevEndsSentence = SENTENCE_END.test(out);
        const prevIsList = LIST_OR_HEADING.test(prevLine);
        // 목록 한 줄이 짧게 끝나면 다음 줄을 같은 항목으로 이어 붙임
        if (prevIsList && !prevEndsSentence && prevLine.length < 120) {
          const join =
            CJK_TAIL.test(prevLine) && CJK_HEAD.test(line)
              ? prevLine.length < 8 || line.length < 4
                ? ""
                : " "
              : " ";
          const parts = out.split("\n");
          parts[parts.length - 1] = `${prevLine}${join}${line}`;
          out = parts.join("\n");
          continue;
        }
        // `라벨: 본문` 줄이면 문장 끝과 무관하게 단락 분리
        if (TOPIC_LABEL_LINE.test(line)) {
          out = `${out}\n\n${line}`;
          continue;
        }
        if (!prevEndsSentence && CJK_TAIL.test(out) && CJK_HEAD.test(line)) {
          // 어미·짧은 잘림만 붙여 쓰고, 단어 단위 줄바꿈은 공백 유지
          const join = prevLine.length < 8 || line.length < 4 ? "" : " ";
          out = `${out}${join}${line}`;
          continue;
        }
        if (!prevEndsSentence) {
          out = `${out} ${line}`;
          continue;
        }
        // 문장 끝 다음 일반 줄 → 같은 문단
        out = `${out} ${line}`;
      }
      return out;
    })
    .filter(Boolean)
    .join("\n\n");
}
