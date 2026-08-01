import type {
  AnswerPart,
  FactCheckResult,
  ReportSectionBlock,
  SummaryItem,
  TypedReport,
  VideoRecord,
} from "./types";
import { REPORT_TYPE_LABELS } from "./types";
import { normalizeImageUrls, splitPrimaryImage } from "./image-urls";
import { resolveAnswerParts } from "./answer-parts";
import { stabilizeReportFcAnchors } from "./fc-markers";
import {
  buildFactCheckPrompt,
  dedupeTexts,
  normalizeAiAnswer,
} from "./text-format";

export { detectReportType } from "./report-detect";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 핵심 문장 노란색 형광 강조 */
export function highlightConclusion(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const m = clean.match(/^(.+?[.。!?？])\s*(.*)$/);
  if (m && m[1].length >= 12) {
    return `<p><mark class="hl-yellow">${escapeHtml(m[1])}</mark>${
      m[2] ? ` ${escapeHtml(m[2])}` : ""
    }</p>`;
  }
  return `<p><mark class="hl-yellow">${escapeHtml(clean)}</mark></p>`;
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}

export function reportBodyPlain(body: string, rich?: boolean): string {
  return rich ? stripHtml(body) : body;
}

export function formatSectionText(
  report: TypedReport,
  sectionIdx: number
): string {
  const sec = report.sections[sectionIdx];
  if (!sec) return "";
  const body = reportBodyPlain(sec.body, sec.rich).trim();
  const lines = [`## ${sec.heading}`];
  if (body) lines.push(body);
  return lines.join("\n\n").trim();
}

export function formatReportText(report: TypedReport): string {
  return report.sections
    .map((_, idx) => formatSectionText(report, idx))
    .filter(Boolean)
    .join("\n\n");
}

export function formatFactChecksText(report: TypedReport): string {
  return (report.factChecks ?? [])
    .map((fc, idx) => {
      const lines = [
        `### F${idx + 1}. ${fc.statement}`.trim(),
        fc.verdict ? `판정: ${fc.verdict}` : "",
        fc.checkGuide?.trim() || "",
      ].filter(Boolean);
      return lines.join("\n");
    })
    .join("\n\n");
}

