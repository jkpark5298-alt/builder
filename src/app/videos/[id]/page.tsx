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
import { VideoNotFoundRecovery } from "@/components/VideoNotFoundRecovery";
import { isYoutubeInput, isUrlArticleInput } from "@/lib/input-mode";
import { libraryCardLabel, libraryStage } from "@/lib/library";
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
          <strong>입력 중</strong> — 제목을 채운 뒤 임시 저장하거나, 스크립트
          없이도 요약을 시작하세요.
        </div>
        <ReportCreateForm
          draftId={video.id}
          initial={{
            title: video.title,
            channel:
              video.channel === "직접 입력" || video.channel === "웹 기사"
                ? ""
                : video.channel,
            creatorNotes: video.description ?? "",
            pastedScript: video.transcript ?? "",
            thumbnailUrl: video.thumbnailUrl?.startsWith("data:image/svg")
              ? ""
              : video.thumbnailUrl,
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
  const summaryStepLabel = isYoutube
    ? "자막·요약"
    : urlArticle
      ? "요약 (선택)"
      : "내용 요약";

  const stepItems = [
    {
      n: "1–4",
      t: "자막",
      on: true,
    },
    {
      n: "5–8",
      t: "요약",
      on: video.overview.trim().length >= 40 || awaiting || ready,
    },
    {
      n: "9–10",
      t: "보고서",
      on: ready || Boolean(video.report),
    },
  ];

  return (
    <div className="space-y-6 sm:space-y-8 pb-24 sm:pb-8">
      <VideoProcessingPoller
        videoId={video.id}
        status={video.status}
        errorMessage={video.errorMessage}
      />
      <ol className="grid grid-cols-3 gap-2 text-center text-xs sm:text-sm">
        {stepItems.map((s) => (
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

      {!ready && video.overview.trim().length < 40 ? (
        <AiPasteInbox video={video} />
      ) : null}

      <section className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr] print:hidden">
        <ThumbnailEditor
          videoId={video.id}
          thumbnailUrl={video.thumbnailUrl}
          emphasize={ready}
        />
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
                : video.sourceUrl
                  ? "정보 보관소 · URL"
                  : "정보 보관소"}
            </span>
            {!!video.userTags?.length && (
              <span className="rounded-md bg-accent-muted/60 border border-accent/30 px-2 py-1 text-accent">
                {formatTagList(video.userTags)}
              </span>
            )}
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
          </div>
          <UserTagsEditor videoId={video.id} initialTags={video.userTags} />
          {video.scriptNotice && (
            <div className="rounded-xl border border-accent/30 bg-accent-muted/50 px-3 py-2.5 text-sm text-ink-800">
              {video.scriptNotice}
            </div>
          )}
          {(video.transcriptSource === "creator_meta" ||
            video.transcriptSource === "none") &&
            isYoutube && (
              <PasteScriptPanel
                videoId={video.id}
                youtubeUrl={video.youtubeUrl}
              />
            )}
          <div className="flex flex-wrap gap-2">
            <ReprocessButton videoId={video.id} skipFactCheck />
          </div>
          <SavedTranscriptPanel video={video} />
          <ActionBar video={video} />
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

      <CollapsibleSummaryStep
        title={summaryStepLabel}
        defaultCollapsed={Boolean(video.report)}
      >
        <OverviewSummaryPanel
          key={`${video.id}-${video.updatedAt}`}
          video={video}
        />
        {(video.transcriptSource === "creator_meta" ||
          video.transcriptSource === "none") &&
          isYoutube && (
            <PasteScriptPanel
              videoId={video.id}
              youtubeUrl={video.youtubeUrl}
            />
          )}
      </CollapsibleSummaryStep>

      {showReportDraft && (
        <section
          id="report-draft"
          className="space-y-3 scroll-mt-20 print:hidden"
        >
          <PassReportConfirmBar video={video} />
          {video.reportWriteNotice ? (
            <div className="rounded-xl border border-ink-200 bg-white px-4 py-3 text-sm text-ink-700">
              {video.reportWriteNotice}
            </div>
          ) : null}
          <EditableReportPanel video={video} draftPhase />
        </section>
      )}

      {ready && video.report && (
        <div className="space-y-3">
          {video.reportWriteNotice ? (
            <div className="rounded-xl border border-accent/30 bg-accent-muted/40 px-4 py-3 text-sm text-ink-800 print:hidden">
              <span className="font-medium">
                {video.reportSource === "llm"
                  ? "글쓰기 AI"
                  : "내용 적응형 조립"}
              </span>
              {" — "}
              {video.reportWriteNotice}
            </div>
          ) : null}
          <EditableReportPanel video={video} />
        </div>
      )}

      {ready && <InfographicPanel video={video} />}

      {!awaiting && !ready && (
        <div className="rounded-2xl border border-ink-200 bg-white/80 p-5 text-center text-ink-600 text-sm">
          처리 중입니다… ({stageLabel})
        </div>
      )}
    </div>
  );
}
