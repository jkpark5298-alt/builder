import { HomeInputTabs } from "@/components/HomeInputTabs";
import { isReportInput, isYoutubeInput } from "@/lib/input-mode";
import { isComplete } from "@/lib/library";
import { searchTopics, searchVideos } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const videos = await searchVideos(q ?? "");
  const topics = await searchTopics(q ?? "");

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

  return (
    <HomeInputTabs
      youtubeItems={youtubeItems}
      youtubeCompletedReports={youtubeCompletedReports}
      reportWorkItems={reportWorkItems}
      completedReports={completedReports}
      topics={topics}
    />
  );
}
