"use client";

import { useEffect, useState } from "react";
import { SavedTranscriptPanel } from "@/components/SavedTranscriptPanel";
import { EditableReportPanel } from "@/components/EditableReportPanel";
import { InfographicPanel } from "@/components/InfographicPanel";
import { ReportActions } from "@/components/ReportActions";
import { libraryCardLabel } from "@/lib/library";
import {
  getOdysseySampleVideo,
  withReadyPreview,
  ODYSSEY_VIDEO_ID,
} from "@/lib/odyssey-sample";

/** 무거운 보고서 UI는 마운트 뒤에만 그려 주소가 바로 열리게 함 */
export function OdysseySampleView() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="rounded-2xl border border-ink-200 bg-white p-6 space-y-2">
        <p className="text-xs font-medium tracking-wide text-accent">SAMPLE</p>
        <h1 className="font-display text-2xl">오딧세이 · 불러오는 중…</h1>
        <p className="text-sm text-ink-600">보고서 샘플을 준비하고 있습니다.</p>
      </div>
    );
  }

  const video = getOdysseySampleVideo();
  const ready = withReadyPreview(video);
  const transcriptChars = (video.transcript ?? "").trim().length;
  const fcCount = video.factChecks?.length ?? 0;
  const imageCount = video.report?.imageRoom?.length ?? 0;

  return (
    <div className="space-y-8 pb-24">
      <section className="rounded-2xl border border-ink-900 bg-white p-5 space-y-3">
        <p className="text-xs font-medium tracking-wide text-accent">SAMPLE</p>
        <h1 className="font-display text-2xl sm:text-3xl">
          오딧세이 · 유지 기능 확인
        </h1>
        <p className="text-sm text-ink-600 leading-relaxed">
          배포 기록 「오딧세이」 스냅샷으로 레이아웃을 보여 줍니다. DB나 배포
          API가 없어도 이 주소는 열립니다. 완료 후속(공유·PDF·인포)은{" "}
          <strong>화면에서만</strong> 완료 상태로 보여 줍니다. 원본 상태는{" "}
          {video.status} 입니다.
        </p>
        <p className="text-xs text-amber-800 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          이 화면에서 본문 저장·이미지 업로드를 하면 로컬에 없는 원본 id 로
          요청이 갈 수 있습니다. 보기·복사만 하세요.
        </p>
        <div className="flex flex-wrap gap-2 text-sm">
          <a
            href={`#sample-report`}
            className="rounded-xl bg-ink-900 text-white px-3 py-2 min-h-10 inline-flex items-center"
          >
            보고서 샘플로
          </a>
          <a
            href={`/videos/${ODYSSEY_VIDEO_ID}`}
            className="rounded-xl border border-ink-200 px-3 py-2 min-h-10 inline-flex items-center"
          >
            원본 항목 (이 환경 DB에 있을 때만)
          </a>
        </div>
      </section>

      <section className="rounded-2xl border border-ink-200 bg-white p-5 space-y-3">
        <h2 className="font-display text-lg">이번에 확인하는 것</h2>
        <ol className="list-decimal pl-5 text-sm text-ink-800 space-y-2 leading-relaxed">
          <li>
            <strong>자막 복사</strong> — 저장된 자막을 그대로 복사합니다.
          </li>
          <li>
            <strong>보고서 이미지</strong> — 본문 탭의 이미지 룸·S칸.
          </li>
          <li>
            <strong>보고서 본문 아래 팩트체크</strong> — 긴 글(결론·도입)이
            먼저, 그다음 F1…F{fcCount} 판정·결과.
          </li>
          <li>
            <strong>완료 후 후속</strong> — 보기/수정/공유/PDF/인쇄, 인포 이미지.
          </li>
        </ol>
      </section>

      <section className="rounded-2xl border border-ink-200 bg-white p-5 space-y-3">
        <h2 className="font-display text-lg">목록 · 제목과 상태만</h2>
        <div className="rounded-xl border border-ink-200 px-4 py-3">
          <span className="text-xs rounded-md bg-accent-muted text-accent px-2 py-0.5">
            {libraryCardLabel(video)}
          </span>
          <p className="font-medium text-ink-900 mt-1">{video.title}</p>
          <p className="text-xs text-ink-400 mt-1">
            상세에서만 자막 {transcriptChars.toLocaleString()}자 · 검증 {fcCount}
            건 · 이미지 룸 {imageCount}장
          </p>
        </div>
      </section>

      <section id="sample-copy" className="space-y-3">
        <h2 className="font-display text-lg px-1">1. 자막 복사</h2>
        <SavedTranscriptPanel video={video} />
      </section>

      <section id="sample-report" className="space-y-3">
        <h2 className="font-display text-lg px-1">
          2–4. 보고서 보기 · 이미지 · 완료 후속
        </h2>
        <p className="text-sm text-ink-600 px-1">
          이미지는 보고서의 <strong>본문</strong> 탭 → 이미지 룸에서 넣습니다.
          보기는 본문 다음 팩트체크 결과입니다.
        </p>
        <div className="rounded-2xl border border-accent/30 bg-white shadow-sm p-4 sm:p-5">
          <h3 className="font-display text-lg mb-3">보고서</h3>
          <ReportActions video={ready} />
        </div>
        <EditableReportPanel video={ready} />
        <InfographicPanel video={ready} />
      </section>
    </div>
  );
}
