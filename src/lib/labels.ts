import type { FactCheckVerdict } from "./types";

export function verdictLabel(v: FactCheckVerdict) {
  const map: Record<FactCheckVerdict, string> = {
    true: "사실",
    mostly_true: "대체로 사실",
    mixed: "대체로 사실",
    mostly_false: "거짓",
    false: "거짓",
    unverifiable: "검증 불가",
    pending: "대기",
  };
  return map[v];
}

/** 구 판정(일부 사실·대체로 거짓) → 4종으로 정규화 */
export function normalizeSimpleVerdict(
  v: FactCheckVerdict | string | undefined | null
): FactCheckVerdict {
  switch (v) {
    case "true":
    case "mostly_true":
    case "false":
    case "unverifiable":
      return v;
    case "mixed":
      return "mostly_true";
    case "mostly_false":
      return "false";
    case "pending":
    default:
      return "unverifiable";
  }
}
