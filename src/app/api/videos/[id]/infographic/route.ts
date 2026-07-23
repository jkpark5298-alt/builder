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

  // /api/media — 로컬 파일 → Neon DB (Blob 중단 시 Neon에만 있음)
  if (url.startsWith("/api/media/")) {
    const key = url.slice("/api/media/".length);
    const { readLocalMedia } = await import("@/lib/media-store");
    const local = readLocalMedia(key);
    if (local) return local.buffer.toString("utf8");
    try {
      const { getNeonMedia } = await import("@/lib/neon-media");
      const neon = await getNeonMedia(key);
      if (neon) return neon.buffer.toString("utf8");
    } catch (e) {
      console.warn(`[infographic] neon read failed for ${videoId}`, e);
    }
    return null;
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
    /** null = 자동 수집으로 되돌림 / string[] = 수동 지정 */
    bridgeImages?: string[] | null;
  };

  let next = video;
  if (body.bridgeImages !== undefined) {
    next = {
      ...next,
      infographicBridgeImages: Array.isArray(body.bridgeImages)
        ? body.bridgeImages
            .filter((u): u is string => typeof u === "string" && Boolean(u.trim()))
            .slice(0, 6)
        : null,
      updatedAt: new Date().toISOString(),
    };
  }

  if (body.rebuild || !next.infographic || body.bridgeImages !== undefined) {
    const infographic = await buildInfographic(next);
    next = {
      ...next,
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
