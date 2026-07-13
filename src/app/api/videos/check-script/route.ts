import { NextResponse } from "next/server";
import { probeTranscriptAvailability } from "@/lib/transcript";
import { extractVideoId } from "@/lib/youtube";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 요약 시작 전 스크립트(자막) 존재 여부 확인 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { youtubeUrl?: string };
    if (!body.youtubeUrl?.trim()) {
      return NextResponse.json(
        { error: "youtubeUrl이 필요합니다." },
        { status: 400 }
      );
    }
    const videoId = extractVideoId(body.youtubeUrl.trim());
    if (!videoId) {
      return NextResponse.json(
        { error: "유효한 유튜브 URL이 아닙니다." },
        { status: 400 }
      );
    }
    const probe = await probeTranscriptAvailability(videoId);
    return NextResponse.json({ videoId, ...probe });
  } catch (e) {
    const message = e instanceof Error ? e.message : "확인 실패";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
