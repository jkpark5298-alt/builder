import type { FactCheckVerdict } from "./types";

export function verdictLabel(v: FactCheckVerdict) {
  const map: Record<FactCheckVerdict, string> = {
    true: "사실",
    mostly_true: "대체로 사실",
    mixed: "일부 사실",
    mostly_false: "대체로 거짓",
    false: "거짓",
    unverifiable: "검증 불가",
    pending: "대기",
  };
  return map[v];
}