export function formatReportWithFactChecksText(report: TypedReport): string {
  const reportText = formatReportText(report);
  const fcText = formatFactChecksText(report);
  return [
    report.meta.title ? `# ${report.meta.title}` : "",
    reportText ? `## 보고서\n\n${reportText}` : "",
    fcText ? `## 팩트체크\n\n${fcText}` : "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function plainTextToHtml(text: string): string {
  const parts = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return "<p></p>";
  return parts
    .map(
      (p) =>
        `<p>${escapeHtml(p)
          .replace(/\n/g, "<br>")}</p>`
    )
    .join("");
}

function normalizeHeadingKey(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .replace(/[()[\]{}:：'"“”‘’.,!?·\-–—/\\]/g, " ")
    .replace(/^[^\p{L}\p{N}]+/gu, "")
    .replace(/^제\s*\d+\s*장\s*/g, "")
    .replace(/^\d+\)\s*/g, "")
    .replace(/^\d+\.\s*/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isSkippableImportHeading(heading: string): boolean {
  const key = normalizeHeadingKey(heading);
  return (
    /인터랙티브\s*대시보드/.test(key) ||
    /박종규\s*드림/.test(key) ||
    /^종합\s*보고서/.test(key)
  );
}

function parseImportHeadingLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (/^\[종합\s*보고서\]/i.test(trimmed)) return null;
  if (/^불편을\s*드려/.test(trimmed)) return null;

  const md = trimmed.match(/^##\s+(.+)$/);
  if (md) return md[1].trim();

  const bullet = trimmed.match(/^■\s*(.+)$/);
  if (bullet) return bullet[1].trim();

  const chapter = trimmed.match(/^제\s*\d+\s*장\.?\s*.+$/);
  if (chapter) return trimmed;

  return null;
}

/** AI/웹 붙여넣기: HTML 엔티티·워드 글머리 기호 정리 */
export function sanitizeAiPasteText(raw: string): string {
  return raw
    .replace(/\u200B|\uFEFF/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#0*39;/gi, "'")
    .replace(/&#x0*27;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return _;
      try {
        return String.fromCodePoint(code);
      } catch {
        return _;
      }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const code = parseInt(h, 16);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return _;
      try {
        return String.fromCodePoint(code);
      } catch {
        return _;
      }
    })
    // Word/PDF 글머리( U+F0B7 등) → "-"
    .replace(
      /^[\t ]*[\u2022\u2023\u2043\u2219\u25CF\u25E6\u25AA\uF0B7]\s*/gm,
      "- "
    )
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function preprocessImportRaw(raw: string): string {
  return sanitizeAiPasteText(raw)
    .replace(/^\s*---+\s*$/gm, "")
    .replace(/^#\s+.+$/m, "")
    .replace(/^##\s*보고서\s*/m, "")
    .replace(/\n##\s*팩트체크[\s\S]*$/m, "")
    .replace(/^[^\n]*불편을\s*드려[^\n]*\n+/m, "")
    .replace(/^[^\n]*특수기호[^\n]*\n+/m, "")
    .trim();
}

function parseImportedSections(raw: string): Array<{
  heading: string;
  content: string;
}> {
  const text = preprocessImportRaw(raw);
  if (!text) return [];

  const lines = text.split("\n");
  const sections: Array<{ heading: string; content: string }> = [];
  let current: { heading: string; lines: string[] } | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const heading = parseImportHeadingLine(line);
    if (heading && !isSkippableImportHeading(heading)) {
      if (current) {
        sections.push({
          heading: current.heading.trim(),
          content: current.lines.join("\n").trim(),
        });
      }
      current = { heading, lines: [] };
      continue;
    }
    if (!current) continue;
    current.lines.push(line);
  }

  if (current && !isSkippableImportHeading(current.heading)) {
    sections.push({
      heading: current.heading.trim(),
      content: current.lines.join("\n").trim(),
    });
  }

  return sections
    .map((sec) => ({
      heading: sec.heading,
      content: sec.content.replace(/\n{3,}/g, "\n\n").trim(),
    }))
    .filter((sec) => sec.heading && sec.content);
}

function importChapterNumber(heading: string): number | null {
  const m = heading.match(/제\s*(\d+)\s*장/);
  if (m) return Number(m[1]);
  const numbered = heading.match(/^(\d+)\./);
  if (numbered) return Number(numbered[1]);
  return null;
}

function isSummaryImportHeading(heading: string): boolean {
  const key = normalizeHeadingKey(heading);
  return (
    /executive\s*summary/.test(key) ||
    /총괄\s*요약/.test(key) ||
    /핵심\s*요약/.test(key) ||
    /핵심\s*결론/.test(key) ||
    (/요약/.test(key) && /총괄|executive|핵심/.test(key))
  );
}

function isConclusionImportHeading(heading: string): boolean {
  const key = normalizeHeadingKey(heading);
  return (
    /제\s*5\s*장/.test(heading) ||
    /결론\s*및\s*종합/.test(key) ||
    key === "결론" ||
    /핵심\s*결론/.test(key) ||
    /종합\s*제언/.test(key)
  );
}

function findReportSectionIndex(
  report: TypedReport,
  predicate: (heading: string, idx: number) => boolean
): number {
  return report.sections.findIndex((sec, idx) => predicate(sec.heading, idx));
}

function numberedBodySectionIndices(report: TypedReport): number[] {
  return report.sections
    .map((sec, idx) => ({ idx, key: normalizeHeadingKey(sec.heading) }))
    .filter(
      ({ key }) =>
        /^\d/.test(key) ||
        /고지혈|콜레스테롤/.test(key) ||
        /혈관|검진/.test(key) ||
        /식습관|과식|쾌락/.test(key)
    )
    .map(({ idx }) => idx);
}

function resolveImportSectionIndex(
  report: TypedReport,
  heading: string
): number | undefined {
  if (isSkippableImportHeading(heading)) return undefined;

  const conclusionIdx = findReportSectionIndex(
    report,
    (h) => normalizeHeadingKey(h) === "결론"
  );

  if (isSummaryImportHeading(heading) || isConclusionImportHeading(heading)) {
    return conclusionIdx >= 0 ? conclusionIdx : 0;
  }

  const key = normalizeHeadingKey(heading);
  if (/항목별\s*팩트|팩트\s*체크\s*결과|검증\s*결과/.test(key)) {
    const body = report.sections.findIndex(
      (sec, idx) =>
        idx !== conclusionIdx && normalizeHeadingKey(sec.heading) !== "결론"
    );
    if (body >= 0) return body;
    if (report.sections.length > 1) return 1;
  }

  const chapter = importChapterNumber(heading);
  if (chapter === 1) {
    return conclusionIdx >= 0 ? conclusionIdx : 0;
  }

  const sectionMap = new Map(
    report.sections.map((sec, idx) => [normalizeHeadingKey(sec.heading), idx])
  );
  const exact = sectionMap.get(key);
  if (exact !== undefined) return exact;

  const keywordRules: Array<{ test: RegExp; match: RegExp }> = [
    { test: /고지혈|콜레스테롤|스타틴/, match: /고지혈|콜레스테롤/ },
    { test: /뇌혈관|검진|경동맥|mra/, match: /혈관|검진/ },
    { test: /식습관|과식|쾌락/, match: /식습관|과식|쾌락/ },
  ];
  for (const rule of keywordRules) {
    if (!rule.test.test(key)) continue;
    const idx = findReportSectionIndex(report, (h) =>
      rule.match.test(normalizeHeadingKey(h))
    );
    if (idx >= 0) return idx;
  }

  let bestIdx = -1;
  let bestScore = 0;
  for (let i = 0; i < report.sections.length; i++) {
    const score = overlapScore(
      normalizeHeadingKey(report.sections[i]?.heading || ""),
      key
    );
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  if (bestIdx >= 0 && bestScore >= 0.35) return bestIdx;

  const bodyIdx = numberedBodySectionIndices(report);
  if (chapter !== null && chapter >= 2) {
    const target = bodyIdx[chapter - 2];
    if (target !== undefined) return target;
  }

  return undefined;
}

export function inspectImportedReportText(raw: string): {
  count: number;
  headings: string[];
} {
  const sections = parseImportedSections(raw);
  return {
    count: sections.length,
    headings: sections.map((sec) => sec.heading),
  };
}

/**
 * 외부 AI가 준 마크다운·F1/판정·출처 형식 보고서를
 * 「정리본 붙여넣기」가 읽는 `## 섹션` 형식으로 정리.
 * 번호 주장(1·2·3 / F1·F2)은 **각각 별도 ## 섹션**으로 나눠
 * 섹션마다 이미지를 붙일 수 있게 한다.
 */
export function normalizeAiReportPaste(raw: string): string {
  let t = sanitizeAiPasteText(raw);
  if (!t) return "";

  const lines = t.split("\n");
  const out: string[] = [];
  type PendingClaim = {
    n: number;
    statement: string;
    verdict: string;
    evidence: string;
    body: string[];
    fromS?: boolean;
  };
  // 중첩 함수에서 갱신하므로 박스로 두어 TS 가 null 로 고정하지 않게 함
  const claimState: { current: PendingClaim | null } = { current: null };

  const flushClaim = () => {
    const pendingClaim = claimState.current;
    if (!pendingClaim) return;
    const { n, statement, verdict, evidence, body, fromS } = pendingClaim;
    const label = fromS ? `S${n}` : `${n}`;
    const titleBase = statement
      ? statement.length > 42
        ? `${statement.slice(0, 40).trim()}…`
        : statement
      : `섹션 ${n}`;
    out.push(`## ${label}. ${titleBase}`);
    out.push("");
    // 제목과 같은 주장을 본문에 한 번 더 넣지 않음 (중복 방지)
    const statementIsTitle =
      !!statement &&
      (statement === titleBase ||
        statement.startsWith(titleBase.replace(/…$/, "")));
    if (statement && !statementIsTitle) out.push(statement);
    if (verdict) out.push(`판정: ${verdict}`);
    for (const line of body) {
      if (line.trim()) out.push(line);
    }
    if (evidence) out.push(`근거(출처): ${evidence}`);
    out.push("");
    claimState.current = null;
  };

  const stripMd = (s: string) =>
    s
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/^[-*•\u2022\uF0B7]\s+/, "")
      .trim();

  const asBodyLine = (s: string) =>
    s.replace(/^[-*•\u2022\uF0B7]\s+/, "- ").trim();

  const startClaim = (
    n: number,
    statementRaw: string,
    fromS: boolean,
    original: string
  ) => {
    flushClaim();
    let statement = statementRaw.trim();
    let verdict = "";
    const inlineVerd = statement.match(
      /[（(]?\s*판정\s*[:：]\s*([^）)]+)[）)]?\s*$/i
    );
    if (inlineVerd) {
      verdict = inlineVerd[1]
        .replace(/\s*\(\s*(True|False|Unverifiable|Mostly\s*True)\s*\)\s*/gi, "")
        .trim();
      statement = statement.slice(0, inlineVerd.index).trim();
    }
    const trailVerd = statement.match(/\(\s*판정\s*:\s*([^)]+)\)\s*$/i);
    if (trailVerd) {
      verdict = trailVerd[1].trim();
      statement = statement.slice(0, trailVerd.index).trim();
    }
    claimState.current = {
      n,
      statement,
      verdict: verdict
        .replace(/\s*\(\s*(True|False|Unverifiable|Mostly\s*True)\s*\)\s*/gi, "")
        .trim(),
      evidence: "",
      body: [],
      fromS:
        fromS || /^S\d/i.test(original.replace(/^[-*•\u2022\uF0B7]\s+/, "")),
    };
  };

  for (const rawLine of lines) {
    let s = rawLine.trim();
    if (!s) {
      flushClaim();
      if (out.length && out[out.length - 1] !== "") out.push("");
      continue;
    }

    const original = s;
    // 본문 글머리는 "-"로 유지 (매칭용 strip과 분리)
    const bodyLine = asBodyLine(s);
    s = stripMd(s);
    if (!s) continue;

    // 문서 제목 (…보고서) 단독 줄 → 생략
    if (
      /보고서/.test(s) &&
      s.length <= 80 &&
      !/^\d+\./.test(s) &&
      !/^F\d/i.test(s) &&
      !/판정|출처|근거/.test(s)
    ) {
      continue;
    }

    // 이미 ## / ■ / 제 N 장 형이면 유지
    if (/^##\s+/.test(s) || /^■\s*/.test(s) || /^제\s*\d+\s*장/.test(s)) {
      flushClaim();
      // ## 항목별 팩트체크 같은 묶음 제목은 건너뛰고 주장별 ## 만 씀
      const mdHead = s.match(/^##\s+(.+)$/);
      if (mdHead && /항목별\s*팩트|팩트\s*체크\s*결과/.test(mdHead[1])) {
        continue;
      }
      out.push(s);
      continue;
    }

    // 짧은 번호 섹션 제목: 1. 핵심 결론 (항목별 팩트체크는 건너뜀)
    const sectionHead = s.match(/^(\d+)\.\s+(.+)$/);
    if (
      sectionHead &&
      sectionHead[2].length <= 48 &&
      !/^F\d/i.test(s) &&
      !/판정|출처|근거/.test(s) &&
      !/[.。]$/.test(sectionHead[2])
    ) {
      flushClaim();
      const title = sectionHead[2].trim();
      if (/항목별\s*팩트|팩트\s*체크/.test(title)) {
        continue;
      }
      out.push(`## ${title}`);
      out.push("");
      continue;
    }

    // F3 & F4. 제목 / F3 &amp; F4 (sanitize 후 &)
    const multiF = s.match(
      /^F(\d+)\s*[&＋+]\s*F?(\d+)\s*[.):]?\s*(.*)$/i
    );
    if (multiF) {
      const title =
        multiF[3].trim() ||
        `골각문·갑골문 (F${multiF[1]}·F${multiF[2]})`;
      startClaim(parseInt(multiF[1], 10) || 1, title, false, original);
      continue;
    }

    // F1. / S1. / 긴 1. 주장 → 각각 ## 섹션 (S = 섹션·이미지 단위 표시)
    const claimHead = s.match(/^(?:S|F)?(\d+)[.):]\s+(.+)$/i);
    if (
      claimHead &&
      (claimHead[2].length > 20 ||
        /^(?:S|F)\d/i.test(original) ||
        /판정/.test(claimHead[2]))
    ) {
      startClaim(
        parseInt(claimHead[1], 10) || 1,
        claimHead[2],
        /^S\d/i.test(original.replace(/^[-*•\u2022\uF0B7]\s+/, "")),
        original
      );
      continue;
    }

    // 단독 줄 "S" / "S." → 직전 문장 끝에 이미지 슬롯 S 유지
    if (/^S\.?$/i.test(s)) {
      flushClaim();
      let i = out.length - 1;
      while (i >= 0 && !out[i].trim()) i--;
      if (i >= 0 && !/^##\s+/.test(out[i]) && !/(?:^|[\s.!?。…])S\.?\s*$/u.test(out[i])) {
        out[i] = `${out[i].replace(/\s+$/u, "")} S`;
      } else if (i < 0 || /^##\s+/.test(out[i] ?? "")) {
        out.push("S");
      }
      continue;
    }

    const verd = s.match(/^판정\s*[:：]\s*(.+)$/i);
    if (verd) {
      const v = verd[1]
        .replace(
          /\s*\(\s*(True|False|Unverifiable|Mostly\s*True)\s*\)\s*/gi,
          ""
        )
        .trim();
      if (claimState.current) claimState.current.verdict = v;
      else out.push(`판정: ${v}`);
      continue;
    }

    const src = s.match(
      /^(?:출처|근거(?:\s*\(\s*출처\s*\))?)\s*[:：]\s*(.+)$/i
    );
    if (src) {
      if (claimState.current) {
        claimState.current.evidence = claimState.current.evidence
          ? `${claimState.current.evidence} ${src[1].trim()}`
          : src[1].trim();
      } else {
        out.push(`근거(출처): ${src[1].trim()}`);
      }
      continue;
    }

    if (claimState.current && !claimState.current.statement) {
      claimState.current.statement = s;
      continue;
    }
    if (claimState.current) {
      // 본문·불릿은 근거가 아님 (출처: 줄만 evidence)
      claimState.current.body.push(bodyLine.startsWith("- ") ? bodyLine : s);
      continue;
    }

    flushClaim();
    out.push(bodyLine.startsWith("- ") ? bodyLine : s);
  }

  flushClaim();

  return out
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** HTML 본문 → 단순 텍스트 */
function htmlBodyToPlain(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type ExtractedClaim = {
  n: number;
  statement: string;
  verdict: string;
  evidence: string;
  /** S 표시로 나눈 섹션이면 true */
  fromS?: boolean;
};

/**
 * 본문에서 S1. / F1. / 1. 주장 블록 추출.
 * S1·S2·S3 = 섹션(이미지) 단위 표시.
 * 줄 맨 앞 `S ` / 단독 줄 `S` 도 같은 의미.
 */
export function extractNumberedClaimsFromPlain(plain: string): ExtractedClaim[] {
  const text = plain.replace(/\r\n/g, "\n").trim();
  if (!text) return [];

  // S1. / S2. 우선
  const sNumbered = extractByMarker(text, /(?=^S\d+[.):]\s+)/im, /^S(\d+)[.):]\s+([\s\S]+)$/i);
  if (sNumbered.length >= 2) {
    return sNumbered.map((c) => ({ ...c, fromS: true }));
  }

  // 줄 앞 "S 문장…" 또는 단독 줄 S
  const byLeadingS = extractByLeadingSLines(text);
  if (byLeadingS.length >= 2) return byLeadingS;

  // 단독 줄 S 로 구분 (레거시)
  const byLoneS = extractByLoneSBreaks(text);
  if (byLoneS.length >= 2) return byLoneS;

  // F1. / 1.
  return extractByMarker(
    text,
    /(?=^(?:F?\d+)\.\s+)/m,
    /^F?(\d+)\.\s+([\s\S]+)$/i
  );
}

/** 보고서 본문에 S 이미지 단위 표시가 몇 블록인지 */
export function countSImageMarkersInReport(report: TypedReport): number {
  let max = 0;
  for (const sec of report.sections) {
    const plain = htmlBodyToPlain(sec.body || "");
    const claims = extractNumberedClaimsFromPlain(plain);
    const sClaims = claims.filter((c) => c.fromS);
    if (sClaims.length > max) max = sClaims.length;
    // 표시만 있고 아직 2블록 미만이어도 줄 단위로 센다
    const loose = plain.match(/(?:^|\n)\s*S(?:\d+[.):]|\.?)(?:\s|$)/gim);
    if (loose && loose.length > max) max = loose.length;
  }
  return max;
}

/**
 * `S 첫문장…` / 단독 줄 `S` / `S1. …` 혼용 → 이미지 단위 블록
 */
function extractByLeadingSLines(plain: string): ExtractedClaim[] {
  const lines = plain.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  let sawMarker = false;

  const flush = () => {
    const t = current.join("\n").trim();
    if (t) blocks.push(t);
    current = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    // 단독 S / S.
    if (/^S\.?$/i.test(trimmed)) {
      sawMarker = true;
      flush();
      continue;
    }
    // S1. 문장 / S 문장(공백 뒤 본문)
    const numbered = trimmed.match(/^S(\d+)[.):]\s+(.+)$/i);
    if (numbered) {
      sawMarker = true;
      flush();
      current.push(numbered[2].trim());
      continue;
    }
    const leading = trimmed.match(/^S\s+(.+)$/i);
    if (leading) {
      sawMarker = true;
      flush();
      current.push(leading[1].trim());
      continue;
    }
    current.push(line);
  }
  flush();
  if (!sawMarker || blocks.length < 2) return [];
  return blocks.map((block, i) => {
    const rest = block.replace(/^(?:S|F)?\d+[.):]\s+/i, "").trim();
    return {
      n: i + 1,
      statement: rest || `섹션 ${i + 1}`,
      verdict: "",
      evidence: "",
      fromS: true,
    };
  });
}

function extractByMarker(
  text: string,
  splitRe: RegExp,
  headRe: RegExp
): ExtractedClaim[] {
  const parts = text.split(splitRe).map((p) => p.trim()).filter(Boolean);
  const claims: ExtractedClaim[] = [];

  for (const part of parts) {
    const m = part.match(headRe);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    let rest = m[2].trim();
    let verdict = "";
    let evidence = "";

    const verdLine = rest.match(/(?:^|\n)\s*판정\s*[:：]\s*(.+)$/im);
    const evLine = rest.match(
      /(?:^|\n)\s*(?:-\s*)?(?:근거(?:\s*\(\s*출처\s*\))?|출처)\s*[:：]\s*([\s\S]+)$/im
    );

    if (evLine) {
      evidence = evLine[1].replace(/\s+/g, " ").trim();
      rest = rest.slice(0, evLine.index).trim();
    }
    if (verdLine) {
      verdict = verdLine[1].replace(/\s+/g, " ").trim();
      rest = rest.slice(0, verdLine.index).trim();
    }

    const trail = rest.match(/\(\s*판정\s*:\s*([^)]+)\)\s*$/);
    if (trail) {
      verdict = trail[1].trim();
      rest = rest.slice(0, trail.index).trim();
    }

    if (rest.length < 4 && !verdict) continue;
    claims.push({
      n: Number.isFinite(n) ? n : claims.length + 1,
      statement: rest || `항목 ${n}`,
      verdict,
      evidence,
    });
  }

  return claims;
}

