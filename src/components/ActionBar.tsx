"use client";

import type { VideoRecord } from "@/lib/types";
import { canExportArtifacts } from "@/lib/factcheck-client";
import { ReportActions } from "@/components/ReportActions";

/** 상세 상단 작업 바 — 보고서 버튼은 그룹으로 한 번만 표시 (중복 없음) */
export function ActionBar({ video }: { video: VideoRecord }) {
  const ready = canExportArtifacts(video);

  return (
    <div className="space-y-3 print:hidden">
      {!ready && (
        <p className="text-sm text-accent bg-accent-muted/50 rounded-xl px-3 py-2">
          ① 팩트체크 중 → <strong>정보/요약 입력</strong> 또는 유튜브 목록. ②
          팩트체크 끝 → <strong>작성 대기</strong>. ③{" "}
          <strong>보고서 만들기</strong> → <strong>보고서 현황</strong>.
        </p>
      )}

      {ready && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-ink-500">보고서</p>
          <ReportActions video={video} includeManage />
        </div>
      )}
    </div>
  );
}
