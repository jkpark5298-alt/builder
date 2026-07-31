import { v4 as uuid } from "uuid";
import type { FactCheckVerdict, SummaryItem } from "./types";
import { buildFactCheckPrompt, normalizeAiAnswer } from "./text-format";
import { verdictLabel } from "./labels";

export type BulkPasteEntry = {
  itemId: string;
  index: number;
  statement: string;
  explanation: string;
  verdict: FactCheckVerdict;
  /** 붙여넣기에서 새로 만든 항목이면 true */
  isNew?: boolean;
};

export type BulkPasteParseResult = {
  entries: BulkPasteEntry[];
  unmatchedIndexes: number[];
  notice: string;
  /** 붙여넣기에서 인식한 주장 블록 (항목 수와 다를 수 있음) */
  claimCount: number;
};

export type ParsedClaimBlock = {
  index: number;
  statement: string;
  verdict: FactCheckVerdict;
  evidence: string;
};

const VERDICT_PATTERNS: Array<{ re: RegExp; verdict: FactCheckVerdict }> = [
  {
    re: /대체로\s*사실|mostly\s*true|일부\s*사실|부분\s*사실|\bmixed\b/i,
    verdict: "mostly_true",
  },
  { re: /대체로\s*거짓|mostly\s*false/i, verdict: "false" },
  { re: /검증\s*불가|확인\s*불가|unverifiable/i, verdict: "unverifiable" },
  { re: /사실|\btrue\b/i, verdict: "true" },
  { re: /거짓|\bfalse\b/i, verdict: "false" },
];

/** 외부 AI에 붙여넣을 통합 프롬프트 — 간편 번호 형식 */
export function buildBulkFactCheckPrompt(items: SummaryItem[]): string {
  const targets = items.filter((i) => i.needsFactCheck);
  const lines: string[] = [
    `아래 ${targets.length}개 주장을 각각 팩트체크해 주세요.`,
    "",
    "항목마다 아래 형식으로만 답하세요 (** 표시 없이, 퍼센트·기호 없이):",
    "",
    "1. (주장 한 문장)",
    "판정: 사실|대체로 사실|거짓|검증 불가",
    "근거(출처): …",
    "",
    "2. (다음 주장)",
    "판정: …",
    "근거(출처): …",
    "",
    "--- 검증 대상 ---",
  ];

  targets.forEach((item, i) => {
    lines.push("");
    lines.push(`${i + 1}. ${item.statement}`);
    if (item.detail?.trim()) {
      lines.push(`(검증 포인트: ${item.detail.trim()})`);
    } else {
      lines.push(buildFactCheckPrompt(item.statement, item.detail));
    }
  });

  return lines.join("\n");
}

export function parseVerdictToken(raw: string): FactCheckVerdict | null {
  const t = raw.replace(/\s+/g, " ").trim();
  if (!t) return null;
  for (const { re, verdict } of VERDICT_PATTERNS) {
    if (re.test(t)) return verdict;
  }
  return null;
}