/** 본문에 단독 줄 `S` 로 나눈 블록 */
function extractByLoneSBreaks(plain: string): ExtractedClaim[] {
  const parts = plain
    .split(/^\s*S\.?\s*$/im)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return [];

  return parts.map((block, i) => {
    let rest = block;
    let verdict = "";
    let evidence = "";
    const verdLine = rest.match(/(?:^|\n)\s*판정\s*[:：]\s*(.+)$/im);
    const evLine = rest.match(
      /(?:^|\n)\s*(?:-\s*)?(?:근거(?:\s*\(\s*출처\s*\))?|출처)\s*[:：]\s*([\s\S]+)$/im
    );
    if (evLine) {
      evidence = evLine[1].replace(/\s+/g, " ").trim();
      rest = rest.slice(0, evLine.index).trim();
    }
    if (verdLine) {
      verdict = verdLine[1].replace(/\s+/g, " ").trim();
      rest = rest.slice(0, verdLine.index).trim();
    }
    const trail = rest.match(/\(\s*판정\s*:\s*([^)]+)\)\s*$/);
    if (trail) {
      verdict = trail[1].trim();
      rest = rest.slice(0, trail.index).trim();
    }
    // 앞에 남은 1. / F1. 번호 제거
    rest = rest.replace(/^(?:S|F)?\d+[.):]\s+/i, "").trim();
    return {
      n: i + 1,
      statement: rest || `섹션 ${i + 1}`,
      verdict,
      evidence,
      fromS: true,
    };
  });
}

