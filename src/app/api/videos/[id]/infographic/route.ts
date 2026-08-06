import { NextResponse } from "next/server";
import { getVideo, upsertVideo } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/**
 * 레거시 SVG가 있으면 그대로 제공. 없으면 자동 생성하지 않음.
 * (인포는 붙여넣기·사진첩 이미지 = infographicBridgeImages)
 */
export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const video = await getVideo(id);
  if (!video) {
    return NextResponse.json({ error: "없음" }, { status: 404 });
  }

  const url = new URL(req.url);
  const download = url.searchParams.get("download") === "1";

  const bridge = Array.isArray(video.infographicBridgeImages)
    ? video.infographicBridgeImages.filter(Boolean)
    : [];
  if (bridge.length) {
    // 첫 이미지로 리다이렉트 (다운로드·미리보기용)
    const target = bridge[0]!;
    if (target.startsWith("http") || target.startsWith("/")) {
      return NextResponse.redirect(new URL(target, req.url), 302);
    }
  }

  if (video.infographic?.svgMarkup?.trim()) {
    return new NextResponse(video.infographic.svgMarkup, {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="infographic-${video.videoId}.svg"`,
        "Cache-Control": "private, max-age=60",
      },
    });
  }
  if (video.infographic?.svgUrl) {
    return NextResponse.redirect(
      new URL(video.infographic.svgUrl, req.url),
      302
    );
  }

  return NextResponse.json(
    {
      error:
        "인포그래픽 이미지가 없습니다. 보고서에서 붙여넣기·사진첩으로 추가하세요.",
      bridgeCount: bridge.length,
    },
    { status: 404 }
  );
}

/** 이미지 목록 저장 · 공유 채널 기록 (자동 SVG 생성 없음) */
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const video = await getVideo(id);
  if (!video) {
    return NextResponse.json({ error: "없음" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    channel?: "email" | "kakao" | "goodnotes";
    /** string[] = 수동 지정 / null = 비움 */
    bridgeImages?: string[] | null;
  };

  let next = video;
  if (body.bridgeImages !== undefined) {
    next = {
      ...next,
      infographicBridgeImages: Array.isArray(body.bridgeImages)
        ? body.bridgeImages
            .filter(
              (u): u is string => typeof u === "string" && Boolean(u.trim())
            )
            .slice(0, 12)
        : [],
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
    tags: tag ? Array.from(new Set([...next.tags, tag])) : next.tags,
  };
  const saved = await upsertVideo(updated);
  return NextResponse.json({ video: saved, channel: body.channel ?? null });
}
