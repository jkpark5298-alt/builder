import { normalizeAiFactCheckPaste } from "./bulk-factcheck-paste";
import {
  inspectImportedReportText,
  normalizeAiReportPaste,
  sanitizeAiPasteText,
} from "./report";
import {
  normalizeAiOverviewPaste,
  stripMarkdownHeadingMarkers,
} from "./text-format";

export type PasteKind =
  | "overview"
  | "factcheck"
  | "report"
  | "conclusion"
  | "mixed"
  | "unknown";

export type OrganizedPasteParts = {
  overview?: string;
  factChecks?: string;
  reportSections?: string;
  conclusion?: string;
};

export type OrganizePasteResult = {
  cleaned: string;
  kind: PasteKind;
  confidence: number;
  signals: string[];
  parts: OrganizedPasteParts;
  summary: string;
};

/** 공통: 불필요 기호·마크다운 헤딩·잡음 제거 */
export function cleanPastedText(raw: string): string {
  let t = sanitizeAiPasteText(raw);
  if (!t) return "";
  t = stripMarkdownHeadingMarkers(t);
  t = t.replace(/\*\*([^*]+)\*\*/g, "$1");
  t = t.replace(/__([^_\n]+?)__/g, "$1");
  // 단독 *** --- ___ 구분선
  t = t.replace(/^[ \t]*[-*_]{3,}[ \t]*$/gm, "");
  t = t.replace(/^```(?:markdown|md|text)?\s*$/gim, "").replace(/^```\s*$/gm, "");
  return t.replace(/\n{3,}/g, "\n\n").trim();
}

function countMatches(text: string, re: RegExp): number {
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  return [...text.matchAll(new RegExp(re.source, flags))].length;
}

function splitLabeledBlocks(text: string): OrganizedPasteParts {
  const parts: OrganizedPasteParts = {};
  // ## 요약 / ## 팩트체크 / ## 보고서 형태 (복사 포맷)
  const re =
    /^##[ \t]+(요약|팩트체크|보고서|본문|결론|최종\s*결론)\s*$/gim;
  const indices: Array<{ key: keyof OrganizedPasteParts; start: number; headEnd: number }> =
    [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const label = m[1].replace(/\s+/g, "");
    let key: keyof OrganizedPasteParts | null = null;
    if (/요약/.test(label)) key = "overview";
    else if (/팩트/.test(label)) key = "factChecks";
    else if (/보고서|본문/.test(label)) key = "reportSections";
    else if (/결론/.test(label)) key = "conclusion";
    if (key) {
      indices.push({ key, start: m.index, headEnd: m.index + m[0].length });
    }
  }
  if (indices.length >= 2) {
    for (let i = 0; i < indices.length; i++) {
      const cur = indices[i];
      const end = i + 1 < indices.length ? indices[i + 1].start : text.length;
      const body = text.slice(cur.headEnd, end).trim();
      if (body) parts[cur.key] = body;
    }
    return parts;
  }
  return parts;
}

