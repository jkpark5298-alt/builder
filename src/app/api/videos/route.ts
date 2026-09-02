import { after, NextResponse } from "next/server";
import {
  createAndProcessReport,
  createManualOverviewJob,
  createVideoJob,
  runVideoPipeline,
  saveReportInputDraft,
  startReportFromDraft,
} from "@/lib/process";
import { hasUsablePastedScript, normalizePastedText } from "@/lib/paste";
import { readAllVideos, searchVideos, storageMode } from "@/lib/store";
import { extractVideoId } from "@/lib/youtube";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";
  const videos = q ? await searchVideos(q) : await readAllVideos();
  return NextResponse.json({ videos, storage: storageMode() });
}

export async function POST(req: Request) {
  const rate = await checkRateLimit(req, "video-create", 8, 10 * 60_000);
  if (!rate.ok) {
    return NextResponse.json(
      { error: `요청이 너무 많습니다. ${rate.retryAfter}초 후 다시 시도해 주세요.` },
      {
        status: 429,
        headers: { "Retry-After": String(rate.retryAfter) },
      }
    );
  }
  try {
    const body = (await req.json()) as {
      /** youtube (기본) | report | report_draft */
      mode?: "youtube" | "report" | "report_draft";
      youtubeUrl?: string;
      title?: string;
      channel?: string;
      creatorNotes?: string;
      pastedScript?: string;
      thumbnailUrl?: string;
      sourceUrl?: string;
      articleImages?: string[];
      /** AI 요약 건너뛰고 수동 요약 화면으로 */
      manualOverview?: boolean;
      /** 유튜브 팩트체크 pass — 검증 없이 바로 보고서 */
      skipFactCheck?: boolean;
    };

    if (body.mode === "report_draft") {
      const title = body.title?.trim();
      if (!title || title.length < 2) {
        return NextResponse.json(
          { error: "제목을 2자 이상 입력해 주세요." },
          { status: 400 }
        );
      }
      const video = await saveReportInputDraft({
        title,
        channel: body.channel?.trim(),
        pastedScript: body.pastedScript,
        creatorNotes: body.creatorNotes?.trim(),
        thumbnailUrl: body.thumbnailUrl?.trim(),
        sourceUrl: body.sourceUrl?.trim(),
        articleImages: body.articleImages,
      });
      return NextResponse.json({
        video,
        draft: true,
        storage: storageMode(),
      });
    }

    if (body.mode === "report") {
      const title = body.title?.trim();
      if (!title || title.length < 2) {
        return NextResponse.json(
          { error: "제목을 2자 이상 입력해 주세요." },
          { status: 400 }
        );
      }
      const pastedScript = normalizePastedText(body.pastedScript ?? "");
      const video = await createAndProcessReport({
        title,
        channel: body.channel?.trim(),
        pastedScript,
        creatorNotes: body.creatorNotes?.trim(),
        thumbnailUrl: body.thumbnailUrl?.trim(),
        sourceUrl: body.sourceUrl?.trim(),
        articleImages: body.articleImages,
        manualOverview: body.manualOverview === true,
      });
      const hasScript = hasUsablePastedScript(pastedScript);
      return NextResponse.json({
        video,
        processing: false,
        storage: storageMode(),
        scriptNotice: body.manualOverview
          ? "수동 요약 화면으로 열었습니다. 내용 요약에 직접 입력해 주세요."
          : hasScript
            ? body.sourceUrl
              ? "가져온 웹 본문을 기준으로 요약합니다."
              : "붙여넣은 스크립트를 기준으로 요약합니다."
            : "스크립트 없이 시작합니다. 내용 요약에 수동으로 입력해 주세요.",
      });
    }

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
    const skipFactCheck = body.skipFactCheck === true;

    if (body.manualOverview) {
      if (!pastedScript) {
        return NextResponse.json(
          {
            error:
              "수동 요약으로 시작하려면 ② 스크립트(자막)를 먼저 넣어 주세요.",
          },
          { status: 400 }
        );
      }
      const video = await createManualOverviewJob(youtubeUrl, pastedScript, {
        skipFactCheck,
      });
      return NextResponse.json({
        video,
        processing: false,
        storage: storageMode(),
        scriptNotice: skipFactCheck
          ? "AI 요약 없이 열었습니다. 요약란에 직접 입력한 뒤 완료를 누르면 바로 보고서를 만듭니다."
          : "AI 요약 없이 열었습니다. 요약란에 직접 입력한 뒤 완료를 누르세요.",
      });
    }

    // 붙여넣은 스크립트: 저장·요약을 끝까지 기다린 뒤 이동 (404 방지)
    if (pastedScript) {
      const job = await createVideoJob(youtubeUrl, { skipFactCheck });
      const video = await runVideoPipeline(job.id, creatorNotes, pastedScript);
      return NextResponse.json({
        video,
        processing: false,
        storage: storageMode(),
        scriptNotice: skipFactCheck
          ? "붙여넣은 스크립트를 기준으로 요약하고 바로 보고서를 만듭니다."
          : "붙여넣은 스크립트(텍스트)를 기준으로 요약합니다.",
      });
    }

    const video = await createVideoJob(youtubeUrl, { skipFactCheck });

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