/**
 * 본문의 S1·S2 / 단독 S / 1·2·3 표시를 섹션 여러 개로 나눔 (섹션별 이미지용).
 */
export function splitNumberedClaimsInReport(report: TypedReport): TypedReport {
  const nextSections: ReportSectionBlock[] = [];
  let changed = false;

  for (const sec of report.sections) {
    const plain = htmlBodyToPlain(sec.body || "");
    // 제목에 S1 이 있고 본문에 여러 S 가 있는 경우도 처리
    const headingPlain = `${sec.heading || ""}\n${plain}`;
    const claims = extractNumberedClaimsFromPlain(plain);
    const fromHeading = claims.length < 2
      ? extractNumberedClaimsFromPlain(headingPlain)
      : claims;
    const blocks = fromHeading.length >= 2 ? fromHeading : claims;

    if (blocks.length < 2) {
      nextSections.push(sec);
      continue;
    }

    changed = true;
    blocks.forEach((c, i) => {
      // 보고서에는 S/번호 표시를 남기지 않음 — 주장 문장만 제목
      const title =
        c.statement.length > 48
          ? `${c.statement.slice(0, 46).trim()}…`
          : c.statement;
      const bodyParts = [
        c.statement,
        c.verdict ? `판정: ${c.verdict}` : "",
        c.evidence ? `근거(출처): ${c.evidence}` : "",
      ].filter(Boolean);
      nextSections.push({
        sectionId: i === 0 ? sec.sectionId : undefined,
        heading: title || `섹션 ${i + 1}`,
        body: plainTextToHtml(bodyParts.join("\n\n")),
        rich: true,
        // 이미지 칸은 비워 두고, 나눈 뒤 섹션마다 붙임
        imageUrl: undefined,
        images: undefined,
        imageRefs: undefined,
      });
    });
  }

  if (!changed) return report;
  // 원본 첫 섹션에만 있던 이미지는 이미지 룸에 남겨 재사용
  return { ...report, sections: nextSections };
}

