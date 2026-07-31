import { randomUUID } from "crypto";
import type { ReportType, Topic } from "./types";
import { upsertTopic } from "./store";
import { normalizeTag, themeTagFromTitle } from "./tags";

export async function createTopic(input: {
  title: string;
  description?: string;
  themeTag?: string;
  reportType?: ReportType;
}): Promise<Topic> {
  const title = input.title.trim();
  if (!title) throw new Error("주제 제목을 입력해 주세요.");
  const now = new Date().toISOString();
  const themeTag =
    normalizeTag(input.themeTag ?? "") || themeTagFromTitle(title);
  const topic: Topic = {
    id: randomUUID(),
    title,
    description: input.description?.trim() || undefined,
    themeTag,
    entryIds: [],
    selectedComposeTags: themeTag ? [themeTag] : [],
    reportType:
      input.reportType && ["H", "S", "C", "P"].includes(input.reportType)
        ? input.reportType
        : "H",
    report: null,
    status: "draft",
    createdAt: now,
    updatedAt: now,
  };
  return upsertTopic(topic);
}
