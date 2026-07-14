import { after, NextResponse } from "next/server";
import {
  createVideoJob,
  runVideoPipeline,
} from "@/lib/process";
import { hasUsablePastedScript, normalizePastedText } from "@/lib/paste";
import { readAllVideos, searchVideos, storageMode } from "@/lib/store";
import { extractVideoId } from "@/lib/youtube";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";
  const videos = q ? await searchVideos(q) : await readAllVideos();
  return NextResponse.json({ videos, storage: storageMode() });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      youtubeUrl?: string;
      creatorNotes?: string;
      pastedScript?: string;
    };
    const youtubeUrl = body.youtubeUrl?.trim();
    if (!youtubeUrl) {
      return NextResponse.json(
        { error: "youtubeUrl이 필요합니다." },
        { status: 400 }
      );
    }
    if (!extractVideoId(youtubeUrl)) {
      return NextResponse.json(
        { error: "유효한 유튜브 URL이 아닙니다." },
        { status: 400 }
      );
    }

    const creatorNotes = body.creatorNotes?.trim() || undefined;
    const pastedScript = hasUsablePastedScript(body.pastedScript)
      ? normalizePastedText(body.pastedScript!)
      : undefined;

    // 붙여넣은 스크립트: 저장·요약을 끝까지 기다린 뒤 이동 (404 방지)
    if (pastedScript) {
      const job = await createVideoJob(youtubeUrl);
      const video = await runVideoPipeline(job.id, creatorNotes, pastedScript);
      return NextResponse.json({
        video,
        processing: false,
        storage: storageMode(),
        scriptNotice: "붙여넣은 스크립트(텍스트)를 기준으로 요약합니다.",
      });
    }

    const video = await createVideoJob(youtubeUrl);

    after(async () => {
      try {
        await runVideoPipeline(video.id, creatorNotes, undefined);
      } catch {
        /* status saved in pipeline */
      }
    });

    return NextResponse.json({
      video,
      processing: true,
      storage: storageMode(),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "처리 실패";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
