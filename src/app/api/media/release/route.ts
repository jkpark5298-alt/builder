import { NextResponse } from "next/server";
import {
  collectMediaUrlsFromValue,
  purgeUnreferencedMediaUrls,
} from "@/lib/media-gc";
import { readAllVideos } from "@/lib/store";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 룸/슬롯에서 제거된 URL이 다른 영상·필드에서 안 쓰이면 파일 삭제.
 * body: { urls: string[] }
 */
export async function POST(req: Request) {
  const rate = await checkRateLimit(req, "media-release", 30, 60_000);
  if (!rate.ok) {
    return NextResponse.json(
      { error: `요청이 너무 많습니다. ${rate.retryAfter}초 후 다시 시도해 주세요.` },
      { status: 429 }
    );
  }

  let body: { urls?: string[] } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "JSON 본문이 필요합니다." }, { status: 400 });
  }

  const urls = (body.urls ?? []).map((u) => u.trim()).filter(Boolean);
  if (!urls.length) {
    return NextResponse.json({ ok: true, deleted: 0, skipped: 0 });
  }

  try {
    const videos = await readAllVideos();
    const referenced = collectMediaUrlsFromValue(videos);
    const result = await purgeUnreferencedMediaUrls(urls, referenced);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[media/release]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