function stripVerdictNoise(text: string): string {
  return text
    .replace(/\*+/g, "")
    .replace(/\(\s*\d+\s*[-–~]?\s*\d*\s*%?\s*\)/g, "")
    .replace(/\d+\s*[-–~]\s*\d+\s*%/g, "")
    .replace(/\d+\s*%/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 블록/한 줄에서 판정 추출 */
export function extractVerdictFromBlock(block: string): {
  verdict: FactCheckVerdict;
  body: string;
} {
  let verdict: FactCheckVerdict = "unverifiable";
  let working = block;

  const patterns = [
    /\(?\s*판정\s*[:：]?\s*([^)\n]+?)(?:\)|$)/i,
    /(?:^|\s)판정\s*[:：]?\s*([^\n]+)/i,
    /(?:^|\s)0?\s*판정\s*[:：]?\s*([^\n]+)/i,
  ];

  for (const re of patterns) {
    const m = working.match(re);
    if (!m) continue;
    const parsed = parseVerdictToken(stripVerdictNoise(m[1]));
    if (parsed) {
      verdict = parsed;
      working = working.replace(m[0], " ").trim();
      break;
    }
  }

  // 줄 끝 판정: …이다.거짓(69%)  /  …기원이다.(판정: 사실(100%)
  if (verdict === "unverifiable") {
    const lineList = working.split(/\r?\n/);
    for (let i = 0; i < lineList.length; i++) {
      const line = lineList[i];
      const end = line.match(
        /[.。)]?\s*(대체로\s*사실|대체로\s*거짓|검증\s*불가|사실|거짓)\s*(?:\([^)]*\))?\s*$/i
      );
      if (!end) continue;
      // '사실'이 문장 중간에 있으면 오탐 → 줄 길이 대비 판정 위치가 뒤쪽일 때만
      if ((end.index ?? 0) < Math.max(0, line.length - 28) && !/[.。)]\s*$/.test(line.slice(0, end.index))) {
        // allow if immediately after punctuation
        const before = line.slice(0, end.index ?? 0);
        if (!/[.。)）]\s*$/.test(before) && before.length > 20) continue;
      }
      const parsed = parseVerdictToken(end[1]);
      if (parsed) {
        verdict = parsed;
        lineList[i] = line.slice(0, end.index).replace(/[(\s]+$/, "").trim();
        working = lineList.join("\n").trim();
        break;
      }
    }
  }

  const lines = working.split(/\r?\n/);
  const kept: string[] = [];
  for (const line of lines) {
    const m = line.match(/^\s*(?:판정|결론|결과|verdict)\s*[:：\-–]?\s*(.+)\s*$/i);
    if (m) {
      const parsed = parseVerdictToken(stripVerdictNoise(m[1]));
      if (parsed) {
        verdict = parsed;
        continue;
      }
    }
    if (kept.length === 0) {
      const alone = parseVerdictToken(stripVerdictNoise(line));
      if (alone && stripVerdictNoise(line).length <= 24) {
        verdict = alone;
        continue;
      }
    }
    kept.push(line);
  }

  return { verdict, body: kept.join("\n").trim() };
}

function splitMarkedBlocks(text: string): Map<number, string> {
  const map = new Map<number, string>();
  const re =
    /(?:^|\n)\s*(?:={2,}\s*항목\s*(\d+)\s*={2,}|\[\s*항목\s*(\d+)\s*\])\s*(?:\n|$)/gi;
  const matches = [...text.matchAll(re)];
  if (!matches.length) return map;

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const idx = parseInt(m[1] || m[2], 10);
    const start = (m.index ?? 0) + m[0].length;
    const end =
      i + 1 < matches.length ? (matches[i + 1].index ?? text.length) : text.length;
    const body = text.slice(start, end).trim();
    if (idx >= 1) map.set(idx, body);
  }
  return map;
}

/** 1. / 1) 주장 단위 분리 — `1.주장`처럼 점 뒤 공백 없어도 인식 */
function splitNumberedBlocks(text: string): Map<number, string> {
  const map = new Map<number, string>();
  const re =
    /(?:^|\n)\s*(?:#{1,3}\s*)?(?:항목\s*)?(\d+)\s*[.、)．:：\-–]\s*/g;
  const matches = [...text.matchAll(re)];
  if (!matches.length) return map;

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const idx = parseInt(m[1], 10);
    const contentStart = (m.index ?? 0) + m[0].length;
    const end =
      i + 1 < matches.length ? (matches[i + 1].index ?? text.length) : text.length;
    const body = text.slice(contentStart, end).trim();
    if (idx >= 1 && body.length >= 6) map.set(idx, body);
  }
  return map;
}

function splitStatementAndEvidence(body: string): {
  statement: string;
  evidence: string;
} {
  const lines = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return { statement: "", evidence: "" };

  const evidenceIdx = lines.findIndex((l) =>
    /^(?:[-*•]?\s*)?(?:근거|출처|내용)\s*[:：)]?/i.test(l)
  );

  if (evidenceIdx >= 0) {
    const statement = lines.slice(0, evidenceIdx).join(" ").trim();
    const evidence = lines
      .slice(evidenceIdx)
      .map((l) =>
        l
          .replace(/^(?:[-*•]?\s*)?(?:근거|출처|내용)\s*[:：)]?\s*/i, "")
          .trim()
      )
      .filter(Boolean)
      .join("\n");
    return {
      statement: statement || lines[0],
      evidence: evidence || lines.slice(evidenceIdx).join("\n"),
    };
  }

  // 첫 줄=주장, 나머지=근거
  if (lines.length >= 2) {
    return {
      statement: lines[0],
      evidence: lines.slice(1).join("\n"),
    };
  }

  return { statement: lines[0], evidence: lines[0] };
}

