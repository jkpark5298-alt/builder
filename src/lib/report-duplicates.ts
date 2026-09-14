import { reportBodyPlain } from "./report";
import type { TypedReport } from "./types";

/** 섹션 본문이 서로 거의 같거나 포함 관계면 중복으로 본다 */
export function reportHasDuplicateSectionBodies(report: TypedReport): boolean {
  const plains = report.sections
    .map((sec) =>
      reportBodyPlain(sec.body || "", Boolean(sec.rich))
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter((p) => p.length >= 48);
  for (let i = 0; i < plains.length; i++) {
    for (let j = i + 1; j < plains.length; j++) {
      const a = plains[i]!;
      const b = plains[j]!;
      if (a === b) return true;
      const short = a.length <= b.length ? a : b;
      const long = a.length <= b.length ? b : a;
      if (
        short.length >= 48 &&
        long.includes(short.slice(0, Math.min(120, short.length)))
      ) {
        return true;
      }
    }
  }
  return false;
}