export function detectPasteKind(text: string): {
  kind: PasteKind;
  confidence: number;
  signals: string[];
} {
  const t = text.trim();
  if (!t) return { kind: "unknown", confidence: 0, signals: [] };

  const signals: string[] = [];
  const verdictN = countMatches(t, /판정\s*[:：]/i);
  const evidenceN = countMatches(t, /근거\s*(?:\(\s*출처\s*\))?\s*[:：]/i);
  const h2N = countMatches(t, /^##[ \t]+/m);
  const numberedShort = countMatches(
    t,
    /^\d+[.)][ \t]+.{2,80}$/m
  );
  const bullets = countMatches(t, /^[ \t]*[•\-*▪◦][ \t]+/m);
  const longParagraphs = countMatches(t, /^[^\n#*]{120,}$/m);
  const conclusionHit = /(?:^|\n)\s*(?:최종\s*)?결론\b|올바른\s*건강|드림\s*$/m.test(
    t
  );
  const overviewCue =
    /대주제|소주제|요약하면|핵심\s*포인트/.test(t) ||
    (numberedShort >= 2 &&
      bullets >= 2 &&
      verdictN === 0 &&
      t.length < 900 &&
      longParagraphs < 2);
  const reportCue =
    h2N >= 2 ||
    (h2N >= 1 && t.length > 400) ||
    (numberedShort >= 2 && (t.length > 500 || longParagraphs >= 1));

  if (verdictN >= 2 || (verdictN >= 1 && evidenceN >= 1)) {
    signals.push(`판정 ${verdictN}·근거 ${evidenceN}`);
  }
  if (h2N >= 2) signals.push(`## 섹션 ${h2N}`);
  if (reportCue) signals.push("보고서형 번호·서술");
  if (overviewCue) signals.push("요약형 번호·불릿");
  if (conclusionHit) signals.push("결론/맺음");

  const labeled = splitLabeledBlocks(t);
  const labeledKeys = Object.keys(labeled).length;
  if (labeledKeys >= 2) {
    signals.push(`라벨 블록 ${labeledKeys}`);
    return { kind: "mixed", confidence: 0.9, signals };
  }

  if (verdictN >= 2 || (verdictN >= 1 && evidenceN >= 2)) {
    return { kind: "factcheck", confidence: 0.85, signals };
  }
  if (reportCue) {
    return { kind: "report", confidence: 0.8, signals };
  }
  if (overviewCue) {
    return { kind: "overview", confidence: 0.75, signals };
  }
  if (conclusionHit && t.length < 800 && verdictN === 0) {
    return { kind: "conclusion", confidence: 0.65, signals };
  }
  return { kind: "unknown", confidence: 0.3, signals };
}

function kindLabel(kind: PasteKind): string {
  switch (kind) {
    case "overview":
      return "요약";
    case "factcheck":
      return "팩트체크";
    case "report":
      return "보고서 본문";
    case "conclusion":
      return "결론";
    case "mixed":
      return "혼합(요약·FC·본문)";
    default:
      return "미분류";
  }
}

/**
 * 붙여넣기 텍스트 → 기호 정리 → 내용 분류 → 단계별 정규화 조각
 */
export function organizePaste(raw: string): OrganizePasteResult {
  const cleaned = cleanPastedText(raw);
  if (!cleaned) {
    return {
      cleaned: "",
      kind: "unknown",
      confidence: 0,
      signals: [],
      parts: {},
      summary: "붙여넣은 내용이 없습니다.",
    };
  }

  const detected = detectPasteKind(cleaned);
  const parts: OrganizedPasteParts = {};
  const labeled = splitLabeledBlocks(cleaned);

  if (detected.kind === "mixed" && Object.keys(labeled).length >= 2) {
    if (labeled.overview) {
      parts.overview = normalizeAiOverviewPaste(labeled.overview);
    }
    if (labeled.factChecks) {
      parts.factChecks = normalizeAiFactCheckPaste(labeled.factChecks);
    }
    if (labeled.reportSections) {
      parts.reportSections = normalizeAiReportPaste(labeled.reportSections);
    }
    if (labeled.conclusion) {
      parts.conclusion = cleanPastedText(labeled.conclusion);
    }
  } else if (detected.kind === "overview") {
    parts.overview = normalizeAiOverviewPaste(cleaned);
  } else if (detected.kind === "factcheck") {
    parts.factChecks = normalizeAiFactCheckPaste(cleaned);
  } else if (detected.kind === "conclusion") {
    parts.conclusion = cleaned;
  } else {
    // report / unknown → 보고서 섹션 정리 우선
    const report = normalizeAiReportPaste(cleaned);
    parts.reportSections = report || cleaned;
    // 결론 단락이 있으면 분리 시도
    if (/^##[ \t]+.*결론/m.test(report || "")) {
      const m = (report || "").match(
        /^##[ \t]+[^\n]*결론[^\n]*\n([\s\S]*?)(?=^## |\s*$)/m
      );
      if (m?.[1]?.trim()) parts.conclusion = m[1].trim();
    }
  }

  const info = parts.reportSections
    ? inspectImportedReportText(parts.reportSections)
    : { count: 0, headings: [] as string[] };
  const fcLines = parts.factChecks
    ? countMatches(parts.factChecks, /^\d+[.)]\s+/m)
    : 0;

  const bits: string[] = [];
  bits.push(`분류: ${kindLabel(detected.kind)}`);
  if (parts.overview) bits.push("요약 정리됨");
  if (parts.factChecks) bits.push(`FC ${fcLines || "?"}건 형식`);
  if (parts.reportSections) {
    bits.push(
      info.count > 0
        ? `본문 섹션 ${info.count}개`
        : "본문 정리됨"
    );
  }
  if (parts.conclusion) bits.push("결론");
  if (detected.signals.length) bits.push(`신호: ${detected.signals.join(", ")}`);

  // 미리보기용 대표 cleaned: 보고서 있으면 그것, 아니면 혼합 조합
  let preview = cleaned;
  if (parts.reportSections) preview = parts.reportSections;
  else if (parts.overview && parts.factChecks) {
    preview = [
      "## 요약",
      parts.overview,
      "",
      "## 팩트체크",
      parts.factChecks,
    ].join("\n");
  } else if (parts.overview) preview = parts.overview;
  else if (parts.factChecks) preview = parts.factChecks;

  return {
    cleaned: preview,
    kind: detected.kind,
    confidence: detected.confidence,
    signals: detected.signals,
    parts,
    summary: bits.join(" · "),
  };
}