/** 붙여넣기 텍스트 → 주장 블록 배열 */
export function parseClaimBlocks(text: string): ParsedClaimBlock[] {
  const cleaned = text.replace(/\u200B|\uFEFF/g, "").trim();
  if (!cleaned) return [];

  const marked = splitMarkedBlocks(cleaned);
  const source =
    marked.size >= 1 ? marked : splitNumberedBlocks(cleaned);

  if (source.size === 0) {
    const { verdict, body } = extractVerdictFromBlock(cleaned);
    const { statement, evidence } = splitStatementAndEvidence(body || cleaned);
    if ((evidence || statement).trim().length < 12) return [];
    return [
      {
        index: 1,
        statement: statement || "붙여넣은 주장",
        verdict,
        evidence: normalizeAiAnswer(evidence || statement),
      },
    ];
  }

  const blocks: ParsedClaimBlock[] = [];
  const indexes = [...source.keys()].sort((a, b) => a - b);
  for (const index of indexes) {
    const raw = source.get(index)!;
    const { verdict, body } = extractVerdictFromBlock(raw);
    const { statement, evidence } = splitStatementAndEvidence(body || raw);
    const expl = normalizeAiAnswer(evidence || statement);
    if (expl.trim().length < 12 && statement.trim().length < 12) continue;
    blocks.push({
      index,
      statement: statement.replace(/^내용\s*[:：]?\s*/i, "").trim() || `항목 ${index}`,
      verdict,
      evidence: expl.length >= 12 ? expl : normalizeAiAnswer(statement),
    });
  }
  return blocks;
}

/**
 * 외부 AI 답변 → 항목별 매칭.
 * 붙여넣기 번호(1·2·3)가 기존 항목보다 많으면 새 itemId를 만들어 둠 (서버에서 생성).
 */
export function parseBulkFactCheckPaste(
  text: string,
  items: SummaryItem[]
): BulkPasteParseResult {
  const targets = items.filter((i) => i.needsFactCheck);
  const cleaned = text.replace(/\u200B|\uFEFF/g, "").trim();
  if (!cleaned) {
    return {
      entries: [],
      unmatchedIndexes: targets.map((_, i) => i + 1),
      notice: "붙여넣은 내용이 비어 있습니다.",
      claimCount: 0,
    };
  }

  const claims = parseClaimBlocks(cleaned);
  if (!claims.length) {
    return {
      entries: [],
      unmatchedIndexes: targets.map((_, i) => i + 1),
      notice:
        "형식을 인식하지 못했습니다. 예: 1. 주장… / 판정: 사실 / 근거(출처): …",
      claimCount: 0,
    };
  }

  const entries: BulkPasteEntry[] = [];
  const unmatchedIndexes: number[] = [];

  claims.forEach((claim, i) => {
    const existing = targets[i];
    let explanation = claim.evidence.trim();
    if (explanation.length < 12) {
      explanation = (claim.statement || "").trim();
    }
    if (explanation.length < 8) {
      unmatchedIndexes.push(claim.index);
      return;
    }
    entries.push({
      itemId: existing?.id ?? `new-${uuid()}`,
      index: claim.index,
      statement: claim.statement,
      explanation,
      verdict: claim.verdict,
      isNew: !existing,
    });
  });

  // 기존 항목 중 붙여넣기에 없는 번호
  for (let i = claims.length; i < targets.length; i++) {
    unmatchedIndexes.push(i + 1);
  }

  const matched = entries.length;
  let notice = `주장 ${claims.length}건 인식 · ${matched}건 적용 가능`;
  if (entries.some((e) => e.isNew)) {
    notice += ` · 새 항목 ${entries.filter((e) => e.isNew).length}건 추가`;
  }
  if (unmatchedIndexes.length && unmatchedIndexes.some((n) => n > claims.length)) {
    notice += ` · 기존 미매칭 ${unmatchedIndexes.filter((n) => n > claims.length).join(", ")}`;
  }

  return {
    entries,
    unmatchedIndexes,
    notice,
    claimCount: claims.length,
  };
}

/**
 * 붙여넣기 인식: 원문이 안 되면 정리 후 재시도.
 */
