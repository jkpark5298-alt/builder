import { UrlPasteForm } from "@/components/UrlPasteForm";
import { SearchBar } from "@/components/SearchBar";
import { VideoCard } from "@/components/VideoCard";
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
  emptyTitle,
  emptyHint,
}: {
  videos: VideoRecord[];
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
        <VideoCard key={v.id} video={v} />
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
  const reports = videos.filter(isReportPending);
  const completed = videos.filter(isComplete);

  return (
    <div className="space-y-10">
      <UrlPasteForm />

      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl text-ink-900">라이브러리</h2>
            <p className="text-sm text-ink-500 mt-1">
              <strong>임시 저장</strong>(팩트체크 진행) →{" "}
              <strong>보고서 작성</strong>(팩트체크 완료) →{" "}
              <strong>완료</strong>
            </p>
          </div>
          <div className="sm:w-96">
            <SearchBar initialQuery={q ?? ""} />
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
            보고서 작성 {reports.length}
          </a>
          <a
            href="#completed"
            className="rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-ink-700 hover:border-accent"
          >
            완료 {completed.length}
          </a>
        </div>
      </section>

      <section id="drafts" className="space-y-4 scroll-mt-24">
        <div>
          <h3 className="font-display text-xl text-ink-900">1. 임시 저장</h3>
          <p className="text-sm text-ink-500 mt-1">
            팩트체크를 이어서 진행할 수 있는 항목입니다.
          </p>
        </div>
        <VideoGrid
          videos={drafts}
          emptyTitle="임시 저장된 항목이 없습니다"
          emptyHint="유튜브 링크를 추가하거나, 완료 항목을 «수정 필요»로 되돌리면 여기로 옵니다."
        />
      </section>

      <section id="reports" className="space-y-4 scroll-mt-24">
        <div>
          <h3 className="font-display text-xl text-ink-900">2. 보고서 작성</h3>
          <p className="text-sm text-ink-500 mt-1">
            팩트체크가 끝난 항목입니다. 열어 «보고서 작성 → PDF·인포그래픽
            생성»을 누르세요.
          </p>
        </div>
        <VideoGrid
          videos={reports}
          emptyTitle="보고서 작성 대기 항목이 없습니다"
          emptyHint="팩트체크 항목을 모두 저장하면 자동으로 이 목록으로 옵니다."
        />
      </section>

      <section id="completed" className="space-y-4 scroll-mt-24">
        <div>
          <h3 className="font-display text-xl text-ink-900">3. 완료</h3>
          <p className="text-sm text-ink-500 mt-1">
            보고서·인포그래픽까지 생성된 항목입니다.
          </p>
        </div>
        <VideoGrid
          videos={completed}
          emptyTitle="완료된 항목이 없습니다"
          emptyHint="보고서 작성 단계에서 PDF·인포그래픽을 만들면 여기로 옵니다."
        />
      </section>
    </div>
  );
}
