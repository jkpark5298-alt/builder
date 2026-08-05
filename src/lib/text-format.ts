import { unwrapSoftLineBreaks } from "./paste";

/** HTML 답변 → 평문 (길이·번호 분할·저장 게이트용) */
export function htmlToPlainText(html: string): string {
  if (!html) return "";
  if (!/<[a-z][\s\S]*>/i.test(html)) return html;
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 평문/HTML → TipTap 초기 HTML */
export function toAnswerEditorHtml(raw: string): string {
  const t = (raw || "").trim();
  if (!t) return "<p></p>";
  if (/<[a-z][\s\S]*>/i.test(t)) {
    if (/^<p[\s>]/i.test(t)) return t;
    return `<p>${t}</p>`;
  }
  return t
    .split(/\n{2,}/)
    .map((block) => {
      const esc = block
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\n/g, "<br>");
      return `<p>${esc || "<br>"}</p>`;
    })
    .join("");
}

/** AI 팩트체크 질문 — 주장·근거 중복 없이 한 문장 */
export function buildFactCheckPrompt(statement: string, detail?: string): string {
  const s = statement.replace(/\s+/g, " ").trim();
  let focus = "수치·시기·지명·인명·1차 사료와 반론";

  if (detail?.trim()) {
    const d = detail
      .replace(/^본문 근거:\s*/i, "")
      .replace(/[「」]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const dup =
      !d ||
      d === s ||
      s.includes(d.slice(0, Math.min(40, d.length))) ||
      d.includes(s.slice(0, Math.min(40, s.length)));
    if (!dup) {
      focus = d.replace(/\.\s*이 진술.*$/, "").slice(0, 120);
    }
  }

  return `다음 주장을 학술 연구·신뢰할 수 있는 기록으로 팩트체크해 주세요: 「${s}」 — ${focus}를 포함해 사실·과장·미확인을 구분하고, 출처와 함께 1. 2. 순서로 정리해 주세요. (** 표시 없이 작성)`;
}

/** AI 답변: ** 제거, 목록은 1. 2. 번호로 */
export function normalizeAiAnswer(text: string): string {
  let t = text.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*/g, "");
  const lines = t.split("\n");
  let n = 0;
  const out: string[] = [];

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) {
      out.push("");
      continue;
    }
    const bullet = trimmed.match(/^[-*•]\s+(.+)$/);
    const numbered = trimmed.match(/^(\d+)[.)]\s+(.+)$/);
    if (bullet) {
      n += 1;
      out.push(`${n}. ${bullet[1]}`);
    } else if (numbered) {
      n = Math.max(n, parseInt(numbered[1], 10));
      out.push(`${numbered[1]}. ${numbered[2]}`);
    } else {
      out.push(line);
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * FC 항목 「AI 답변 · 팩트체크 결과 입력」용 정리.
 * - 마크다운 제거 · 불릿→번호
 * - `라벨: 본문` / `라벨：본문` → 라벨과 본문을 별도 단락
 * - 판정·근거(출처) 라벨 정규화
 */
export function normalizeAiFactCheckAnswer(raw: string): string {
  let t = unwrapSoftLineBreaks(
    raw.replace(/\u200B|\uFEFF/g, "").replace(/\r\n/g, "\n").trim()
  );
  if (!t) return "";

  t = t.replace(/^```(?:markdown|md|text)?\s*\n?/i, "").replace(/\n?```$/i, "");
  t = t.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1");
  t = t.replace(/__([^_]+)__/g, "$1").replace(/_([^_]+)_/g, "$1");

  // 흔한 라벨 통일
  t = t.replace(/(?:^|\n)\s*(?:\d+\.\s*)?판정\s*[:：]/gi, "\n판정: ");
  t = t.replace(
    /(?:^|\n)\s*(?:\d+\.\s*)?근거\s*(?:[（(]?출처[）)]?)?\s*[:：]/gi,
    "\n근거(출처): "
  );
  t = t.replace(/(?:^|\n)\s*(?:\d+\.\s*)?주요\s*근거\s*[:：]/gi, "\n주요 근거: ");
  t = t.replace(/(?:^|\n)\s*(?:\d+\.\s*)?내용\s*[:：]/gi, "\n내용: ");
  t = t.replace(/(?:^|\n)\s*(?:\d+\.\s*)?결론\s*[:：]/gi, "\n결론: ");

  const lines = t.split("\n");
  const out: string[] = [];
  let n = 0;

  const pushBlank = () => {
    if (out.length && out[out.length - 1] !== "") out.push("");
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      pushBlank();
      continue;
    }

    const bullet = trimmed.match(/^[-*•▪◦]\s+(.+)$/);
    if (bullet) {
      n += 1;
      out.push(`${n}. ${bullet[1].trim()}`);
      continue;
    }

    const numbered = trimmed.match(/^(\d+)[.)]\s+(.+)$/);
    if (numbered) {
      n = Math.max(n, parseInt(numbered[1], 10));
      // 번호 줄 안에도 라벨: 본문이 있으면 분리
      const rest = numbered[2].trim();
      const labeledInNum = rest.match(
        /^(.{1,40}?)\s*[:：]\s+(.+)$/
      );
      if (labeledInNum && labeledInNum[2].trim().length >= 8) {
        out.push(`${numbered[1]}. ${labeledInNum[1].trim()}`);
        pushBlank();
        out.push(labeledInNum[2].trim());
      } else {
        out.push(`${numbered[1]}. ${rest}`);
      }
      continue;
    }

    // `라벨: 본문` → 라벨 단락 + 본문 단락 (짧은 URL성 콜론 제외)
    const labeled = trimmed.match(/^(.{1,48}?)\s*[:：]\s+(.+)$/);
    if (labeled) {
      const label = labeled[1].trim();
      const body = labeled[2].trim();
      const looksLikeTime = /^\d{1,2}$/.test(label) && /^\d/.test(body);
      const looksLikeUrl = /^https?$/i.test(label);
      if (!looksLikeTime && !looksLikeUrl && body.length >= 1) {
        if (body.length <= 24 && !/[.。!！?？]/.test(body) && !/[:：]/.test(body)) {
          out.push(`${label}: ${body}`);
        } else {
          pushBlank();
          out.push(label);
          pushBlank();
          // 본문 안 추가 라벨(: ) — 짧은 값(판정: 사실)은 한 줄, 긴 본문은 단락
          const bodyParts: string[] = [];
          let rest = body;
          const labelRe =
            /([가-힣A-Za-z0-9)）]{2,24})\s*[:：]\s+/g;
          let last = 0;
          let m: RegExpExecArray | null;
          const cuts: Array<{ start: number; label: string; valueStart: number }> =
            [];
          while ((m = labelRe.exec(rest)) !== null) {
            if (m.index > 0 || cuts.length === 0) {
              cuts.push({
                start: m.index,
                label: m[1]!,
                valueStart: m.index + m[0].length,
              });
            }
          }
          if (!cuts.length) {
            bodyParts.push(rest);
          } else {
            for (let i = 0; i < cuts.length; i++) {
              const cut = cuts[i]!;
              const before = rest.slice(last, cut.start).trim();
              if (before) bodyParts.push(before);
              const valueEnd = cuts[i + 1]?.start ?? rest.length;
              const value = rest.slice(cut.valueStart, valueEnd).trim();
              if (value.length <= 24 && !/[.。!！?？\n]/.test(value)) {
                bodyParts.push(`${cut.label}: ${value}`);
              } else {
                bodyParts.push(cut.label);
                if (value) bodyParts.push(value);
              }
              last = valueEnd;
            }
            const tail = rest.slice(last).trim();
            if (tail) bodyParts.push(tail);
          }
          for (const p of bodyParts.filter(Boolean)) {
            out.push(p);
            pushBlank();
          }
          while (out.length && out[out.length - 1] === "") out.pop();
        }
        continue;
      }
    }

    // 문장 중간 ` 단어: ` 패턴을 단락 경계로 (과도 분할 방지 — 짧은 라벨만)
    const splitMid = trimmed.replace(
      /([가-힣A-Za-z0-9)）]{2,20})\s*[:：]\s+(?=[가-힣A-Za-z「"‘(])/g,
      "$1\n\n"
    );
    if (splitMid !== trimmed) {
      for (const part of splitMid.split(/\n+/)) {
        const p = part.trim();
        if (!p) continue;
        out.push(p);
        pushBlank();
      }
      // 마지막 불필요 공백 줄 정리
      while (out.length && out[out.length - 1] === "") out.pop();
      continue;
    }

    out.push(trimmed);
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * 외부 AI가 준 마크다운 요약을 앱 요약 형식에 맞게 정리.
 * 목표 형식:
 *   1. 대주제
 *   • 소주제: 설명…
 *   최종 결론
 */
export function normalizeAiOverviewPaste(raw: string): string {
  let t = unwrapSoftLineBreaks(
    raw.replace(/\u200B|\uFEFF/g, "").replace(/\r\n/g, "\n").trim()
  );
  if (!t) return "";

  // 코드 펜스 제거
  t = t.replace(/^```(?:markdown|md|text)?\s*\n?/i, "").replace(/\n?```$/i, "");
  // 굵게·이탤릭 (내용은 유지)
  t = t.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1");
  t = t.replace(/__([^_]+)__/g, "$1").replace(/_([^_]+)_/g, "$1");

  const lines = t.split("\n");
  const out: string[] = [];
  let sectionN = 0;

  const isFluff = (s: string) =>
    /^(여기(?:서|에)?|다음은?|아래는?|요약하면|정리하면|sure[,!]?\s*|here(?:'s| is)|of course)\b/i.test(
      s
    ) ||
    (/요약입니다\.?$/.test(s) && s.length < 40) ||
    (/도움이\s*되셨|추가\s*질문|궁금한\s*점/.test(s) && s.length < 80);

  for (const rawLine of lines) {
    let s = rawLine.trim();
    if (!s) {
      if (out.length && out[out.length - 1] !== "") out.push("");
      continue;
    }

    if (isFluff(s)) continue;

    // # / ## / ### 제목 → 대주제 번호
    const mdHead = s.match(/^#{1,6}\s+(.+)$/);
    if (mdHead) {
      sectionN += 1;
      const title = mdHead[1].replace(/^\d+[.)]\s*/, "").trim();
      if (out.length && out[out.length - 1] !== "") out.push("");
      out.push(`${sectionN}. ${title}`);
      continue;
    }

    // 최종 결론 유지
    if (/^최종\s*결론/.test(s) || /^결론\s*[:：]?$/.test(s)) {
      if (out.length && out[out.length - 1] !== "") out.push("");
      out.push(s.startsWith("최종") ? s : "최종 결론");
      continue;
    }

    // 이미 1. 대주제 형 (짧은 제목줄)
    const numberedHead = s.match(/^(\d+)[.)]\s+(.+)$/);
    if (
      numberedHead &&
      numberedHead[2].length <= 80 &&
      !/[.。]$/.test(numberedHead[2]) &&
      !/:/.test(numberedHead[2].slice(0, 40))
    ) {
      sectionN = Math.max(sectionN, parseInt(numberedHead[1], 10));
      if (out.length && out[out.length - 1] !== "") out.push("");
      out.push(`${numberedHead[1]}. ${numberedHead[2].trim()}`);
      continue;
    }

    // 불릿 / • / - → 소주제
    const bullet = s.match(/^[-*•▪◦]\s+(.+)$/);
    if (bullet) {
      let body = bullet[1].trim();
      // "라벨: 설명" 유지, 없으면 그대로
      body = body.replace(/^([^:]{2,40})\s*[-–—]\s+/, "$1: ");
      out.push(`• ${body}`);
      continue;
    }

    // "소주제: 설명" 단독 줄 (콜론 앞이 짧은 라벨)
    const labeled = s.match(/^([^:]{2,40})\s*[:：]\s+(.+)$/);
    if (labeled && !/^\d+[.)]/.test(s) && labeled[2].length > 8) {
      out.push(`• ${labeled[1].trim()}: ${labeled[2].trim()}`);
      continue;
    }

    out.push(s);
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** 보고서·요약 중복 문장 제거 */
export function dedupeTexts(parts: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const key = p.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 120);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(p.trim());
  }
  return out;
}

export function isFailedVerdict(
  v: string
): v is "false" | "mostly_false" {
  return v === "false" || v === "mostly_false";
}

export function verdictBadge(v: string): { label: string; mark: string; ok: boolean } {
  const map: Record<string, string> = {
    true: "사실",
    mostly_true: "대체로 사실",
    mixed: "대체로 사실",
    mostly_false: "거짓",
    false: "거짓",
    unverifiable: "검증 불가",
    pending: "대기",
  };
  const ok = v === "true" || v === "mostly_true";
  const fail = isFailedVerdict(v);
  return {
    label: map[v] ?? v,
    mark: fail ? "✗" : ok ? "✓" : "?",
    ok: !fail,
  };
}
