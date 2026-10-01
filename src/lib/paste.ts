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
      // `* **라벨:` · `● 라벨:` 은 불릿 한 줄 — 콜론에서 다시 쪼개지 않음
      const lineStart = src.lastIndexOf("\n", Math.max(0, offset - 1));
      const lineEnd = src.indexOf("\n", offset);
      const line = src.slice(
        lineStart + 1,
        lineEnd === -1 ? src.length : lineEnd
      );
      if (/[●•]/.test(line) || /\*[ \t]+\*\*/.test(line)) return full;
      if (lead === "" || lead === "\n") return `${lead}${L}: `;
      if (/[.。!！?？…]/.test(lead)) return `${lead}\n\n${L}: `;
      // 앞이 공백·기타 → 단락 시작
      return `\n\n${L}: `;
    }
  );

  return t;
}

const BULLET_LINE = /^(?:#{1,6}\s|\*[ \t]+\*\*|[●•]|\d+\.\s)/;

/** 문단 안에서 제목·불릿이 아닌 줄바꿈은 한 칸으로 이어 붙입니다. */
function joinSoftWraps(block: string): string {
  const lines = block
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return "";
  let out = lines[0];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (BULLET_LINE.test(line)) {
      out += `\n\n${line}`;
      continue;
    }
    if (/-$/.test(out) && /^[A-Za-z]/.test(line)) {
      out += line;
      continue;
    }
    out += out.endsWith(" ") ? line : ` ${line}`;
  }
  return out.replace(/[ \t]{2,}/g, " ").trim();
}

