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
    mixed: "일부 사실",
    mostly_false: "대체로 거짓",
    false: "거짓",
    unverifiable: "검증 불가",
    pending: "대기",
  };
  const ok = v === "true" || v === "mostly_true" || v === "mixed";
  const fail = isFailedVerdict(v);
  return {
    label: map[v] ?? v,
    mark: fail ? "✗" : ok ? "✓" : "?",
    ok: !fail,
  };
}
