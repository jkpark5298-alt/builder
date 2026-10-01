import { AiPasteInbox } from "@/components/AiPasteInbox";
import { ReportCreateForm } from "@/components/ReportCreateForm";
import { ThumbnailEditor } from "@/components/ThumbnailEditor";
import { getVideo, upsertVideo } from "@/lib/store";
import { ensureSkeletonReport } from "@/lib/report-skeleton";
import { applyFactCheckPass } from "@/lib/process";
import { ActionBar } from "@/components/ActionBar";
import { CollapsibleSummaryStep } from "@/components/CollapsibleSummaryStep";
import { EditableReportPanel } from "@/components/EditableReportPanel";
import { InfographicPanel } from "@/components/InfographicPanel";
import { PassReportConfirmBar } from "@/components/FactCheckDecisionPanel";
import { OverviewSummaryPanel } from "@/components/OverviewSummaryPanel";
import { PasteScriptPanel } from "@/components/PasteScriptPanel";
import { PrintOnLoad } from "@/components/PrintOnLoad";
import { ReprocessButton } from "@/components/ReprocessButton";
import { UserTagsEditor } from "@/components/UserTagsEditor";
import { SavedTranscriptPanel } from "@/components/SavedTranscriptPanel";
import { VideoProcessingPoller } from "@/components/VideoProcessingPoller";
import { VideoStepNav } from "@/components/VideoStepNav";
import { VideoNotFoundRecovery } from "@/components/VideoNotFoundRecovery";
import { isYoutubeInput, isUrlArticleInput } from "@/lib/input-mode";
import { archiveFlowLabel } from "@/lib/flow-steps";
import { libraryCardLabel, libraryStage } from "@/lib/library";
import { collectCoverCandidates } from "@/lib/report-inline-images";
import { formatTagList } from "@/lib/tags";

export const dynamic = "force-dynamic";

