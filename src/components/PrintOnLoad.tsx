"use client";

import { useEffect } from "react";
import { prepareReportForPrint } from "@/lib/report-dom-export";

/** ?print=1 로 들어오면 보고서 보기 본문으로 맞춘 뒤 인쇄 */
export function PrintOnLoad() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("print") !== "1") return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          await prepareReportForPrint();
          if (!cancelled) window.print();
        } catch {
          if (!cancelled) window.print();
        }
      })();
    }, 400);
    // URL에서 print 파라미터 제거 (뒤로가기·새로고침 시 재인쇄 방지)
    params.delete("print");
    const next = `${window.location.pathname}${
      params.toString() ? `?${params}` : ""
    }${window.location.hash}`;
    window.history.replaceState(null, "", next);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, []);

  return null;
}