export function parseBulkFactCheckPasteRobust(
  text: string,
  items: SummaryItem[]
): BulkPasteParseResult & { normalizedText?: string } {
  const direct = parseBulkFactCheckPaste(text, items);
  if (direct.entries.length > 0) return direct;

  const normalizedText = normalizeAiFactCheckPaste(text);
  if (!normalizedText || normalizedText === text.trim()) {
    return direct;
  }
  const second = parseBulkFactCheckPaste(normalizedText, items);
  if (second.entries.length > 0) {
    return {
      ...second,
      notice: `${second.notice} (AI 답변 정리 후 인식)`,
      normalizedText,
    };
  }
  return { ...direct, normalizedText };
}

export function formatBulkParsePreview(entries: BulkPasteEntry[]): string {
  return entries
    .map((e) => {
      const label = verdictLabel(e.verdict);
      const claim = e.statement.replace(/\s+/g, " ").slice(0, 48);
      const preview = e.explanation.replace(/\s+/g, " ").slice(0, 60);
      return `${e.index}. [${label}] ${claim}${e.statement.length > 48 ? "…" : ""}\n   └ ${preview}${e.explanation.length > 60 ? "…" : ""}`;
    })
    .join("\n");
}

/** 저장된 항목·FC로 외부 AI 답변란 복원용 텍스트 생성 */
export function rebuildPasteDraftFromItems(
  items: SummaryItem[],
  factChecks: { itemId: string; verdict: string; explanation: string }[]
): string {
  const targets = items.filter((i) => i.needsFactCheck);
  const fcMap = new Map(factChecks.map((f) => [f.itemId, f]));
  const lines: string[] = [];
  targets.forEach((item, i) => {
    const fc = fcMap.get(item.id);
    const verd =
      fc && fc.verdict !== "pending"
        ? verdictLabel(fc.verdict as Parameters<typeof verdictLabel>[0])
        : "";
    const expl =
      fc?.explanation &&
      !/^다음 주장을/.test(fc.explanation) &&
      fc.explanation.trim().length >= 12
        ? fc.explanation.trim()
        : "";
    if (!verd && !expl) return;
    const head = verd
      ? `${i + 1}. ${item.statement} (판정: ${verd})`
      : `${i + 1}. ${item.statement}`;
    lines.push(expl ? `${head}\n- 근거(출처): ${expl}` : head);
  });
  return lines.join("\n\n").trim();
}

/**
 * AI가 마크다운·라벨로 복잡하게 준 답변을 간편 형식으로 정리.
 * 예) **1.** / * **A -> Fact check 대상…** / **2. 판정:** / **3. 근거:**
 *  → 1. 주장… (판정: 사실(100%))\n- 근거(출처): …
 */
