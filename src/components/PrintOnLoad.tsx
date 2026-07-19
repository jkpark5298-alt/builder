"use client";

import { useEffect } from "react";

/** ?print=1 로 들어오면 보고서 섹션으로 스크롤 후 인쇄 */
export function PrintOnLoad() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("print") !== "1") return;
    const el = document.getElementById("report");
    el?.scrollIntoView({ behavior: "instant", block: "start" });
    const t = window.setTimeout(() => window.print(), 400);
    // URL에서 print 파라미터 제거 (뒤로가기·새로고침 시 재인쇄 방지)
    params.delete("print");
    const next = `${window.location.pathname}${
      params.toString() ? `?${params}` : ""
    }${window.location.hash}`;
    window.history.replaceState(null, "", next);
    return () => window.clearTimeout(t);
  }, []);

  return null;
}