export function importReportText(
  report: TypedReport,
  raw: string
): TypedReport {
  const matches = parseImportedSections(raw);
  if (!matches.length) return report;

  const contentByIdx = new Map<number, string[]>();
  for (const match of matches) {
    const idx = resolveImportSectionIndex(report, match.heading.trim());
    if (idx === undefined) continue;
    const parts = contentByIdx.get(idx) ?? [];
    parts.push(match.content.trim());
    contentByIdx.set(idx, parts);
  }
  if (!contentByIdx.size) return report;

  const nextSections = [...report.sections];
  let changed = false;
  for (const [idx, parts] of contentByIdx) {
    const prev = nextSections[idx];
    if (!prev) continue;
    const body = plainTextToHtml(parts.join("\n\n"));
    if (prev.body !== body) {
      nextSections[idx] = { ...prev, body, rich: true };
      changed = true;
    }
  }

  if (!changed) return report;
  return { ...report, sections: nextSections };
}

/**
 * 붙여넣기 `##` 섹션으로 보고서 본문 전체를 다시 구성.
 * 기존 섹션 제목·순서·본문은 버리고, 팩트체크·이미지룸은 유지.
 */
export function replaceAllReportBodies(
  report: TypedReport,
  raw: string
): TypedReport {
  const matches = parseImportedSections(raw);
  if (!matches.length) return report;

  const sections: ReportSectionBlock[] = matches.map((m, i) => {
    const prev = report.sections[i];
    return {
      sectionId: prev?.sectionId,
      heading: m.heading.trim(),
      body: plainTextToHtml(m.content.trim()),
      rich: true,
      // 같은 순번의 이미지만 이어 받음 (본문 글은 전부 새 것)
      imageUrl: prev?.imageUrl,
      images: prev?.images,
      imageRefs: prev?.imageRefs,
    };
  });

  const firstPlain = matches[0]?.content.replace(/\s+/g, " ").trim() ?? "";
  return {
    ...report,
    sections,
    summaryExcerpt: firstPlain.slice(0, 280) || report.summaryExcerpt,
  };
}

