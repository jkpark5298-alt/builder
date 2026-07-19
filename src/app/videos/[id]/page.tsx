import { getVideo } from "@/lib/store";
import { ActionBar } from "@/components/ActionBar";
import { EditableReportPanel } from "@/components/EditableReportPanel";
import { InfographicPanel } from "@/components/InfographicPanel";
import { ManualFactCheckWizard } from "@/components/ManualFactCheckWizard";
import { OverviewSummaryPanel } from "@/components/OverviewSummaryPanel";
import { PasteScriptPanel } from "@/components/PasteScriptPanel";
import { PrintOnLoad } from "@/components/PrintOnLoad";
import { ReprocessButton } from "@/components/ReprocessButton";
import { ReopenAsDraftButton } from "@/components/ReopenAsDraftButton";
import { ReportActions } from "@/components/ReportActions";
import { SavedTranscriptPanel } from "@/components/SavedTranscriptPanel";
import { VideoProcessingPoller } from "@/components/VideoProcessingPoller";
import { VideoNotFoundRecovery } from "@/components/VideoNotFoundRecovery";
import { factCheckProgress } from "@/lib/factcheck";
import { libraryCardLabel, libraryStage } from "@/lib/library";
import { REPORT_TYPE_LABELS } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function VideoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const video = await getVideo(id);
  if (!video) {
    return <VideoNotFoundRecovery id={id} />;
  }

  const awaiting = video.status === "awaiting_factcheck";
  const ready = video.status === "ready";
  const progress = factCheckProgress(video);
  const stage = libraryStage(video);
  const stageLabel = libraryCardLabel(video);

  return (
    <div className="space-y-6 sm:space-y-8 pb-24 sm:pb-8">
      <VideoProcessingPoller
        videoId={video.id}
        status={video.status}
        errorMessage={video.errorMessage}
      />
      <ol className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs sm:text-sm">
        {[
          { n: "1", t: "유튜브 내용 요약", on: true },
          {
            n: "2",
            t: "팩트체크 정리",
            on: awaiting || ready,
          },
          { n: "3", t: "유형 보고서", on: ready },
          { n: "4", t: "인포·공유", on: ready },
        ].map((s) => (
          <li
            key={s.n}
            className={`rounded-xl border px-2 py-2.5 ${
              s.on
                ? "border-accent/40 bg-accent-muted/50 text-ink-900"
                : "border-ink-200 bg-white/60 text-ink-400"
            }`}
          >
            <span className="font-medium">
              {s.n}. {s.t}
            </span>
          </li>
        ))}
      </ol>

      <section className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr] print:hidden">
        <div className="overflow-hidden rounded-2xl border border-ink-200 bg-ink-900">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={video.thumbnailUrl}
            alt=""
            className="w-full aspect-video object-cover opacity-95"
          />
        </div>
        <div className="space-y-4">
          <div>
            <p className="text-sm text-accent font-medium">{video.channel}</p>
            <h1 className="font-display text-2xl sm:text-3xl text-ink-900 mt-1 leading-tight break-words">
              {video.title}
            </h1>
            <a
              href={video.youtubeUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-ink-500 hover:text-accent mt-2 inline-block break-all"
            >
              {video.youtubeUrl}
            </a>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-ink-500">
            <span className="rounded-md bg-white border border-ink-200 px-2 py-1">
              {REPORT_TYPE_LABELS[video.reportType]}
            </span>
            <span className="rounded-md bg-white border border-ink-200 px-2 py-1">
              스크립트:{" "}
              {video.transcriptSource === "pasted"
                ? "붙여넣은 스크립트"
                : video.transcriptSource === "youtube"
                  ? "자막"
                  : video.transcriptSource === "youtube_auto"
                    ? "자동자막→텍스트"
                    : video.transcriptSource === "speech_text"
                      ? "음성→텍스트"
                      : video.transcriptSource === "creator_meta"
                        ? "설명·챕터만"
                        : "없음"}
            </span>
            <span
              className={`rounded-md border px-2 py-1 ${
                stage === "complete"
                  ? "bg-verify-true/10 text-verify-true border-verify-true/20"
                  : stage === "report_pending"
                    ? "bg-ink-900 text-white border-ink-900"
                    : stage === "factcheck_draft"
                      ? "bg-accent-muted text-accent border-accent/30"
                      : "bg-white border-ink-200"
              }`}
            >
              {stage === "factcheck_draft"
                ? `임시 저장 · 팩트체크 ${progress.doneCount}/${progress.total}`
                : stage === "report_pending"
                  ? "보고서 저장 대기"
                  : stageLabel}
            </span>
          </div>
          {video.scriptNotice && (
            <div className="rounded-xl border border-accent/30 bg-accent-muted/50 px-3 py-2.5 text-sm text-ink-800">
              {video.scriptNotice}
            </div>
          )}
          {(video.transcriptSource === "creator_meta" ||
            video.transcriptSource === "none") && (
            <PasteScriptPanel
              videoId={video.id}
              youtubeUrl={video.youtubeUrl}
            />
          )}
          <div className="flex flex-wrap gap-2">
            <ReprocessButton videoId={video.id} />
          </div>
          <SavedTranscriptPanel video={video} />
          {ready && <ReopenAsDraftButton videoId={video.id} />}
          <ActionBar video={video} />
          {awaiting && (
            <a
              href="#general-summary"
              className="flex sm:hidden items-center justify-center min-h-12 rounded-xl bg-accent text-white font-medium"
            >
              1. 유튜브 내용 요약
            </a>
          )}
          {ready && (
            <a
              href="#report"
              className="flex sm:hidden items-center justify-center min-h-12 rounded-xl bg-accent text-white font-medium print:hidden"
            >
              보고서 보기
            </a>
          )}
        </div>
      </section>
      {ready && <PrintOnLoad />}

      <section
        id="general-summary"
        className="rounded-2xl border border-accent/30 bg-white shadow-sm overflow-hidden print:hidden"
      >
        <div className="bg-accent px-4 sm:px-5 py-3.5">
          <h2 className="font-display text-xl sm:text-2xl text-white text-center sm:text-left">
            1. 유튜브 내용 요약
          </h2>
        </div>
        <div className="p-4 sm:p-5 space-y-3">
          <OverviewSummaryPanel video={video} />
          {(video.transcriptSource === "creator_meta" ||
            video.transcriptSource === "none") && (
            <PasteScriptPanel
              videoId={video.id}
              youtubeUrl={video.youtubeUrl}
            />
          )}
        </div>
      </section>

      {awaiting && <ManualFactCheckWizard video={video} />}

      {ready && (
        <>
          <section className="rounded-2xl border border-accent/30 bg-white shadow-sm overflow-hidden print:hidden">
            <div className="bg-accent px-4 sm:px-5 py-3.5">
              <h2 className="font-display text-xl sm:text-2xl text-white text-center sm:text-left">
                2. 팩트체크 정리
              </h2>
            </div>
            <div className="p-4 sm:p-5 space-y-3">
              <p className="text-sm text-ink-600">
                이 항목은 <strong>완료</strong> 상태입니다. 팩트체크를 고치려면{" "}
                <strong>수정 (팩트체크 다시 열기)</strong>를 눌러 임시 저장으로
                옮긴 뒤 다시 정리하세요. 보고서 본문은 아래{" "}
                <strong>수정 (텍스트·이미지)</strong>로 바로 고칠 수 있습니다.
              </p>
              <ReopenAsDraftButton videoId={video.id} />
              {video.factChecks.length > 0 && (
                <div className="space-y-3 pt-2">
                  {video.items
                    .filter((i) => i.needsFactCheck)
                    .map((item) => {
                      const fc = video.factChecks.find(
                        (f) => f.itemId === item.id
                      );
                      if (!fc) return null;
                      const itemImgs = [
                        ...(item.imageUrl ? [item.imageUrl] : []),
                        ...(item.imageUrls ?? []),
                      ].filter(Boolean);
                      const answerImgs = [
                        ...(fc.answerImageUrl ? [fc.answerImageUrl] : []),
                        ...(fc.answerImageUrls ?? []),
                        ...(fc.answerParts ?? []).flatMap(
                          (p) => p.imageUrls ?? []
                        ),
                      ].filter(Boolean);
                      const uniqAnswers = Array.from(new Set(answerImgs));
                      return (
                        <div
                          key={item.id}
                          className="rounded-xl border border-ink-100 p-3 text-sm space-y-2"
                        >
                          <p className="font-medium text-ink-900">
                            {item.statement}
                          </p>
                          {itemImgs.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              {itemImgs.map((src) => (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  key={src.slice(0, 64)}
                                  src={src}
                                  alt=""
                                  className="h-20 w-auto rounded-lg border border-ink-100 object-cover"
                                />
                              ))}
                            </div>
                          )}
                          <p className="text-ink-600 leading-relaxed whitespace-pre-wrap">
                            {fc.explanation}
                          </p>
                          {uniqAnswers.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              {uniqAnswers.map((src) => (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  key={src.slice(0, 64)}
                                  src={src}
                                  alt=""
                                  className="h-24 w-auto rounded-lg border border-ink-100 object-cover"
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          </section>

          {video.report && (
            <div className="space-y-3">
              <div className="rounded-2xl border border-accent/30 bg-white shadow-sm p-4 sm:p-5 print:hidden">
                <h2 className="font-display text-lg sm:text-xl mb-3">
                  보고서 보기 · 수정 · 공유 · 저장
                </h2>
                <ReportActions video={video} />
              </div>
              <EditableReportPanel video={video} />
            </div>
          )}

          <InfographicPanel video={video} />
        </>
      )}

      {!awaiting && !ready && (
        <div className="rounded-2xl border border-ink-200 bg-white/80 p-5 text-center text-ink-600 text-sm">
          처리 중입니다… ({stageLabel})
        </div>
      )}
    </div>
  );
}