export default async function VideoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let video = await getVideo(id);
  if (!video) {
    return <VideoNotFoundRecovery id={id} />;
  }

  // 기존 팩트체크 진행 중 항목 → 요약·보고서 경로로 전환
  if (
    video.status === "awaiting_factcheck" &&
    video.overview.trim().length >= 40 &&
    video.skipFactCheck !== true &&
    video.factCheckDecision !== "pass"
  ) {
    try {
      video = await applyFactCheckPass(video);
    } catch {
      /* 요약 미완 등은 그대로 둠 */
    }
  }

  if (
    !video.report &&
    (isUrlArticleInput(video) ||
      (video.status === "awaiting_factcheck" &&
        video.overview.trim().length >= 40))
  ) {
    video = await upsertVideo(await ensureSkeletonReport(video));
  }

  if (video.status === "report_input_draft") {
    return (
      <div className="space-y-6 pb-24 sm:pb-8">
        <div className="rounded-xl border border-accent/30 bg-accent-muted/40 px-4 py-3 text-sm text-ink-700">
          <strong>입력 중</strong> — 내용을 고친 뒤 임시 저장을 선택하세요.
          저장하지 않고 나가면 확인 메시지가 나옵니다.
        </div>
        <ReportCreateForm
          draftId={video.id}
          savedAt={video.createdAt}
          initial={{
            title: video.title,
            bodyHtml:
              video.inputBodyHtml ||
              (video.transcript
                ? video.transcript
                    .replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;")
                    .replace(/\n/g, "<br>")
                : ""),
            sourceUrl: video.sourceUrl ?? "",
          }}
        />
      </div>
    );
  }

  const awaiting = video.status === "awaiting_factcheck";
  const ready = video.status === "ready";
  const showReportDraft = awaiting && Boolean(video.report);
  const stage = libraryStage(video);
  const stageLabel = libraryCardLabel(video);
  const isYoutube = isYoutubeInput(video);
  const urlArticle = isUrlArticleInput(video);
  const isArchive = !isYoutube;
  const coverCandidates = collectCoverCandidates(video);
  const summaryStepLabel = isYoutube
    ? "2. 수동 요약"
    : urlArticle
      ? "2. 요약 (선택)"
      : "2. 수동 요약";

  return (
    <div className="space-y-6 sm:space-y-8 pb-24 sm:pb-8">
      <VideoProcessingPoller
        videoId={video.id}
        status={video.status}
        errorMessage={video.errorMessage}
      />
      <VideoStepNav
        videoId={video.id}
        isArchive={isArchive}
        current={ready ? "report" : "summary"}
        reportReady={ready || Boolean(video.report)}
        archivePhase={ready ? "done" : "report"}
      />

      {isYoutube && !ready && !video.report && video.overview.trim().length < 40 ? (
        <AiPasteInbox video={video} />
      ) : null}

      <section
        id="step-script"
        className={
          isArchive && !ready
            ? "space-y-3 print:hidden scroll-mt-24"
            : "grid gap-5 lg:grid-cols-[1.05fr_0.95fr] print:hidden scroll-mt-24"
        }
      >
        {isYoutube || ready ? (
          <ThumbnailEditor
            videoId={video.id}
            thumbnailUrl={video.thumbnailUrl}
            emphasize={ready}
            bodyImageUrls={coverCandidates}
          />
        ) : null}
        <div className="space-y-4">
          <div>
            <p className="text-sm text-accent font-medium">{video.channel}</p>
            <h1 className="font-display text-2xl sm:text-3xl text-ink-900 mt-1 leading-tight break-words">
              {video.title}
            </h1>
            {isYoutube ? (
              <a
                href={video.youtubeUrl}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-ink-500 hover:text-accent mt-2 inline-block break-all"
              >
                {video.youtubeUrl}
              </a>
            ) : video.sourceUrl ? (
              <a
                href={video.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-ink-500 hover:text-accent mt-2 inline-block break-all"
              >
                {video.sourceUrl}
              </a>
            ) : (
              <p className="text-sm text-ink-400 mt-2">정보 보관소 · 직접 입력</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-ink-500">
            <span className="rounded-md bg-white border border-ink-200 px-2 py-1">
              {isYoutube
                ? "유튜브"
                : urlArticle
                  ? "정보 보관소 · URL"
                  : "정보 보관소"}
            </span>
            {(isYoutube || ready) && !!video.userTags?.length && (
              <span className="rounded-md bg-accent-muted/60 border border-accent/30 px-2 py-1 text-accent">
                {formatTagList(video.userTags)}
              </span>
            )}
            {isYoutube ? (
              <>
                <span className="rounded-md bg-white border border-ink-200 px-2 py-1">
                  스크립트:{" "}
                  {video.transcriptSource === "pasted"
                    ? "붙여넣은 스크립트"
                    : video.transcriptSource === "web"
                      ? "웹 본문"
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
                    ? "임시 저장 · 요약 입력"
                    : stage === "report_pending"
                      ? "작성 대기"
                      : stageLabel}
                </span>
              </>
            ) : null}
          </div>
          {isYoutube || ready ? (
            <UserTagsEditor videoId={video.id} initialTags={video.userTags} />
          ) : null}
          {isYoutube && video.scriptNotice ? (
            <div className="rounded-xl border border-accent/30 bg-accent-muted/50 px-3 py-2.5 text-sm text-ink-800">
              {video.scriptNotice}
            </div>
          ) : null}
          {(video.transcriptSource === "creator_meta" ||
            video.transcriptSource === "none") &&
            isYoutube && (
              <PasteScriptPanel
                videoId={video.id}
                youtubeUrl={video.youtubeUrl}
              />
            )}
          {isYoutube ? (
            <>
              <div className="flex flex-wrap gap-2">
                <ReprocessButton videoId={video.id} skipFactCheck />
              </div>
              <SavedTranscriptPanel video={video} />
              <ActionBar video={video} />
            </>
          ) : ready ? (
            <ActionBar video={video} />
          ) : null}
        </div>
      </section>
      {ready && <PrintOnLoad />}

      {isYoutube ? (
        <div id="step-summary" className="scroll-mt-24">
          <CollapsibleSummaryStep
            title={summaryStepLabel}
            defaultCollapsed={Boolean(video.report)}
          >
            <OverviewSummaryPanel
              key={`${video.id}-${video.updatedAt}`}
              video={video}
            />
            {(video.transcriptSource === "creator_meta" ||
              video.transcriptSource === "none") && (
              <PasteScriptPanel
                videoId={video.id}
                youtubeUrl={video.youtubeUrl}
              />
            )}
          </CollapsibleSummaryStep>
        </div>
      ) : null}

      {showReportDraft && (
        <section
          id="report-draft"
          className="space-y-3 scroll-mt-20 print:hidden"
        >
          <div className="space-y-3">
            <EditableReportPanel video={video} draftPhase />
            {isArchive ? (
              <div
                id="report-confirm"
                className="scroll-mt-24 space-y-3 rounded-2xl border-2 border-amber-400 bg-amber-50/60 p-4 ring-2 ring-amber-300"
              >
                <p className="text-sm font-medium text-ink-900">
                  {archiveFlowLabel("confirm")} — 표지와 태그를 넣고 완료하세요.
                </p>
                <ThumbnailEditor
                  videoId={video.id}
                  thumbnailUrl={video.thumbnailUrl}
                  emphasize
                  bodyImageUrls={coverCandidates}
                />
                <UserTagsEditor
                  videoId={video.id}
                  initialTags={video.userTags}
                  themeHint="보관"
                />
                <PassReportConfirmBar video={video} />
              </div>
            ) : (
              <div id="report-confirm" className="scroll-mt-24">
                <PassReportConfirmBar video={video} />
              </div>
            )}
          </div>
        </section>
      )}

      {ready && video.report && (
        <div className="space-y-3">
          <EditableReportPanel video={video} />
        </div>
      )}

      {ready && (
        <div id="step-done" className="scroll-mt-24">
          <InfographicPanel video={video} />
        </div>
      )}

      {!awaiting && !ready && (
        <div className="rounded-2xl border border-ink-200 bg-white/80 p-5 text-center text-ink-600 text-sm">
          처리 중입니다… ({stageLabel})
        </div>
      )}
    </div>
  );
}
