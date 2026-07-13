import { NextResponse } from "next/server";
import { createAndProcessVideo } from "@/lib/process";
import { readAllVideos, searchVideos } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";
  const videos = q ? searchVideos(q) : readAllVideos();
  return NextResponse.json({ videos });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      youtubeUrl?: string;
      creatorNotes?: string;
      pastedScript?: string;
    };
    if (!body.youtubeUrl?.trim()) {
      return NextResponse.json(
        { error: "youtubeUrl이 필요합니다." },
        { status: 400 }
      );
    }
    const video = await createAndProcessVideo(
      body.youtubeUrl.trim(),
      body.creatorNotes?.trim() || undefined,
      body.pastedScript?.trim() || undefined
    );
    return NextResponse.json({
      video,
      scriptNotice: video.scriptNotice,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "처리 실패";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
