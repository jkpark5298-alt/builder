import { NextResponse } from "next/server";
import { buildInfographic } from "@/lib/infographic";
import { getVideo, upsertVideo } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const video = await getVideo(id);
  if (!video) {
    return NextResponse.json({ error: "없음" }, { status: 404 });
  }
  if (video.status !== "ready" && !video.infographic) {
    return NextResponse.json({ error: "인포그래픽 없음" }, { status: 404 });
  }

  // 항상 최신 레이아웃으로 재생성 (하단 잘림·서식 수정 반영)
  const infographic = await buildInfographic(video);
  await upsertVideo({
    ...video,
    infographic,
    updatedAt: new Date().toISOString(),
  });

  const download = new URL(req.url).searchParams.get("download") === "1";
  return new NextResponse(infographic.svgMarkup, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="infographic-${video.videoId}.svg"`,
      "Cache-Control": "no-store",
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
  if (body.rebuild) {
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
        : "shared-email";

  const updated = {
    ...next,
    sharedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tags: Array.from(new Set([...next.tags, tag])),
  };
  await upsertVideo(updated);
  return NextResponse.json({ video: updated, channel: body.channel ?? "email" });
}