function normalizeNumberedTitle(title: string): string {
  return title
    .replace(/^#{1,6}\s*/, "")
    .replace(/^(\d+)\.(?=\S)/, "$1. ")
    .replace(/^(\d+)\s+(?=\S)/, "$1. ")
    .trim();
}

/** `* **라벨: ** 본문` → `   ● 라벨: 본문` (한 줄) */
function formatMarkerBlock(block: string): string {
  let text = block.replace(/\*\*/g, "").replace(/[ \t]{2,}/g, " ").trim();
  text = text.replace(/([A-Za-z]{2,})-[ \t]+([a-z]{2,})/g, "$1$2");
  const hashed = text.match(/^#{3,}\s*(.+)$/);
  if (hashed) return normalizeNumberedTitle(hashed[1]);
  if (/^\d+\.\s+\S/.test(text) && !/[●•]/.test(text)) {
    return normalizeNumberedTitle(text);
  }
  if (/^[●•]/.test(text) || /^\*/.test(text)) {
    let body = text.replace(/^(?:[*•●▪]\s*)+/, "").trim();
    body = body.replace(/\s*:\s*/, ": ");
    return `\u00a0\u00a0\u00a0● ${body}`;
  }
  return text;
}

/**
 * 제미나이 붙여넣기.
 * `###1. 제목` → `1. 제목`
 * `* **라벨: ** 설명` → `● 라벨: 설명` (제목과 설명을 한 줄)
 * 제목 아래에서 끊긴 줄(`한쪽` / `탑의 부재`)은 이어 붙입니다.
 */
function tidyMarkerParagraphs(raw: string): string {
  let t = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!/###|\*[ \t]+\*\*|[●•]/.test(t)) return t;

  t = t.replace(/([.。!！?？])[ \t]*-{3,}[ \t]*/g, "$1\n\n");
  t = t.replace(/^[ \t]*-{3,}[ \t]*$/gm, "");
  t = t.replace(/([^\n])[ \t]*(#{3,})/g, "$1\n\n$2");
  t = t.replace(/\n[ \t]*(#{3,})/g, "\n\n$1");
  t = t.replace(/(#{3,})[ \t]*(?=\S)/g, "$1 ");
  t = t.replace(/([^\n])[ \t]*(\*[ \t]+\*\*)/g, "$1\n\n$2");
  t = t.replace(/\n[ \t]*(\*[ \t]+\*\*)/g, "\n\n$1");

  const pieces: string[] = [];
  for (const block of t.split(/\n{2,}/)) {
    const joined = joinSoftWraps(block);
    if (!joined) continue;
    for (const part of joined.split(/\n{2,}/)) {
      const formatted = formatMarkerBlock(part);
      if (formatted) pieces.push(formatted);
    }
  }

  const sections: string[] = [];
  let group: string[] = [];
  const flush = () => {
    if (!group.length) return;
    sections.push(group.join("\n"));
    group = [];
  };
  for (const piece of pieces) {
    const isHeading = /^\d+\.\s+\S/.test(piece) && !piece.includes("●");
    const isBullet = piece.includes("●");
    if (isHeading) {
      flush();
      group = [piece];
      continue;
    }
    if (isBullet) {
      group.push(piece);
      continue;
    }
    flush();
    sections.push(piece);
  }
  flush();
  return sections.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * 번호·콜론 라벨·문단 경계를 읽기 좋게 맞춤.
 * (정리·분류 / AI 보고서 붙여넣기 공통)
 */
export function tidyReportPasteSpacing(raw: string): string {
  let t = tidyMarkerParagraphs(raw || "");
  if (!t.trim()) return "";

  // 2.바빌로니아 → 2. 바빌로니아
  t = t.replace(/(\d+)\.(?=[가-힣A-Za-z(「『“"'])/g, "$1. ");

  // 문장 끝 바로 이어진 번호 소제목 → 새 문단 (숫자 뒤 . 은 제외)
  // "삼음. 2. 바빌로니아…"
  t = t.replace(/(?<!\d)([.。!！?？…])\s*(\d+\.\s+)/g, "$1\n\n$2");

  // 한글/닫는괄호 뒤 콜론 붙여쓰기: "기준:28" → "기준: 28" (URL·줄바꿈 제외)
  t = t.replace(/([가-힣)）」』])[ \t]*:(?!\/\/)[ \t]*(?=\S)/g, "$1: ");

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

/** 번호·불릿이 있는데 줄이 거의 없거나, 한 줄이 비정상적으로 길면 재정리 */
export function shouldReflowReportText(text: string): boolean {
  const t = String(text || "").replace(/\u00a0/g, " ").trim();
  if (t.length < 40) return false;
  const hasList =
    /\d+[.)]/.test(t) ||
    /언제\s*:/.test(t) ||
    /설명\s*:/.test(t) ||
    /[-–—]\s*(언제|무엇|설명)/.test(t);
  if (!hasList) return false;
  const lines = t
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 8 && !/^<\/?[a-z]/i.test(l));
  const longest = Math.max(0, ...lines.map((l) => l.length));
  const marks = (t.match(/\d+[.)]/g) || []).length;
  const labels = (t.match(/[-–—]\s*(언제|무엇\s*다음에?|설명)\s*:/g) || [])
    .length;
  if (longest >= 80 && (marks >= 1 || labels >= 1)) return true;
  if ((marks >= 2 || labels >= 2) && lines.length < marks + labels + 3) {
    return true;
  }
  if (lines.length <= 2 && (marks >= 1 || labels >= 1)) return true;
  if (marks >= 2 && longest >= 60) return true;
  return false;
}

/**
 * 한 덩어리로 붙은 보고서 본문을 번호·불릿·라벨 기준으로 다시 나눕니다.
 * (아이폰 편집 끝내기 후 줄바꿈이 사라진 경우)
 */
export function reflowFlattenedReportText(raw: string): string {
  let t = String(raw || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ");
  if (!t.trim()) return "";

  t = t.replace(/[ \t]+/g, " ");

  // 1.사용순서 → 문단 (연도 2026.9 는 앞이 숫자라 제외)
  t = t.replace(/^(\d{1,2}\.)\s*(?=[가-힣A-Za-z(「『“"'])/gm, "$1 ");
  t = t.replace(
    /([^\d\n])(\d{1,2}\.)\s*(?=[가-힣A-Za-z(「『“"'])/g,
    "$1\n\n$2 "
  );

  // 1)에스트라 / 요약1)에스트라 → 문단
  t = t.replace(/([^\n])(\d{1,2}\))\s*/g, "$1\n\n$2 ");

  // -언제: / -무엇다음에: / -설명:  (전각·마이너스 포함)
  t = t.replace(
    /\s*[-–—−－]\s*(언제|무엇\s*다음에?|설명)\s*:/g,
    "\n\n- $1: "
  );

  // -비타민C / 비타민C-진정 처럼 붙은 일반 불릿
  t = t.replace(
    /([가-힣A-Za-z0-9.。!?！？])\s*[-–—−－]\s*(?=[가-힣A-Za-z(])/g,
    "$1\n\n- "
  );

  // ·톤/탄력 불릿
  t = t.replace(/\s*·\s*/g, "\n· ");

  // 문장 끝 바로 이어진 번호·단계
  t = t.replace(/([.。!?！？])\s*(?=\d{1,2}[.)])/g, "$1\n\n");
  t = t.replace(/([.。!?！？])\s*(?=\d+\s*단계)/g, "$1\n\n");
  t = t.replace(/([.。!?！？가-힣])\s*(?=(?:아침|저녁)\s*루틴)/g, "$1\n\n");

  // `2. 짧은제목 아침 루틴 … (차단제) 저녁 루틴`
  t = t.replace(/^(\d+[.)]\s+[^\n]{4,40}?)\s+(아침\s)/gm, "$1\n\n$2");
  t = t.replace(/(\))\s+(저녁\s)/g, "$1\n\n$2");

  t = tidyReportPasteSpacing(t);

  const lines = t
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const blocks: string[] = [];
  for (const line of lines) {
    const isItem = /^(?:\d+[.)]|[-–—−－•·])/.test(line);
    if (isItem && blocks.length) blocks.push("");
    blocks.push(line);
  }
  return blocks.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
