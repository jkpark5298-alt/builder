import { HomeInputTabs } from "@/components/HomeInputTabs";
import { ImageLibraryPanel } from "@/components/ImageLibraryPanel";
import { SearchBar } from "@/components/SearchBar";
import { TopicListCard } from "@/components/TopicListCard";
import { VideoListCard } from "@/components/VideoListCard";
import {
  isComplete,
  isFactCheckDraft,
  isReportPending,
} from "@/lib/library";
import { readAllLibraryImages, searchLibraryImages } from "@/lib/image-library-store";
import { searchTopics, searchVideos } from "@/lib/store";
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
  const topics = await searchTopics(q ?? "");
  const libraryImages = q?.trim()
    ? await searchLibraryImages(q)
    : await readAllLibraryImages();
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
              주제(#태그) → 이미지 → 임시 저장 → <strong>작성 대기</strong> →{" "}
              <strong>보고서</strong>
            </p>
          </div>
          <div className="sm:w-96">
            <SearchBar
              initialQuery={q ?? ""}
              placeholder="주제·태그·제목·팩트체크 검색…"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2 text-sm">
          <a
            href="#topics"
            className="rounded-lg border border-ink-300 bg-ink-50 px-3 py-1.5 text-ink-800 hover:border-accent"
          >
            주제 {topics.length}
          </a>
          <a
            href="#images"
            className="rounded-lg border border-ink-300 bg-ink-50 px-3 py-1.5 text-ink-800 hover:border-accent"
          >
            이미지 {libraryImages.length}
          </a>
          <a
            href="#drafts"
            className="rounded-lg border border-accent/40 bg-accent-muted/50 px-3 py-1.5 text-accent hover:bg-accent-muted"
          >
            임시 저장 {drafts.length}
          </a>
          <a
            href="#pending"
            className="rounded-lg border border-ink-300 bg-ink-50 px-3 py-1.5 text-ink-800 hover:border-accent"
          >
            작성 대기 {reportPending.length}
          </a>
          <a
            href="#reports"
            className="rounded-lg border border-ink-300 bg-ink-50 px-3 py-1.5 text-ink-800 hover:border-accent"
          >
            보고서 {reportComplete.length}
          </a>
        </div>
      </section>

      <section id="topics" className="space-y-4 scroll-mt-24">
        <div>
          <h3 className="font-display text-xl text-ink-900">주제</h3>
          <p className="text-sm text-ink-500 mt-1">
            항목을 모아 두고 <strong>#태그</strong>로 골라 통합 보고서를
            만듭니다.
          </p>
        </div>
        {topics.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-ink-300 bg-white/50 px-6 py-12 text-center">
            <p className="font-display text-lg text-ink-700">주제가 없습니다</p>
            <p className="text-ink-500 mt-2 text-sm">
              위 「주제」 탭에서 「역사 팩트 체크」처럼 만들어 보세요.
            </p>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {topics.map((t) => (
              <TopicListCard key={t.id} topic={t} />
            ))}
          </div>
        )}
      </section>

      <section id="images" className="space-y-4 scroll-mt-24">
        <div>
          <h3 className="font-display text-xl text-ink-900">이미지</h3>
          <p className="text-sm text-ink-500 mt-1">
            저장·메모·삭제. FC에는 붙이지 않고, <strong>보고서</strong>에서만
            불러 씁니다.
          </p>
        </div>
        <ImageLibraryPanel initialImages={libraryImages} />
      </section>

      <section id="drafts" className="space-y-4 scroll-mt-24">
        <div>
          <h3 className="font-display text-xl text-ink-900">임시 저장</h3>
          <p className="text-sm text-ink-500 mt-1">
            팩트체크·입력이 아직 끝나지 않은 항목입니다.
          </p>
        </div>
        <VideoGrid
          videos={drafts}
          listKind="draft"
          emptyTitle="임시 저장 항목이 없습니다"
          emptyHint="유튜브·Report 생성 후 팩트체크 전 항목이 여기에 남습니다."
        />
      </section>

      <section id="pending" className="space-y-4 scroll-mt-24">
        <div>
          <h3 className="font-display text-xl text-ink-900">작성 대기</h3>
          <p className="text-sm text-ink-500 mt-1">
            팩트체크가 끝났습니다. <strong>보고서 만들기</strong>를 누르면
            보고서로 이동합니다.
          </p>
        </div>
        <VideoGrid
          videos={reportPending}
          listKind="report-pending"
          emptyTitle="작성 대기 항목이 없습니다"
          emptyHint="팩트체크를 모두 마치면 여기로 옵니다."
        />
      </section>

      <section id="reports" className="space-y-4 scroll-mt-24">
        <div>
          <h3 className="font-display text-xl text-ink-900">보고서</h3>
          <p className="text-sm text-ink-500 mt-1">
            만들어진 보고서입니다. 보기·본문·팩트체크·공유·PDF를 사용할 수
            있습니다.
          </p>
        </div>
        <VideoGrid
          videos={reportComplete}
          listKind="report-complete"
          emptyTitle="보고서가 없습니다"
          emptyHint="작성 대기에서 «보고서 만들기»를 누르면 여기로 옵니다."
        />
      </section>
    </div>
  );
}
