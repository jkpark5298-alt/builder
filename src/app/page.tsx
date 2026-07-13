import { UrlPasteForm } from "@/components/UrlPasteForm";
import { SearchBar } from "@/components/SearchBar";
import { VideoCard } from "@/components/VideoCard";
import { searchVideos } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const videos = await searchVideos(q ?? "");

  return (
    <div className="space-y-10">
      <UrlPasteForm />

      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl text-ink-900">라이브러리</h2>
            <p className="text-sm text-ink-500 mt-1">
              저장된 요약·보고서·인포그래픽을 검색하고 다시 엽니다.
            </p>
          </div>
          <div className="sm:w-96">
            <SearchBar initialQuery={q ?? ""} />
          </div>
        </div>

        {videos.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-ink-300 bg-white/50 px-6 py-16 text-center">
            <p className="font-display text-xl text-ink-700">아직 항목이 없습니다</p>
            <p className="text-ink-500 mt-2 text-sm">
              위쪽에 유튜브 링크를 붙여넣어 첫 요약을 만들어 보세요.
            </p>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {videos.map((v) => (
              <VideoCard key={v.id} video={v} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
