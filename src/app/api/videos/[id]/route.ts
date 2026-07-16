import { NextResponse } from "next/server";
import { factCheckProgress } from "@/lib/factcheck";
import { buildInfographic } from "@/lib/infographic";
import {
  itemsFromManualOverview,
  syncFactCheckGuides,
} from "@/lib/pipeline";
import { finalizeReport } from "@/lib/process";
import { buildTypedReport } from "@/lib/report";
import { deleteVideo, getVideo, upsertVideo } from "@/lib/store";
import { buildFactCheckPrompt, normalizeAiAnswer } from "@/lib/text-format";
import type { FactCheckResult, ReportType, SummaryItem, TypedReport } from "@/lib/types";

function buildFactCheckGuide(statement: string, detail?: string): string {
  return buildFactCheckPrompt(statement, detail);
}

function applyItemEdit(
  item: SummaryItem,
  patch: { statement?: string; detail?: string | null }
): SummaryItem {
  const statement =
    typeof patch.statement === "string"
      ? patch.statement.trim()
      : item.statement;
  const detail =
    patch.detail === null
      ? undefined
      : typeof patch.detail === "string"
        ? patch.detail.trim() || undefined
        : item.detail;

  const guide = buildFactCheckGuide(statement, detail);
  const hasGuide = item.evidence.some((e) => e.sourceHint === "factcheck-guide");
  const evidence = hasGuide
    ? item.evidence.map((e) =>
        e.sourceHint === "factcheck-guide" ? { ...e, text: guide } : e
      )
    : [...item.evidence, { text: guide, sourceHint: "factcheck-guide" }];

  return {
    ...item,
    statement,
    detail,
    evidence,
  };
}

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
      answerImageUrl?: string;
    };
    reportType?: ReportType;
    draft?: boolean;
    /** 완료(ready) → 임시 저장(awaiting_factcheck)으로 되돌림 */
    reopenAsDraft?: boolean;
    completeManual?: boolean;
    rebuild?: boolean;
    itemImage?: { itemId: string; imageUrl: string | null };
    /** 팩트체크 대상(주장) 문구 수정 */
    updateItem?: {
      itemId: string;
      statement?: string;
      detail?: string | null;
    };
    /** 팩트체크 대상 삭제 */
    deleteItem?: { itemId: string };
    /** AI 답변 참고 이미지 */
    answerImage?: { itemId: string; imageUrl: string | null };
    /** 보고서 직접 수정 */
    updateReport?: TypedReport;
    /** 유튜브 내용 요약 수동 저장 */
    updateOverview?: {
      overview: string;
      summaryBullets?: string[];
    };
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

  if (body.itemImage?.itemId) {
    next = {
      ...next,
      items: next.items.map((item) =>
        item.id === body.itemImage!.itemId
          ? {
              ...item,
              imageUrl: body.itemImage!.imageUrl || undefined,
            }
          : item
      ),
      updatedAt: new Date().toISOString(),
    };
    if (next.status === "ready") {
      next.report = buildTypedReport(next);
      next.infographic = await buildInfographic(next);
    }
  }

  if (body.updateItem?.itemId) {
    const target = next.items.find((i) => i.id === body.updateItem!.itemId);
    if (!target) {
      return NextResponse.json(
        { error: "수정할 팩트체크 대상이 없습니다." },
        { status: 404 }
      );
    }
    if (
      typeof body.updateItem.statement === "string" &&
      !body.updateItem.statement.trim()
    ) {
      return NextResponse.json(
        { error: "팩트체크 대상 주장을 입력해 주세요." },
        { status: 400 }
      );
    }

    const updated = applyItemEdit(target, body.updateItem);
    next = {
      ...next,
      items: next.items.map((item) =>
        item.id === updated.id ? updated : item
      ),
      factChecks: next.factChecks.map((fc) => {
        if (fc.itemId !== updated.id) return fc;
        // 아직 답변 전(질문만 있는) 항목이면 가이드도 맞춤
        if (
          !fc.explanation.trim() ||
          (/^다음 주장을/.test(fc.explanation) &&
            /팩트체크해 주세요/.test(fc.explanation))
        ) {
          return {
            ...fc,
            explanation: buildFactCheckGuide(updated.statement, updated.detail),
          };
        }
        return fc;
      }),
      updatedAt: new Date().toISOString(),
      status:
        next.status === "ready" || next.status === "awaiting_factcheck"
          ? "awaiting_factcheck"
          : next.status,
    };
  }

  if (body.deleteItem?.itemId) {
    const itemId = body.deleteItem.itemId;
    if (!next.items.some((i) => i.id === itemId)) {
      return NextResponse.json(
        { error: "삭제할 팩트체크 대상이 없습니다." },
        { status: 404 }
      );
    }
    next = {
      ...next,
      items: next.items.filter((i) => i.id !== itemId),
      factChecks: next.factChecks.filter((f) => f.itemId !== itemId),
      updatedAt: new Date().toISOString(),
      status:
        next.status === "ready" || next.status === "awaiting_factcheck"
          ? "awaiting_factcheck"
          : next.status,
    };
  }

  if (body.answerImage?.itemId) {
    next = {
      ...next,
      factChecks: next.factChecks.map((fc) =>
        fc.itemId === body.answerImage!.itemId
          ? {
              ...fc,
              answerImageUrl: body.answerImage!.imageUrl || undefined,
            }
          : fc
      ),
      updatedAt: new Date().toISOString(),
    };
    if (next.status === "ready") {
      next.report = buildTypedReport(next);
      next.infographic = await buildInfographic(next);
    }
  }

  if (body.updateReport) {
    next = {
      ...next,
      report: body.updateReport,
      updatedAt: new Date().toISOString(),
    };
    next.infographic = await buildInfographic(next);
  }

  if (typeof body.updateOverview?.overview === "string") {
    const overview = body.updateOverview.overview.trim();
    if (overview.length < 40) {
      return NextResponse.json(
        { error: "요약을 조금 더 자세히 입력해 주세요. (40자 이상)" },
        { status: 400 }
      );
    }
    // 인포그래픽/LLM 재생성 없이 즉시 저장 (느린 원인 제거)
    const parsed = itemsFromManualOverview(overview, next.videoId);
    const bullets =
      body.updateOverview.summaryBullets?.filter((b) => b.trim()) ??
      (parsed.summaryBullets.length
        ? parsed.summaryBullets
        : overview
            .split(/\n+/)
            .map((l) => l.trim())
            .filter((l) => /^\d+\.\s+/.test(l))
            .slice(0, 12));
    const items = parsed.items.length ? parsed.items : next.items;
    const factChecks = syncFactCheckGuides(items);
    next = {
      ...next,
      overview,
      summaryBullets: bullets,
      summarySource: "manual",
      items,
      factChecks,
      report: null,
      infographic: null,
      status: "awaiting_factcheck",
      errorMessage: undefined,
      updatedAt: new Date().toISOString(),
    };
    await upsertVideo(next);
    return NextResponse.json({
      video: next,
      progress: factCheckProgress(next),
    });
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
      explanation: normalizeAiAnswer(body.factCheck.explanation.trim()),
      sources: body.factCheck.sources ?? [],
      checkedAt: new Date().toISOString(),
      answerImageUrl:
        body.factCheck.answerImageUrl ??
        next.factChecks.find((f) => f.itemId === body.factCheck!.itemId)
          ?.answerImageUrl,
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
    next.infographic = await buildInfographic(next);
    next.updatedAt = new Date().toISOString();
  }

  await upsertVideo(next);
  return NextResponse.json({
    video: next,
    progress: factCheckProgress(next),
  });
}
