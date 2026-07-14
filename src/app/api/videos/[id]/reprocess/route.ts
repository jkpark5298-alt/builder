import { after, NextResponse } from "next/server";
import {
  createVideoJob,
  runVideoPipeline,
} from "@/lib/process";
import { hasUsablePastedScript, normalizePastedText } from "@/lib/paste";
import { deleteVideo, getVideo } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/** Re-fetch YouTube meta + re-summarize. Body may include pastedScript. */
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const existing = await getVideo(id);
  if (!existing) {
    return NextResponse.json({ error: "없음" }, { status: 404 });
  }
  try {
    const body = (await req.json().catch(() => ({}))) as {
      pastedScript?: string;
    };

    const pastedScript = hasUsablePastedScript(body.pastedScript)
      ? normalizePastedText(body.pastedScript!)
      : existing.transcript &&
          hasUsablePastedScript(existing.transcript) &&
          existing.transcriptSource !== "creator_meta"
        ? existing.transcript
        : undefined;

    const creatorNotes = existing.description?.trim() || undefined;
    const youtubeUrl = existing.youtubeUrl;

    await deleteVideo(id);
    const video = await createVideoJob(youtubeUrl);

    after(async () => {
      try {
        await runVideoPipeline(video.id, creatorNotes, pastedScript);
      } catch {
        /* saved in pipeline */
      }
    });

    return NextResponse.json({ video, processing: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "재분석 실패";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
