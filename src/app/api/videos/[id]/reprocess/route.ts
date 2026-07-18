import { NextResponse } from "next/server";
import { prepareReprocess, runVideoPipeline } from "@/lib/process";
import { getVideo, storageMode } from "@/lib/store";
import { hasLlm } from "@/lib/pipeline";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

type Ctx = { params: Promise<{ id: string }> };

/** 같은 영상 ID로 재요약. 상세 요약이 끝날 때까지 대기(최대 ~3분). */
export async function POST(req: Request, ctx: Ctx) {
  const rate = await checkRateLimit(req, "video-reprocess", 4, 10 * 60_000);
  if (!rate.ok) {
    return NextResponse.json(
      { error: `요청이 너무 많습니다. ${rate.retryAfter}초 후 다시 시도해 주세요.` },
      {
        status: 429,
        headers: { "Retry-After": String(rate.retryAfter) },
      }
    );
  }
  const { id } = await ctx.params;
  const existing = await getVideo(id);
  if (!existing) {
    return NextResponse.json({ error: "없음" }, { status: 404 });
  }

  try {
    if (!hasLlm()) {
      return NextResponse.json(
        {
          error:
            "OPENAI_API_KEY가 없어 상세 요약을 할 수 없습니다. .env.local에 키를 넣고 개발 서버를 재시작하세요.",
        },
        { status: 400 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as {
      pastedScript?: string;
    };

    const prepared = await prepareReprocess(id, body.pastedScript);
    const video = await runVideoPipeline(
      prepared.video.id,
      prepared.creatorNotes,
      prepared.script
    );

    const weak =
      /OPENAI_API_KEY|발췌 메모|다시 시도/i.test(video.overview || "") ||
      (video.overview?.length ?? 0) < 350;

    return NextResponse.json({
      video,
      processing: false,
      storage: storageMode(),
      message: weak
        ? "재요약은 끝났지만 상세도가 낮습니다. 서버 로그의 LLM 오류를 확인하거나 다시 시도해 주세요."
        : `상세 재요약 완료 (${video.overview.length.toLocaleString()}자)`,
      weak,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "재분석 실패";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
