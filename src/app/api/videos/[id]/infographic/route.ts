import { NextResponse } from "next/server";
import { getVideo, upsertVideo } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const video = await getVideo(id);
  if (!video?.infographic) {
    return NextResponse.json({ error: "인포그래픽 없음" }, { status: 404 });
  }
  return new NextResponse(video.infographic.svgMarkup, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Content-Disposition": `inline; filename="infographic-${video.videoId}.svg"`,
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
    channel?: "email" | "kakao";
  };
  const updated = {
    ...video,
    sharedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tags: Array.from(
      new Set([...video.tags, body.channel === "kakao" ? "shared-kakao" : "shared-email"])
    ),
  };
  await upsertVideo(updated);
  return NextResponse.json({ video: updated, channel: body.channel ?? "email" });
}