const GENERIC_SECTION_HEADING =
  /^(본문|새 소주제|핵심 설명|섹션\s*\d*|보고서)$/i;

/**
 * 여러 섹션을 하나의 연속 본문으로 합칩니다.
 * 제목은 본문 안 굵은 문단으로 넣고, 이미지·FC 연결은 순서대로 이어 붙입니다.
 */
export function mergeReportSectionsToSingleBody(
  report: TypedReport
): TypedReport {
  if (report.sections.length <= 1) {
    const only = report.sections[0];
    if (!only) return report;
    if (only.heading && !GENERIC_SECTION_HEADING.test(only.heading.trim())) {
      return report;
    }
    return {
      ...report,
      sections: [{ ...only, heading: "본문" }],
    };
  }

  const htmlParts: string[] = [];
  const images: string[] = [];
  const imageRefs: string[] = [];
  const entries: NonNullable<ReportSectionBlock["entries"]> = [];
  const seenEntry = new Set<string>();

  for (const sec of report.sections) {
    const heading = (sec.heading || "").trim();
    const body = (sec.body || "").trim();
    const bodyPlainStart = body
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, Math.max(heading.length + 8, 24));
    // 본문에 이미 같은 제목이 있으면 strong 제목을 또 넣지 않음
    const headingAlreadyInBody =
      !!heading &&
      !GENERIC_SECTION_HEADING.test(heading) &&
      bodyPlainStart.includes(heading.slice(0, Math.min(heading.length, 20)));
    if (heading && !GENERIC_SECTION_HEADING.test(heading) && !headingAlreadyInBody) {
      htmlParts.push(`<p><strong>${escapeHtml(heading)}</strong></p>`);
    }
    if (body) htmlParts.push(body);

    for (const u of sec.images ?? []) {
      images.push(u || "");
    }
    for (const id of sec.imageRefs ?? []) {
      if (id && !imageRefs.includes(id)) imageRefs.push(id);
    }
    // images 가 비어 있고 imageUrl 만 있으면
    if ((!sec.images || !sec.images.length) && sec.imageUrl) {
      images.push(sec.imageUrl);
    }

    for (const e of sec.entries ?? []) {
      const key = e.itemId || e.text;
      if (key && seenEntry.has(key)) continue;
      if (key) seenEntry.add(key);
      entries.push(e);
    }
  }

  const first = report.sections[0]!;
  return {
    ...report,
    sections: [
      {
        sectionId: first.sectionId,
        heading: "본문",
        body: htmlParts.join("") || "<p><br></p>",
        rich: true,
        imageUrl: undefined,
        images: images.length ? images : undefined,
        imageRefs: imageRefs.length ? imageRefs : undefined,
        entries: entries.length ? entries : undefined,
      },
    ],
  };
}

function isYoutubeThumb(url?: string | null): boolean {
  if (!url) return false;
  return /i\.ytimg\.com|ytimg\.com\/vi\//i.test(url);
}

export type NarrativeSec = {
  title: string;
  details: string[];
  isConclusion?: boolean;
};

/** 요약 본문 → 논리 섹션 (번호·불릿·결론) */
export function parseOverviewNarrative(overview: string): {
  intro: string;
  sections: NarrativeSec[];
  conclusion: string;
} {
  const lines = overview
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const sections: NarrativeSec[] = [];
  let current: NarrativeSec | null = null;
  let intro = "";
  let conclusion = "";
  let inConclusion = false;

  for (const line of lines) {
    if (/^최종\s*결론/.test(line) || /^결론\s*[:：]?/.test(line)) {
      inConclusion = true;
      current = null;
      const rest = line.replace(/^최종\s*결론\s*[:：]?\s*/, "").replace(/^결론\s*[:：]?\s*/, "").trim();
      if (rest) conclusion = conclusion ? `${conclusion} ${rest}` : rest;
      continue;
    }
    if (inConclusion) {
      conclusion = conclusion ? `${conclusion} ${line}` : line;
      continue;
    }

    const numbered = line.match(
      /^(?:#{1,3}\s+)?(?:\d+[\.\)]\s+|[\u2460-\u2473]\s*)(.+)$/
    );
    if (numbered) {
      current = { title: numbered[1].trim(), details: [] };
      sections.push(current);
      continue;
    }
    const bullet = line.match(/^[•\-·*]\s*(.+)$/);
    if (bullet && current) {
      current.details.push(bullet[1].trim());
      continue;
    }
    if (!current) {
      if (line.length >= 20) {
        intro = intro ? `${intro} ${line}` : line;
      }
      continue;
    }
    if (line.length >= 12) current.details.push(line);
  }

  // 번호 구조가 없으면 문단/문장 묶음으로 나눔
  if (!sections.length) {
    const chunks = overview
      .split(/\n{2,}/)
      .map((c) => c.replace(/\s+/g, " ").trim())
      .filter((c) => c.length >= 40);
    if (chunks.length >= 2) {
      for (const c of chunks.slice(0, 10)) {
        const title = c.slice(0, 48) + (c.length > 48 ? "…" : "");
        sections.push({ title, details: [c] });
      }
    } else {
      const sentences = overview
        .split(/(?<=[.。!?？])\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 30);
      const group = 2;
      for (let i = 0; i < Math.min(sentences.length, 12); i += group) {
        const part = sentences.slice(i, i + group);
        if (!part.length) continue;
        sections.push({
          title: part[0].slice(0, 48) + (part[0].length > 48 ? "…" : ""),
          details: part,
        });
      }
    }
  }

  if (!conclusion) {
    const last = sections[sections.length - 1];
    if (last && /결론|정리|요약하면|결국/.test(last.title + last.details.join(" "))) {
      conclusion = [last.title, ...last.details].join(" ");
      sections.pop();
    }
  }

  return {
    intro: intro.replace(/\s+/g, " ").trim(),
    sections: sections
      .map((s) => ({
        title: s.title.replace(/\s+/g, " ").trim(),
        details: s.details.map((d) => d.replace(/\s+/g, " ").trim()).filter(Boolean),
      }))
      .filter((s) => s.title.length >= 4)
      .slice(0, 14),
    conclusion: conclusion.replace(/\s+/g, " ").trim(),
  };
}

/** 매칭용 토큰 (한글·영·숫자 2자 이상) */
function tokens(text: string): Set<string> {
  const out = new Set<string>();
  const cleaned = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const w of cleaned.split(" ")) {
    if (w.length >= 2) out.add(w);
  }
  // 한글 바이그램
  const hangul = cleaned.replace(/[^가-힣]/g, "");
  for (let i = 0; i < hangul.length - 1; i++) {
    out.add(hangul.slice(i, i + 2));
  }
  return out;
}

