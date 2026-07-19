import { NextResponse } from "next/server";
import { buildInfographic } from "@/lib/infographic";
import { getVideo, upsertVideo } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

async function resolveSvgMarkup(
  videoId: string,
  infographic: NonNullable<Awaited<ReturnType<typeof getVideo>>>["infographic"]
): Promise<string | null> {
  if (!infographic) return null;
  if (infographic.svgMarkup?.trim()) return infographic.svgMarkup;

  const url = infographic.svgUrl;
  if (!url) return null;

  // 로컬 /api/media 는 파일 직접 읽기
  if (url.startsWith("/api/media/")) {
    const { readLocalMedia } = await import("@/lib/media-store");
    const key = url.slice("/api/media/".length);
    const file = readLocalMedia(key);
    return file ? file.buffer.toString("utf8") : null;
  }

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    console.warn(`[infographic] failed to fetch svgUrl for ${videoId}`);
    return null;
  }
}

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const video = await getVideo(id);
  if (!video) {
    return NextResponse.json({ error: "없음" }, { status: 404 });
  }
  if (video.status !== "ready" && !video.infographic && !video.report) {
    return NextResponse.json({ error: "인포그래픽 없음" }, { status: 404 });
  }

  const url = new URL(req.url);
  const download = url.searchParams.get("download") === "1";
  const forceRebuild = url.searchParams.get("rebuild") === "1";

  let infographic = video.infographic;
  let svg =
    !forceRebuild && infographic
      ? await resolveSvgMarkup(id, infographic)
      : null;

  if (forceRebuild || !svg) {
    if (video.status !== "ready" && !video.report) {
      return NextResponse.json({ error: "인포그래픽 없음" }, { status: 404 });
    }
    infographic = await buildInfographic(video);
    const saved = await upsertVideo({
      ...video,
      infographic,
      updatedAt: new Date().toISOString(),
    });
    infographic = saved.infographic;
    svg =
      (await resolveSvgMarkup(id, infographic)) ||
      infographic?.svgMarkup ||
      null;
  }

  if (!svg) {
    return NextResponse.json({ error: "인포그래픽 없음" }, { status: 404 });
  }

  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="infographic-${video.videoId}.svg"`,
      "Cache-Control": forceRebuild ? "no-store" : "private, max-age=60",
    },
  });
}

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const video = await getVideo(id);
  if (!video) {
    return NextResponse.json({ error: "없음" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    channel?: "email" | "kakao" | "goodnotes";
    rebuild?: boolean;
  };

  let next = video;
  if (body.rebuild || !video.infographic) {
    const infographic = await buildInfographic(video);
    next = {
      ...video,
      infographic,
      updatedAt: new Date().toISOString(),
    };
  }

  const tag =
    body.channel === "kakao"
      ? "shared-kakao"
      : body.channel === "goodnotes"
        ? "shared-goodnotes"
        : body.channel
          ? "shared-email"
          : null;

  const updated = {
    ...next,
    sharedAt: tag ? new Date().toISOString() : next.sharedAt,
    updatedAt: new Date().toISOString(),
    tags: tag
      ? Array.from(new Set([...next.tags, tag]))
      : next.tags,
  };
  const saved = await upsertVideo(updated);
  return NextResponse.json({ video: saved, channel: body.channel ?? null });
}
