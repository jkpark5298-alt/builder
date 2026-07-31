import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  composeTopicReport,
  collectEntryTags,
  selectEntriesByTags,
} from "@/lib/topic-compose";
import {
  deleteTopic,
  getTopic,
  getVideo,
  StorageConflictError,
  upsertTopic,
  upsertVideo,
} from "@/lib/store";
import { normalizeTagList } from "@/lib/tags";
import type { ReportType, Topic, TypedReport } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

async function loadTopicEntries(topic: Topic) {
  const entries = [];
  for (const entryId of topic.entryIds) {
    const v = await getVideo(entryId);
    if (v) entries.push(v);
  }
  return entries;
}

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const topic = await getTopic(id);
  if (!topic) {
    return NextResponse.json({ error: "없음" }, { status: 404 });
  }
  const entries = await loadTopicEntries(topic);
  return NextResponse.json({
    topic,
    entries,
    availableTags: collectEntryTags(entries),
  });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const rate = await checkRateLimit(req, "topic-delete", 10, 10 * 60_000);
  if (!rate.ok) {
    return NextResponse.json(
      { error: `요청이 너무 많습니다. ${rate.retryAfter}초 후 다시 시도해 주세요.` },
      { status: 429, headers: { "Retry-After": String(rate.retryAfter) } }
    );
  }
  const { id } = await ctx.params;
  const ok = await deleteTopic(id);
  if (!ok) return NextResponse.json({ error: "없음" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const rate = await checkRateLimit(req, "topic-patch", 60, 60_000);
  if (!rate.ok) {
    return NextResponse.json(
      { error: `요청이 너무 많습니다. ${rate.retryAfter}초 후 다시 시도해 주세요.` },
      { status: 429, headers: { "Retry-After": String(rate.retryAfter) } }
    );
  }
  try {
    return await patchTopic(req, ctx);
  } catch (e) {
    if (e instanceof StorageConflictError) {
      return NextResponse.json(
        {
          error:
            "다른 저장 작업이 먼저 반영되었습니다. 화면을 새로고침한 뒤 다시 저장해 주세요.",
          code: "STORAGE_CONFLICT",
        },
        { status: 409 }
      );
    }
    const msg = e instanceof Error ? e.message : "저장 실패";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

async function patchTopic(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const topic = await getTopic(id);
  if (!topic) {
    return NextResponse.json({ error: "없음" }, { status: 404 });
  }
  const expectedUpdatedAt = topic.updatedAt;

  let body: {
    title?: string;
    description?: string | null;
    themeTag?: string;
    reportType?: ReportType;
    selectedComposeTags?: string[];
    addEntryIds?: string[];
    removeEntryIds?: string[];
    /** 항목에 themeTag(+추가 태그)를 붙이며 주제에 연결 */
    linkEntry?: { entryId: string; userTags?: string[] };
    composeReport?: boolean;
    updateReport?: TypedReport;
  };

  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "요청 본문을 읽지 못했습니다." }, { status: 400 });
  }

  let next: Topic = { ...topic };

  if (typeof body.title === "string" && body.title.trim()) {
    next.title = body.title.trim();
  }
  if (body.description === null) {
    next.description = undefined;
  } else if (typeof body.description === "string") {
    next.description = body.description.trim() || undefined;
  }
  if (typeof body.themeTag === "string" && body.themeTag.trim()) {
    next.themeTag = normalizeTagList([body.themeTag])[0] ?? next.themeTag;
  }
  if (body.reportType && ["H", "S", "C", "P"].includes(body.reportType)) {
    next.reportType = body.reportType;
  }
  if (body.selectedComposeTags) {
    next.selectedComposeTags = normalizeTagList(body.selectedComposeTags);
  }

  if (body.addEntryIds?.length) {
    next.entryIds = Array.from(new Set([...next.entryIds, ...body.addEntryIds]));
  }
  if (body.removeEntryIds?.length) {
    const remove = new Set(body.removeEntryIds);
    next.entryIds = next.entryIds.filter((eid) => !remove.has(eid));
  }

  if (body.linkEntry?.entryId) {
    const entryId = body.linkEntry.entryId;
    const video = await getVideo(entryId);
    if (!video) {
      return NextResponse.json({ error: "연결할 항목이 없습니다." }, { status: 404 });
    }
    const mergedTags = normalizeTagList([
      ...(video.userTags ?? []),
      next.themeTag,
      ...(body.linkEntry.userTags ?? []),
    ]);
    await upsertVideo(
      {
        ...video,
        userTags: mergedTags,
        updatedAt: new Date().toISOString(),
      },
      video.updatedAt
    );
    next.entryIds = Array.from(new Set([...next.entryIds, entryId]));
  }

  if (body.updateReport) {
    next.report = body.updateReport;
    next.status = "ready";
  }

  if (body.composeReport) {
    const entries = await loadTopicEntries(next);
    const tags = next.selectedComposeTags;
    const matched = selectEntriesByTags(entries, tags);
    if (!matched.length) {
      return NextResponse.json(
        {
          error:
            "선택한 태그와 일치하는 항목이 없습니다. 태그를 고르거나 항목에 #태그를 달아 주세요.",
        },
        { status: 400 }
      );
    }
    next.report = composeTopicReport(next, entries, tags);
    next.status = "ready";
  }

  next.updatedAt = new Date().toISOString();
  const saved = await upsertTopic(next, expectedUpdatedAt);
  const entries = await loadTopicEntries(saved);
  return NextResponse.json({
    topic: saved,
    entries,
    availableTags: collectEntryTags(entries),
  });
}
