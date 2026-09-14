import type {
  FactCheckResult,
  ReportEntry,
  SummaryItem,
  TypedReport,
} from "./types";
import { htmlToPlainText } from "./text-format";

const DETAIL_SPLIT =
  /\n\s*(?:종합\s*검토|쉽게\s*설명|반론|자세히|상세)\s*[:：]?/;

function usablePlain(raw: string | undefined | null): string {
  const t = htmlToPlainText(raw || "").trim();
  if (!t) return "";
  if (/^다음 주장을/.test(t) && /팩트체크해 주세요/.test(t)) return "";
  return t;
}

/** 보고서 ‘결과’ 칸용 — 종합검토·쉽게 설명 등 세부 덩어리는 자름 */
export function shortenFactCheckResult(text: string, max = 280): string {
  let t = text.trim();
  if (!t) return "";
  t = t.split(DETAIL_SPLIT)[0]?.trim() ?? t;
  t = t.replace(/^\(?출처\)?[:：]\s*/gm, "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).replace(/\s+\S*$/, "").trim()}…`;
}

export function factCheckResultPlain(opts: {
  entry: ReportEntry;
  reportFc?: TypedReport["factChecks"][number];
  videoFc?: FactCheckResult;
  item?: SummaryItem;
}): string {
  const parts =
    opts.entry.answerParts ??
    opts.reportFc?.answerParts ??
    opts.videoFc?.answerParts;
  if (parts?.length) {
    const joined = parts
      .map((p) => usablePlain(p.text))
      .filter(Boolean)
      .join("\n");
    if (joined) return shortenFactCheckResult(joined);
  }
  for (const c of [
    opts.reportFc?.checkGuide,
    opts.videoFc?.explanation,
    opts.entry.html,
  ]) {
    const t = usablePlain(c);
    if (t.length >= 12) return shortenFactCheckResult(t);
  }
  return "";
}