function overlapScore(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let hit = 0;
  for (const t of ta) {
    if (tb.has(t)) hit += t.length >= 3 ? 2 : 1;
  }
  return hit / Math.sqrt(ta.size * tb.size);
}

type FcBundle = {
  item: SummaryItem;
  fc?: FactCheckResult;
  /** 팩트체크 대상(주장) 이미지 */
  targetImages: string[];
  /** 번호별 답변 텍스트·이미지 */
  answerParts: AnswerPart[];
  textBlob: string;
};

function collectFcBundles(
  items: SummaryItem[],
  factChecks: FactCheckResult[]
): FcBundle[] {
  const fcMap = new Map(factChecks.map((f) => [f.itemId, f]));
  return items
    .filter((i) => i.needsFactCheck)
    .map((item) => {
      const fc = fcMap.get(item.id);
      const targetImages = normalizeImageUrls(
        item.imageUrl,
        item.imageUrls
      ).filter((u) => !isYoutubeThumb(u));
      const answerParts = resolveAnswerParts({
        explanation: fc?.explanation,
        answerImageUrl: fc?.answerImageUrl,
        answerImageUrls: fc?.answerImageUrls,
        answerParts: fc?.answerParts,
      }).map((p) => ({
        ...p,
        imageUrls: (p.imageUrls ?? []).filter((u) => !isYoutubeThumb(u)),
      }));
      const textBlob = [
        item.statement,
        item.detail ?? "",
        fc?.explanation && !/^다음 주장을/.test(fc.explanation)
          ? fc.explanation
          : "",
      ].join(" ");
      return { item, fc, targetImages, answerParts, textBlob };
    });
}