export function normalizeAiFactCheckPaste(raw: string): string {
  let t = raw.replace(/\u200B|\uFEFF/g, "").replace(/\r\n/g, "\n").trim();
  if (!t) return "";

  // 마크다운 굵게·이탤릭 제거 (내용은 유지)
  t = t.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1");
  // 줄 머리 불릿
  t = t.replace(/^[ \t]*[-*•]+\s+/gm, "");
  // "A -> Fact check 대상 구분(내용):" 등 라벨 정규화
  t = t.replace(
    /(?:[A-Za-z]\s*->\s*)?(?:Fact\s*check\s*)?(?:대상\s*)?(?:구분\s*)?[（(]?\s*내용\s*[）)]?\s*[:：]/gi,
    "내용: "
  );
  t = t.replace(
    /(?:^|\n)\s*(?:\d+\.\s*)?판정\s*[:：]/gi,
    "\n판정: "
  );
  t = t.replace(
    /(?:^|\n)\s*(?:\d+\.\s*)?근거\s*(?:[（(]?출처[）)]?)?\s*[:：]/gi,
    "\n근거(출처): "
  );
  t = t.replace(/(?:^|\n)\s*(?:\d+\.\s*)?내용\s*[:：]/gi, "\n내용: ");

  // 단독 번호 줄 **1.** / 1. 만 있는 줄 → 다음 블록 시작 마커
  t = t.replace(/(?:^|\n)\s*(\d+)\s*[.．、)]\s*(?=\n)/g, "\n@@CLAIM$1@@\n");

  // "1. 내용:" 이 한 줄에 있으면 클레임 시작으로
  t = t.replace(
    /(?:^|\n)\s*(\d+)\s*[.．、)]\s*내용\s*[:：]\s*/gi,
    "\n@@CLAIM$1@@\n내용: "
  );

  const chunks = t.split(/\n@@CLAIM(\d+)@@\n/);
  const blocks: Array<{ n: number; body: string }> = [];

  if (chunks.length === 1) {
    // 클레임 마커 없음 → 내용:/판정:/근거: 묶음으로 분할 시도
    const soft = splitByContentVerdictEvidence(t);
    if (soft.length) {
      return soft
        .map((b, i) => formatNormalizedClaim(i + 1, b.statement, b.verdictRaw, b.evidence))
        .join("\n\n");
    }
    return tidyWhitespace(t);
  }

  // split 결과: [prefix, n1, body1, n2, body2, ...]
  for (let i = 1; i < chunks.length; i += 2) {
    const n = parseInt(chunks[i], 10);
    const body = (chunks[i + 1] ?? "").trim();
    if (!body) continue;
    blocks.push({ n: Number.isFinite(n) ? n : blocks.length + 1, body });
  }

  // prefix에 내용이 있으면 1번으로
  const prefix = (chunks[0] ?? "").trim();
  if (prefix && /내용\s*:|판정\s*:|근거/i.test(prefix) && !blocks.length) {
    blocks.unshift({ n: 1, body: prefix });
  } else if (prefix && blocks.length && !/내용\s*:|판정\s*:/i.test(blocks[0].body)) {
    blocks[0] = { ...blocks[0], body: `${prefix}\n${blocks[0].body}` };
  }

  const out: string[] = [];
  blocks.forEach((b, i) => {
    const parsed = parseLabeledClaimBody(b.body);
    out.push(
      formatNormalizedClaim(
        b.n || i + 1,
        parsed.statement,
        parsed.verdictRaw,
        parsed.evidence
      )
    );
  });

  return out.filter(Boolean).join("\n\n").trim() || tidyWhitespace(raw);
}

function tidyWhitespace(s: string): string {
  return s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function parseLabeledClaimBody(body: string): {
  statement: string;
  verdictRaw: string;
  evidence: string;
} {
  let statement = "";
  let verdictRaw = "";
  let evidence = "";
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    const content = line.match(/^(?:내용|주장|대상)\s*[:：]\s*(.+)$/i);
    if (content) {
      statement = content[1].trim();
      continue;
    }
    const verd = line.match(/^판정\s*[:：]\s*(.+)$/i);
    if (verd) {
      verdictRaw = verd[1].trim();
      continue;
    }
    const ev = line.match(/^근거(?:\s*\(\s*출처\s*\))?\s*[:：]\s*(.+)$/i);
    if (ev) {
      evidence = evidence ? `${evidence}\n${ev[1].trim()}` : ev[1].trim();
      continue;
    }
    if (!statement) statement = line;
    else if (!verdictRaw && parseVerdictToken(stripVerdictNoise(line))) {
      verdictRaw = line;
    } else {
      evidence = evidence ? `${evidence}\n${line}` : line;
    }
  }

  // 주장 줄에 판정이 붙어 있는 경우
  if (statement && !verdictRaw) {
    const { verdict, body: rest } = extractVerdictFromBlock(statement);
    if (verdict !== "unverifiable") {
      verdictRaw = verdictLabel(verdict);
      statement = rest || statement;
    }
  }

  return { statement, verdictRaw, evidence };
}

function formatNormalizedClaim(
  index: number,
  statement: string,
  verdictRaw: string,
  evidence: string
): string {
  const s = statement.replace(/\s+/g, " ").trim();
  if (!s && !evidence) return "";
  const v = verdictRaw.replace(/\s+/g, " ").trim();
  const e = evidence.trim();
  const head = v
    ? `${index}. ${s} (판정: ${v})`
    : `${index}. ${s}`;
  return e ? `${head}\n- 근거(출처): ${e}` : head;
}

function splitByContentVerdictEvidence(text: string): Array<{
  statement: string;
  verdictRaw: string;
  evidence: string;
}> {
  // "내용:" 출현마다 블록
  const parts = text.split(/(?=(?:^|\n)\s*내용\s*[:：])/i).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2 && !/^내용\s*[:：]/im.test(text)) return [];
  const blocks = parts.length ? parts : [text];
  return blocks
    .map((b) => parseLabeledClaimBody(b))
    .filter((b) => b.statement || b.evidence);
}
