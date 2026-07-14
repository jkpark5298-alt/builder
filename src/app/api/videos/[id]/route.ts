import { NextResponse } from "next/server";
import { factCheckProgress } from "@/lib/factcheck";
import { buildInfographic } from "@/lib/infographic";
import { finalizeReport } from "@/lib/process";
import { buildTypedReport } from "@/lib/report";
import { deleteVideo, getVideo, upsertVideo } from "@/lib/store";
import type { FactCheckResult, ReportType } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const video = await getVideo(id);
  if (!video) {
    return NextResponse.json({ error: "없음" }, { status: 404 });
  }
  return NextResponse.json({ video });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const ok = await deleteVideo(id);
  if (!ok) return NextResponse.json({ error: "없음" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const video = await getVideo(id);
  if (!video) {
    return NextResponse.json({ error: "없음" }, { status: 404 });
  }

  const body = (await req.json()) as {
    factCheck?: {
      itemId: string;
      verdict?: FactCheckResult["verdict"];
      explanation: string;
      sources?: string[];
    };
    reportType?: ReportType;
    draft?: boolean;
    /** 완료(ready) → 임시 저장(awaiting_factcheck)으로 되돌림 */
    reopenAsDraft?: boolean;
    completeManual?: boolean;
    rebuild?: boolean;
  };

  let next = { ...video };

  if (body.reopenAsDraft) {
    next = {
      ...next,
      status: "awaiting_factcheck",
      updatedAt: new Date().toISOString(),
    };
    await upsertVideo(next);
    return NextResponse.json({
      video: next,
      progress: factCheckProgress(next),
    });
  }

  if (body.reportType && ["H", "S", "C", "P"].includes(body.reportType)) {
    next = {
      ...next,
      reportType: body.reportType,
      updatedAt: new Date().toISOString(),
    };
  }

  if (body.factCheck) {
    if (!body.factCheck.explanation?.trim()) {
      return NextResponse.json(
        { error: "AI 답변·팩트체크 결과를 입력해 주세요." },
        { status: 400 }
      );
    }

    const fc: FactCheckResult = {
      itemId: body.factCheck.itemId,
      mode: "manual",
      verdict: body.factCheck.verdict ?? "unverifiable",
      explanation: body.factCheck.explanation.trim(),
      sources: body.factCheck.sources ?? [],
      checkedAt: new Date().toISOString(),
    };
    const others = next.factChecks.filter((f) => f.itemId !== fc.itemId);
    next = {
      ...next,
      factChecks: [...others, fc],
      updatedAt: new Date().toISOString(),
    };

    // 완료 항목을 수정하면 임시 저장으로 이동 (보고서 재생성은 다시 완료할 때)
    if (next.status === "ready") {
      next.status = "awaiting_factcheck";
    } else if (next.status !== "error") {
      next.status = "awaiting_factcheck";
    }
  }

  if (body.completeManual) {
    const progress = factCheckProgress(next);
    if (!progress.complete) {
      return NextResponse.json(
        {
          error: `아직 미완료 항목이 ${progress.total - progress.doneCount}건 있습니다.`,
          progress,
        },
        { status: 400 }
      );
    }
    next = await finalizeReport(next, body.reportType ?? next.reportType);
    return NextResponse.json({
      video: next,
      progress: factCheckProgress(next),
    });
  }

  if (body.rebuild && next.status === "ready") {
    next.report = buildTypedReport(next);
    next.infographic = buildInfographic(next);
    next.updatedAt = new Date().toISOString();
  }

  await upsertVideo(next);
  return NextResponse.json({
    video: next,
    progress: factCheckProgress(next),
  });
}
