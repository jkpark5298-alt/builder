import { NextResponse } from "next/server";
import { extractVideoId } from "@/lib/youtube";
import { fetchYoutubeTranscriptAi } from "@/lib/youtube-transcript-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET /api/transcript?url=... | ?videoId=...  → youtube-transcript.ai 자막 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const url = searchParams.get("url")?.trim() || "";
    const videoIdParam = searchParams.get("videoId")?.trim() || "";
    const lang = searchParams.get("lang")?.trim() || undefined;

    const videoId =
      videoIdParam || (url ? extractVideoId(url) : null) || null;

    if (!videoId) {
      return NextResponse.json(
        {
          error:
            "유튜브 주소 또는 videoId가 필요합니다. ① 유튜브 주소를 먼저 넣어 주세요.",
        },
        { status: 400 }
      );
    }

    const result = await fetchYoutubeTranscriptAi(videoId, { lang });
    return NextResponse.json({
      videoId,
      transcript: result.text,
      length: result.text.length,
      langTried: result.langTried,
      source: "youtube-transcript.ai",
      sourceUrl: result.sourceUrl,
    });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "자막을 가져오지 못했습니다.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
