import { HomeInputTabs } from "@/components/HomeInputTabs";
import { SearchBar } from "@/components/SearchBar";
import { VideoListCard } from "@/components/VideoListCard";
import {
  isComplete,
  isFactCheckDraft,
  isReportPending,
} from "@/lib/library";
import { searchVideos } from "@/lib/store";
import type { VideoRecord } from "@/lib/types";

export const dynamic = "force-dynamic";

function VideoGrid({
  videos,
  listKind,
  emptyTitle,
  emptyHint,
}: {
  videos: VideoRecord[];
  listKind: "draft" | "report-pending" | "report-complete";
  emptyTitle: string;
  emptyHint: string;
}) {
  if (videos.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-ink-300 bg-white/50 px-6 py-12 text-center">
        <p className="font-display text-lg text-ink-700">{emptyTitle}</p>
        <p className="text-ink-500 mt-2 text-sm">{emptyHint}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {videos.map((v) => (
        <VideoListCard key={v.id} video={v} listKind={listKind} />
      ))}
    </div>
  );
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const videos = await searchVideos(q ?? "");
  const drafts = videos.filter(isFactCheckDraft);
  const reportPending = videos.filter(isReportPending);
  const reportComplete = videos.filter(isComplete);

  return (
    <div className="space-y-10">
      <HomeInputTabs />

      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl text-ink-900">라이브러리</h2>
            <p className="text-sm text-ink-500 mt-1">
              <strong>임시 저장</strong>(팩트체크 미완료) →{" "}
              <strong>보고서 저장</strong>(팩트체크 완료 · PDF·공유)
            </p>
          </div>
          <div className="sm:w-96">
            <SearchBar
              initialQuery={q ?? ""}
              placeholder="보고서·제목·채널·주장·팩트체크 검색…"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2 text-sm">
          <a
            href="#drafts"
            className="rounded-lg border border-accent/40 bg-accent-muted/50 px-3 py-1.5 text-accent hover:bg-accent-muted"
          >
            임시 저장 {drafts.length}
          </a>
          <a
            href="#reports"
            className="rounded-lg border border-ink-300 bg-ink-50 px-3 py-1.5 text-ink-800 hover:border-accent"
          >
            보고서 저장 {reportPending.length + reportComplete.length}
          </a>
        </div>
      </section>

      <section id="drafts" className="space-y-4 scroll-mt-24">
        <div>
          <h3 className="font-display text-xl text-ink-900">
            1. 임시 저장 목록
          </h3>
          <p className="text-sm text-ink-500 mt-1">
            팩트체크·Report 입력 중인 항목입니다. 카드에서{" "}
            <strong>이어서 작성</strong> 또는 <strong>이어서 하기</strong>로
            이어갈 수 있습니다.
          </p>
        </div>
        <VideoGrid
          videos={drafts}
          listKind="draft"
          emptyTitle="임시 저장된 항목이 없습니다"
          emptyHint="유튜브·Report 생성 후 팩트체크 전, 또는 Report 제목·스크립트 입력 중인 항목이 여기에 남습니다."
        />
      </section>

      <section id="reports" className="space-y-6 scroll-mt-24">
        <div>
          <h3 className="font-display text-xl text-ink-900">
            2. 보고서 저장 목록
          </h3>
          <p className="text-sm text-ink-500 mt-1">
            팩트체크가 완료된 항목입니다. 저장 완료 카드에서{" "}
            <strong>보기</strong>·<strong>수정</strong>·
            <strong>공유</strong>·<strong>PDF 저장</strong>·
            <strong>인쇄</strong>를 사용할 수 있습니다.
          </p>
        </div>

        <div className="space-y-3">
          <h4 className="text-sm font-medium text-ink-800">
            작성 대기 ({reportPending.length})
          </h4>
          <VideoGrid
            videos={reportPending}
            listKind="report-pending"
            emptyTitle="보고서 작성 대기 항목이 없습니다"
            emptyHint="팩트체크를 모두 마치면 여기로 옮겨집니다."
          />
        </div>

        <div className="space-y-3">
          <h4 className="text-sm font-medium text-ink-800">
            저장 완료 · 보기·PDF·공유 ({reportComplete.length})
          </h4>
          <VideoGrid
            videos={reportComplete}
            listKind="report-complete"
            emptyTitle="저장 완료된 보고서가 없습니다"
            emptyHint="«보고서 저장 → PDF·인포그래픽»을 누르면 저장 완료로 오고, 바로 보고서 보기 화면으로 이동합니다."
          />
        </div>
      </section>
    </div>
  );
}
