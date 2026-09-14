import { HomeInputTabs } from "@/components/HomeInputTabs";
import { isReportInput, isYoutubeInput } from "@/lib/input-mode";
import { isComplete } from "@/lib/library";
import { slimVideoForList } from "@/lib/media-budget";
import { searchTopics, searchVideos } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();
  const videos = (await searchVideos(query)).map(slimVideoForList);
  const topics = await searchTopics(query);

  const youtubeItems = videos.filter(
    (v) => isYoutubeInput(v) && !isComplete(v)
  );
  const youtubeCompletedReports = videos.filter(
    (v) => isYoutubeInput(v) && isComplete(v)
  );
  const reportWorkItems = videos.filter(
    (v) => isReportInput(v) && !isComplete(v)
  );
  const completedReports = videos.filter(
    (v) => isReportInput(v) && isComplete(v)
  );

  // 검색 시: 유튜브·정보 보관소·작업 중·확정 전부 (최신순)
  const searchResults = query
    ? [...videos].sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      )
    : [];

  return (
    <HomeInputTabs
      youtubeItems={youtubeItems}
      youtubeCompletedReports={youtubeCompletedReports}
      reportWorkItems={reportWorkItems}
      completedReports={completedReports}
      topics={topics}
      searchQuery={query}
      searchResults={searchResults}
    />
  );
}