/** FC를 요약 섹션에 규칙 매칭 (1:1 우선, 점수 낮은 것은 잔여) */
function matchBundlesToSections(
  sections: NarrativeSec[],
  bundles: FcBundle[]
): { bySection: FcBundle[][]; leftover: FcBundle[] } {
  const bySection: FcBundle[][] = sections.map(() => []);
  const used = new Set<string>();
  const leftover: FcBundle[] = [];

  // 각 섹션에 최고 점수 FC 배정 (라운드 로빈 느낌으로 섹션 우선)
  const candidates: Array<{
    si: number;
    bi: number;
    score: number;
  }> = [];

  for (let si = 0; si < sections.length; si++) {
    const secText = [sections[si].title, ...sections[si].details].join(" ");
    for (let bi = 0; bi < bundles.length; bi++) {
      const score = overlapScore(secText, bundles[bi].textBlob);
      if (score > 0.08) candidates.push({ si, bi, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  for (const c of candidates) {
    const id = bundles[c.bi].item.id;
    if (used.has(id)) continue;
    // 섹션당 최대 3개 FC
    if (bySection[c.si].length >= 3) continue;
    bySection[c.si].push(bundles[c.bi]);
    used.add(id);
  }

  for (const b of bundles) {
    if (!used.has(b.item.id)) leftover.push(b);
  }

  // 잔여: 가장 덜 찬 섹션에 약매칭으로라도 배치 (이미지 고아 방지)
  const still: FcBundle[] = [];
  for (const b of leftover) {
    let bestSi = -1;
    let bestScore = -1;
    for (let si = 0; si < sections.length; si++) {
      if (bySection[si].length >= 3) continue;
      const secText = [sections[si].title, ...sections[si].details].join(" ");
      const score = overlapScore(secText, b.textBlob);
      if (score > bestScore) {
        bestScore = score;
        bestSi = si;
      }
    }
    if (bestSi >= 0 && (bestScore > 0.03 || sections.length === 1)) {
      bySection[bestSi].push(b);
    } else if (bestSi >= 0 && bySection.every((x) => x.length === 0)) {
      bySection[bestSi].push(b);
    } else {
      still.push(b);
    }
  }

  return { bySection, leftover: still };
}

/**
 * 소주제 서술만 본문에 넣는다.
 * 팩트체크 주장·답변·이미지는 entries로만 내려보내 화면/PDF 중복을 막는다.
 */
function sectionBodyHtml(title: string, details: string[]): string {
  const lead = details.length ? details.join(" ") : title;
  if (!lead.trim()) return "";
  return `<p>${escapeHtml(lead)}</p>`;
}

function entryFromBundle(m: FcBundle) {
  const flatImages = m.answerParts.flatMap((p) => p.imageUrls ?? []);
  const split = splitPrimaryImage(flatImages);
  return {
    itemId: m.item.id,
    text: m.item.statement,
    answerImageUrl: split.imageUrl,
    answerImageUrls: split.imageUrls,
    answerParts: m.answerParts.length ? m.answerParts : undefined,
  };
}

/**
 * 요약 논리 흐름 기준 보고서.
 * 각 소주제 = 요약 텍스트 + 매칭된 이미지 + 관련 팩트체크
 */
export function buildTypedReport(
  video: Pick<
    VideoRecord,
    | "title"
    | "channel"
    | "youtubeUrl"
    | "overview"
    | "summaryBullets"
    | "items"
    | "factChecks"
    | "reportType"
    | "updatedAt"
    | "createdAt"
    | "thumbnailUrl"
    | "videoId"
    | "inputMode"
  >
): TypedReport {
  const writtenAt = new Date(video.updatedAt || video.createdAt).toLocaleString(
    "ko-KR"
  );
  const fcMap = new Map(video.factChecks.map((f) => [f.itemId, f]));
  const parsed = parseOverviewNarrative(video.overview || "");
  const bundles = collectFcBundles(video.items, video.factChecks);
  const { bySection, leftover } = matchBundlesToSections(
    parsed.sections,
    bundles
  );

  const conclusionText =
    parsed.conclusion ||
    video.summaryBullets?.[0] ||
    parsed.sections[0]?.details[0] ||
    parsed.intro ||
    video.overview.split(/[.。!?？\n]/).find((s) => s.trim().length > 20)?.trim() ||
    video.overview.slice(0, 160);

  const sections: TypedReport["sections"] = [];

  // 1) 결론 — 요약의 결론만 (이미지 몰아넣기 없음)
  sections.push({
    heading: "결론",
    body: highlightConclusion(conclusionText),
    rich: true,
    imageUrl: undefined,
    images: undefined,
  });

  // 2) 도입 (있을 때만)
  if (parsed.intro && parsed.intro.length >= 40) {
    sections.push({
      heading: "도입",
      body: `<p>${escapeHtml(parsed.intro)}</p>`,
      rich: true,
    });
  }

  // 3) 요약 소주제: 서술(body) + 대상 이미지 + FC는 entries만
  parsed.sections.forEach((sec, si) => {
    const matched = bySection[si] ?? [];
    const images = matched.flatMap((m) => m.targetImages);
    sections.push({
      heading: sec.title.slice(0, 80),
      body: sectionBodyHtml(sec.title, sec.details),
      rich: true,
      images: images.length ? Array.from(new Set(images)) : undefined,
      entries: matched.map(entryFromBundle),
    });
  });

  // 4) 매칭 안 된 FC·이미지 — 본문은 안내만, FC는 entries
  if (leftover.length) {
    const images = leftover.flatMap((m) => m.targetImages);
    sections.push({
      heading: "추가 검증",
      body: `<p>${escapeHtml(
        "아래는 요약 소주제와 직접 묶이지 않은 검증 항목입니다."
      )}</p>`,
      rich: true,
      images: images.length ? Array.from(new Set(images)) : undefined,
      entries: leftover.map(entryFromBundle),
    });
  }

  // 소주제가 전혀 없으면 구형 폴백: 요약 본문 + FC는 entries만
  if (!parsed.sections.length) {
    sections.length = 0;
    sections.push({
      heading: "결론",
      body: highlightConclusion(conclusionText),
      rich: true,
    });
    sections.push({
      heading: "요약",
      body: `<p>${escapeHtml(video.overview || "")}</p>`,
      rich: true,
    });
    for (const b of bundles) {
      sections.push({
        heading: b.item.statement.slice(0, 60),
        body: "",
        rich: true,
        images: b.targetImages.length ? b.targetImages : undefined,
        entries: [entryFromBundle(b)],
      });
    }
  }

  const fcItems = video.items.filter((i) => i.needsFactCheck);
  const inlineFactChecks = fcItems.map((i) => {
    const fc = fcMap.get(i.id);
    const raw = fc?.explanation?.trim() ?? "";
    const isPrompt =
      !raw || (/^다음 주장을/.test(raw) && /팩트체크/.test(raw));
    const parts = resolveAnswerParts({
      explanation: isPrompt ? "" : raw,
      answerImageUrl: fc?.answerImageUrl,
      answerImageUrls: fc?.answerImageUrls,
      answerParts: fc?.answerParts,
    });
    const flat = parts.flatMap((p) => p.imageUrls ?? []);
    const split = splitPrimaryImage(flat);
    return {
      itemId: i.id,
      statement: i.statement,
      verdict: fc?.verdict ?? ("pending" as const),
      checkGuide: isPrompt ? "" : normalizeAiAnswer(raw),
      answerImageUrl: split.imageUrl,
      answerImageUrls: split.imageUrls,
      answerParts: parts.length ? parts : undefined,
    };
  });

  const summaryExcerpt = dedupeTexts([
    `결론: ${conclusionText}`,
    ...parsed.sections.slice(0, 6).map((s, i) => `${i + 1}. ${s.title}`),
  ]).join("\n");

  return stabilizeReportFcAnchors({
    meta: {
      title: video.title,
      channel: video.channel,
      url:
        video.inputMode === "report"
          ? "Report 생성 (직접 입력)"
          : video.youtubeUrl,
      writtenAt,
    },
    reportType: video.reportType,
    reportTypeLabel: "일반 보고서",
    format: "general_v5" as const,
    sections,
    summaryExcerpt,
    factChecks: inlineFactChecks.map((f) => ({
      itemId: f.itemId,
      statement: f.statement,
      checkGuide: f.checkGuide,
      verdict: f.verdict,
      answerImageUrl: f.answerImageUrl,
      answerImageUrls: f.answerImageUrls,
      answerParts: f.answerParts,
    })),
  });
}

/** API·파이프라인 공용 */
export function factCheckGuideForItem(item: SummaryItem): string {
  const fromEvidence = item.evidence.find(
    (e) => e.sourceHint === "factcheck-guide"
  )?.text;
  if (fromEvidence && !fromEvidence.includes("본문 근거")) {
    return fromEvidence;
  }
  return buildFactCheckPrompt(item.statement, item.detail);
}
