import { notFound } from "next/navigation";
import { getVideo } from "@/lib/store";
import { ActionBar } from "@/components/ActionBar";
import { ManualFactCheckWizard } from "@/components/ManualFactCheckWizard";
import { PasteScriptPanel } from "@/components/PasteScriptPanel";
import { ReprocessButton } from "@/components/ReprocessButton";
import { ReopenAsDraftButton } from "@/components/ReopenAsDraftButton";
import { VideoProcessingPoller } from "@/components/VideoProcessingPoller";
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
  if (!video) notFound();

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

      <section className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
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
        </div>
      </section>

      <section
        id="general-summary"
        className="rounded-2xl border border-accent/30 bg-white shadow-sm overflow-hidden"
      >
        <div className="bg-accent px-4 sm:px-5 py-3.5">
          <h2 className="font-display text-xl sm:text-2xl text-white text-center sm:text-left">
            1. 유튜브 내용 요약
          </h2>
        </div>
        <div className="p-4 sm:p-5 space-y-3">
          <p className="text-xs text-ink-500">
            {video.transcriptSource === "pasted" ||
            video.transcriptSource === "youtube" ||
            video.transcriptSource === "youtube_auto" ||
            video.transcriptSource === "speech_text"
              ? "스크립트·방송 순서 기준 주요 내용 요약입니다."
              : "챕터·설명 기준 주요 내용 요약입니다. (스크립트 미확보)"}
          </p>
          <div className="text-ink-800 leading-relaxed whitespace-pre-wrap text-[15px]">
            {video.overview}
          </div>
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
          <section className="rounded-2xl border border-accent/30 bg-white shadow-sm overflow-hidden">
            <div className="bg-accent px-4 sm:px-5 py-3.5">
              <h2 className="font-display text-xl sm:text-2xl text-white text-center sm:text-left">
                2. 팩트체크 정리
              </h2>
            </div>
            <div className="p-4 sm:p-5 space-y-3">
              <p className="text-sm text-ink-600">
                이 항목은 <strong>완료</strong> 상태입니다. 내용을 고치려면{" "}
                <strong>수정 필요 → 임시 저장으로</strong>를 눌러 임시 저장
                목록으로 옮긴 뒤 다시 정리하세요.
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
                      return (
                        <div
                          key={item.id}
                          className="rounded-xl border border-ink-100 p-3 text-sm space-y-2"
                        >
                          <p className="font-medium text-ink-900">
                            {item.statement}
                          </p>
                          <p className="text-ink-600 leading-relaxed whitespace-pre-wrap">
                            {fc.explanation}
                          </p>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          </section>

          {video.report && (
            <section className="rounded-2xl border border-ink-200 bg-white/80 p-4 sm:p-5 space-y-5">
              <h2 className="font-display text-lg sm:text-xl">
                3. 보고서 ({video.report.reportTypeLabel})
              </h2>
              <div className="rounded-xl bg-ink-50 border border-ink-100 p-3 text-sm space-y-1">
                <p>
                  <span className="text-ink-500">영상 제목</span> ·{" "}
                  {video.report.meta.title}
                </p>
                <p>
                  <span className="text-ink-500">채널명</span> ·{" "}
                  {video.report.meta.channel}
                </p>
                <p className="break-all">
                  <span className="text-ink-500">링크</span> ·{" "}
                  {video.report.meta.url}
                </p>
                <p>
                  <span className="text-ink-500">작성일자</span> ·{" "}
                  {video.report.meta.writtenAt}
                </p>
              </div>

              {video.report.sections.map((sec) => (
                <div key={sec.heading}>
                  <h3 className="font-medium text-accent mb-2">{sec.heading}</h3>
                  <pre className="whitespace-pre-wrap text-sm text-ink-700 font-sans leading-relaxed">
                    {sec.body}
                  </pre>
                </div>
              ))}

              <div>
                <h3 className="font-medium text-accent mb-2">팩트체크 정리</h3>
                <div className="space-y-3">
                  {video.report.factChecks.map((fc, i) => (
                    <div
                      key={i}
                      className="rounded-xl border border-ink-100 p-3 text-sm space-y-2"
                    >
                      <div>
                        <p className="text-xs text-accent font-medium">
                          팩트체크 대상
                        </p>
                        <p className="font-medium text-ink-900 whitespace-pre-wrap">
                          {fc.statement}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-ink-500 font-medium">
                          AI 답변 · 팩트체크 결과
                        </p>
                        <p className="text-ink-600 leading-relaxed whitespace-pre-wrap">
                          {fc.checkGuide}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          <section className="rounded-2xl border border-ink-200 bg-white/80 p-4 sm:p-5">
            <h2 className="font-display text-lg sm:text-xl mb-3">
              4. 인포그래픽 · 저장 · 공유
            </h2>
            {video.infographic ? (
              <div
                className="overflow-x-auto rounded-xl border border-ink-100 bg-ink-50 [&_svg]:w-full [&_svg]:h-auto [&_svg]:min-w-[280px]"
                dangerouslySetInnerHTML={{
                  __html: video.infographic.svgMarkup.replace(
                    /^<\?xml[^>]*>\s*/i,
                    ""
                  ),
                }}
              />
            ) : (
              <p className="text-ink-500 text-sm">아직 생성되지 않았습니다.</p>
            )}
          </section>
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
