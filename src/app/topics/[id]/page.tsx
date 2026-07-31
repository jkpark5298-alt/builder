import { TopicWorkspace } from "@/components/TopicWorkspace";
import { collectEntryTags } from "@/lib/tags";
import { getTopic, getVideo, readAllVideos } from "@/lib/store";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function TopicDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const topic = await getTopic(id);
  if (!topic) notFound();

  const entries = [];
  for (const entryId of topic.entryIds) {
    const v = await getVideo(entryId);
    if (v) entries.push(v);
  }

  const allVideos = await readAllVideos();
  const libraryCandidates = allVideos.filter(
    (v) => v.status !== "report_input_draft" && Boolean(v.overview?.trim())
  );

  return (
    <TopicWorkspace
      topic={topic}
      entries={entries}
      availableTags={collectEntryTags(entries)}
      libraryCandidates={libraryCandidates}
    />
  );
}
