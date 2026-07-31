import { NextResponse } from "next/server";
import { factCheckProgress } from "@/lib/factcheck";
import { buildInfographic } from "@/lib/infographic";
import {
  rebuildFactChecksFromOverview,
  redraftPendingFactChecks,
} from "@/lib/pipeline";
import {
  finalizeReport,
  saveReportInputDraft,
  startReportFromDraft,
} from "@/lib/process";
import { hasUsablePastedScript, normalizePastedText } from "@/lib/paste";
import { reportBodyPlain } from "@/lib/report";
import { buildReportDocument } from "@/lib/report-write";
import {
  buildSkeletonReport,
  ensureSkeletonReport,
  SKELETON_REPORT_NOTICE,
} from "@/lib/report-skeleton";
import {
  deleteVideo,
  getVideo,
  StorageConflictError,
  upsertVideo,
} from "@/lib/store";
import { buildFactCheckPrompt, normalizeAiAnswer } from "@/lib/text-format";
import { normalizeImageUrls, splitPrimaryImage } from "@/lib/image-urls";
import type {
  AnswerPart,
  FactCheckResult,
  ReportType,
  SummaryItem,
  TypedReport,
  VideoRecord,
} from "@/lib/types";
import {
  pairAnswerParts,
  partsToExplanation,
  partsToImageUrls,
} from "@/lib/answer-parts";
import { slimVideoForClient } from "@/lib/media-budget";
import { checkRateLimit } from "@/lib/rate-limit";
import { reportThumbnailUrl } from "@/lib/input-mode";
import { thumbnailUrl as youtubeThumbnailUrl } from "@/lib/youtube";
import { afterIncrementalFactEdit } from "@/lib/factcheck-sync";
import { normalizeTagList } from "@/lib/tags";

function jsonVideo(next: VideoRecord, extra: Record<string, unknown> = {}) {
  return NextResponse.json({
    video: slimVideoForClient(next),
    progress: factCheckProgress(next),
    ...extra,
  });
}

function buildFactCheckGuide(statement: string, detail?: string): string {
  return buildFactCheckPrompt(statement, detail);
}

function applyItemEdit(
  item: SummaryItem,
  patch: {
    statement?: string;
    detail?: string | null;
    factCheckOptional?: boolean;
  }
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
  const factCheckOptional =
    patch.factCheckOptional !== undefined
      ? patch.factCheckOptional
      : item.factCheckOptional;

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
    factCheckOptional,
    evidence,
  };
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

type Ctx = { params: Promise<{ id: string }> };

function rateLimited(retryAfter: number) {
  return NextResponse.json(
    { error: `요청이 너무 많습니다. ${retryAfter}초 후 다시 시도해 주세요.` },
    { status: 429, headers: { "Retry-After": String(retryAfter) } }
  );
}

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const video = await getVideo(id);
  if (!video) {
    return NextResponse.json({ error: "없음" }, { status: 404 });
  }
  // 폴링은 상태만 — 전체 transcript/이미지 반복 전송 방지
  if (new URL(req.url).searchParams.get("poll") === "1") {
    return NextResponse.json({
      video: {
        id: video.id,
        status: video.status,
        errorMessage: video.errorMessage,
        updatedAt: video.updatedAt,
      },
    });
  }
  return NextResponse.json({ video: slimVideoForClient(video) });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const rate = await checkRateLimit(req, "video-delete", 10, 10 * 60_000);
  if (!rate.ok) return rateLimited(rate.retryAfter);
  const { id } = await ctx.params;
  const ok = await deleteVideo(id);
  if (!ok) return NextResponse.json({ error: "없음" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const rate = await checkRateLimit(req, "video-patch", 90, 60_000);
  if (!rate.ok) return rateLimited(rate.retryAfter);
  try {
    return await patchVideo(req, ctx);
  } catch (e) {
    console.error("[PATCH /api/videos/:id]", e);
    if (e instanceof StorageConflictError) {
      return NextResponse.json(
        {
          error:
            "다른 저장 작업이 먼저 반영되었습니다. 화면을 새로고침한 뒤 다시 저장해 주세요.",
          code: "STORAGE_CONFLICT",
        },
        { status: 409 }
      );
    }
    const msg = e instanceof Error ? e.message : "저장 실패";
    const tooLarge =
      /payload|body|too large|request entity|413|json/i.test(msg) ||
      (typeof msg === "string" && msg.length > 0 && /ENOMEM|heap/i.test(msg));
    return NextResponse.json(
      {
        error: tooLarge
          ? "이미지가 너무 커서 저장하지 못했습니다. 장 수를 줄이거나 다시 시도해 주세요."
          : msg || "저장 실패",
      },
      { status: tooLarge ? 413 : 500 }
    );
  }
}

async function patchVideo(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const video = await getVideo(id);
  if (!video) {
    return NextResponse.json({ error: "없음" }, { status: 404 });
  }
  const expectedUpdatedAt = video.updatedAt;

  let body: {
    factCheck?: {
      itemId: string;
      verdict?: FactCheckResult["verdict"];
      explanation: string;
      sources?: string[];
      answerImageUrl?: string;
      answerImageUrls?: string[];
      answerParts?: AnswerPart[];
    };
    reportType?: ReportType;
    /** Report 입력 임시 저장 필드 수정 */
    updateReportInput?: {
      title?: string;
      channel?: string;
      creatorNotes?: string;
      pastedScript?: string;
      thumbnailUrl?: string;
    };
    /** Report 입력 임시 저장 → 요약·검증 시작 */
    startReportPipeline?: boolean;
    /** 완료(ready) → 임시 저장(awaiting_factcheck)으로 되돌림 */
    reopenAsDraft?: boolean;
    /**
     * reopenAsDraft 시 완료 후 본문 처리.
     * true(기본): 본문 유지·FC만 반영 / false: 보고서 재작성
     */
    keepReportBody?: boolean;
    completeManual?: boolean;
    /** true면 필수 미완료 항목이 있어도 완료 1건 이상이면 보고서 생성 */
    allowPartialFactCheck?: boolean;
    /** 미완료 FC만 인앱 LLM 초안 재생성 */
    redraftFactChecks?: boolean;
    rebuild?: boolean;
    itemImage?: { itemId: string; imageUrl?: string | null; imageUrls?: string[] };
    itemImages?: { itemId: string; imageUrls: string[] };
    /** 팩트체크 답변(DETAIL)만 비우기 — 주장 제목 유지 */
    clearFactCheckDetail?: { itemId: string };
    /**
     * @deprecated ready면 서버가 항상 유지·미러 동기화. 클라이언트 호환용.
     */
    preserveReadyStatus?: boolean;
    /** 팩트체크 대상(주장) 문구 수정 */
    updateItem?: {
      itemId: string;
      statement?: string;
      detail?: string | null;
      factCheckOptional?: boolean;
    };
    /** 팩트체크 대상 삭제 */
    deleteItem?: { itemId: string };
    /** AI 답변 참고 이미지 */
    answerImage?: { itemId: string; imageUrl?: string | null; imageUrls?: string[] };
    answerImages?: {
      itemId: string;
      imageUrls: string[];
      answerParts?: AnswerPart[];
    };
    /** 보고서 직접 수정 */
    updateReport?: TypedReport;
    /** 유튜브 내용 요약 수동 저장 */
    updateOverview?: {
      overview: string;
      summaryBullets?: string[];
      /** 수동 요약 완료 → 팩트체크·보고서 자동 갱신 */
      complete?: boolean;
      /**
       * true면 요약 문구만 바꾸고 기존 팩트체크·보고서 본문을 유지.
       * false/생략이면 팩트체크 항목을 요약 기준으로 다시 만듦.
       */
      preserveFactChecks?: boolean;
    };
    /** 요약 변경으로 생긴 팩트체크 갱신 안내 닫기 */
    dismissFactCheckRevisionNotice?: boolean;
    /** 상세·목록 상단 표지(썸네일) 이미지 */
    updateThumbnail?: { thumbnailUrl: string | null };
    /** 사용자 분류 태그 (#조선 → 조선). 시스템 tags 와 별개 */
    updateUserTags?: { tags: string[] };
  };

  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { error: "요청 본문을 읽지 못했습니다. 이미지 용량이 너무 클 수 있습니다." },
      { status: 400 }
    );
  }

  let next = { ...video };

  if (body.updateUserTags) {
    next.userTags = normalizeTagList(body.updateUserTags.tags);
    next.updatedAt = new Date().toISOString();
  }

  if (body.updateThumbnail) {
    const raw = body.updateThumbnail.thumbnailUrl;
    let thumb: string;
    if (raw === null || raw === "") {
      thumb =
        video.inputMode === "report"
          ? reportThumbnailUrl()
          : youtubeThumbnailUrl(video.videoId);
    } else {
      const t = raw.trim();
      if (
        !t.startsWith("http://") &&
        !t.startsWith("https://") &&
        !t.startsWith("/api/media/") &&
        !t.startsWith("data:image/")
      ) {
        return NextResponse.json(
          { error: "유효한 이미지 URL이 아닙니다." },
          { status: 400 }
        );
      }
      thumb = t;
    }
    next = {
      ...next,
      thumbnailUrl: thumb,
      updatedAt: new Date().toISOString(),
    };
    const saved = await upsertVideo(next, expectedUpdatedAt);
    return jsonVideo(saved, { mode: "thumbnail_updated" });
  }

  if (body.updateReportInput && video.status === "report_input_draft") {
    const title = (body.updateReportInput.title ?? video.title).trim();
    if (title.length < 2) {
      return NextResponse.json(
        { error: "제목을 2자 이상 입력해 주세요." },
        { status: 400 }
      );
    }
    const saved = await saveReportInputDraft({
      id: video.id,
      title,
      channel: body.updateReportInput.channel,
      pastedScript: body.updateReportInput.pastedScript ?? video.transcript,
      creatorNotes: body.updateReportInput.creatorNotes,
      thumbnailUrl: body.updateReportInput.thumbnailUrl,
    });
    return jsonVideo(saved, { mode: "report_input_draft" });
  }

  if (body.startReportPipeline) {
    if (video.status !== "report_input_draft") {
      return NextResponse.json(
        { error: "이미 요약·검증이 시작된 항목입니다." },
        { status: 400 }
      );
    }
    const script = normalizePastedText(
      body.updateReportInput?.pastedScript ?? video.transcript ?? ""
    );
    if (!hasUsablePastedScript(script)) {
      return NextResponse.json(
        { error: "스크립트(본문)를 80자 이상 붙여넣어 주세요." },
        { status: 400 }
      );
    }
    if (body.updateReportInput) {
      await saveReportInputDraft({
        id: video.id,
        title: body.updateReportInput.title ?? video.title,
        channel: body.updateReportInput.channel,
        pastedScript: script,
        creatorNotes: body.updateReportInput.creatorNotes,
        thumbnailUrl: body.updateReportInput.thumbnailUrl,
      });
    }
    const processed = await startReportFromDraft(
      video.id,
      body.updateReportInput?.creatorNotes?.trim()
    );
    return jsonVideo(processed, { mode: "report_pipeline_started" });
  }

  if (body.dismissFactCheckRevisionNotice) {
    next = {
      ...next,
      factCheckRevisionNotice: next.factCheckRevisionNotice
        ? { ...next.factCheckRevisionNotice, dismissed: true }
        : null,
      updatedAt: new Date().toISOString(),
    };
    const saved = await upsertVideo(next, expectedUpdatedAt);
    return jsonVideo(saved);
  }

  if (body.reopenAsDraft) {
    const keepBody =
      body.keepReportBody !== false && Boolean(next.report);
    next = {
      ...next,
      status: "awaiting_factcheck",
      pendingReportFinalize: keepBody ? "keep_body" : "rewrite",
      updatedAt: new Date().toISOString(),
    };
    const saved = await upsertVideo(next, expectedUpdatedAt);
    return jsonVideo(saved);
  }

  if (body.reportType && ["H", "S", "C", "P"].includes(body.reportType)) {
    next = {
      ...next,
      reportType: body.reportType,
      updatedAt: new Date().toISOString(),
    };
  }

  if (body.itemImages?.itemId || body.itemImage?.itemId) {
    const itemId = (body.itemImages ?? body.itemImage)!.itemId;
    const urls =
      body.itemImages?.imageUrls ??
      (body.itemImage?.imageUrls ??
        (body.itemImage?.imageUrl === null
          ? []
          : body.itemImage?.imageUrl
            ? [body.itemImage.imageUrl]
            : undefined));
    if (urls) {
      const split = splitPrimaryImage(urls);
      next = {
        ...next,
        items: next.items.map((item) =>
          item.id === itemId
            ? {
                ...item,
                imageUrl: split.imageUrl,
                imageUrls: split.imageUrls,
              }
            : item
        ),
        updatedAt: new Date().toISOString(),
      };
      next = afterIncrementalFactEdit(next);
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
    };
    next = afterIncrementalFactEdit(next);
  }

  if (body.clearFactCheckDetail?.itemId) {
    const itemId = body.clearFactCheckDetail.itemId;
    if (!next.items.some((i) => i.id === itemId)) {
      return NextResponse.json(
        { error: "DETAIL을 지울 팩트체크가 없습니다." },
        { status: 404 }
      );
    }
    const now = new Date().toISOString();
    next = {
      ...next,
      factChecks: next.factChecks.map((fc) =>
        fc.itemId === itemId
          ? {
              ...fc,
              explanation: "",
              sources: [],
              answerImageUrl: undefined,
              answerImageUrls: undefined,
              answerParts: undefined,
              verdict: "pending" as const,
              checkedAt: now,
            }
          : fc
      ),
      updatedAt: now,
    };
    next = afterIncrementalFactEdit(next);
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
    };
    next = afterIncrementalFactEdit(next);
  }

  if (body.answerImages?.itemId || body.answerImage?.itemId) {
    const itemId = (body.answerImages ?? body.answerImage)!.itemId;
    const urls =
      body.answerImages?.imageUrls ??
      (body.answerImage?.imageUrls ??
        (body.answerImage?.imageUrl === null
          ? []
          : body.answerImage?.imageUrl
            ? [body.answerImage.imageUrl]
            : undefined));
    if (urls) {
      const existing = next.factChecks.find((f) => f.itemId === itemId);
      const parts =
        body.answerImages?.answerParts ??
        pairAnswerParts(
          existing?.explanation || "",
          urls,
          existing?.answerParts
        );
      const flat = partsToImageUrls(parts).length
        ? partsToImageUrls(parts)
        : urls;
      const split = splitPrimaryImage(flat);
      const fc: FactCheckResult = existing
        ? {
            ...existing,
            answerImageUrl: split.imageUrl,
            answerImageUrls: split.imageUrls,
            answerParts: parts,
          }
        : {
            itemId,
            mode: "manual",
            verdict: "pending",
            explanation: "",
            sources: [],
            checkedAt: new Date().toISOString(),
            answerImageUrl: split.imageUrl,
            answerImageUrls: split.imageUrls,
            answerParts: parts,
          };
      next = {
        ...next,
        factChecks: [
          ...next.factChecks.filter((f) => f.itemId !== itemId),
          fc,
        ],
        updatedAt: new Date().toISOString(),
      };
      next = afterIncrementalFactEdit(next);
    }
  }

  if (body.updateReport) {
    const updated = body.updateReport;
    // 요약 섹션 본문이 바뀌면 PDF·발췌도 같은 내용으로 맞춤
    const summarySec = updated.sections.find((s) => s.heading === "요약");
    const summaryPlain = summarySec
      ? reportBodyPlain(summarySec.body, summarySec.rich).trim()
      : "";
    next = {
      ...next,
      report: {
        ...updated,
        summaryExcerpt:
          summaryPlain ||
          updated.summaryExcerpt ||
          next.report?.summaryExcerpt ||
          "",
      },
      updatedAt: new Date().toISOString(),
    };
    if (next.status === "awaiting_factcheck") {
      next.reportSkeletonEdited = true;
    }
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

    const preserve =
      body.updateOverview.preserveFactChecks === true &&
      next.items.some((i) => i.needsFactCheck);

    if (preserve) {
      next = {
        ...next,
        overview,
        summaryBullets:
          body.updateOverview.summaryBullets?.map((b) => b.trim()).filter(Boolean) ??
          next.summaryBullets,
        summarySource: "manual",
        factCheckNotice:
          "요약을 수정했습니다. 기존 팩트체크 항목·답변은 유지했습니다.",
        factCheckRevisionNotice: null,
        errorMessage: undefined,
        updatedAt: new Date().toISOString(),
      };
      if (next.report) {
        next.report = {
          ...next.report,
          summaryExcerpt:
            overview.split(/\n+/).map((l) => l.trim()).filter(Boolean).slice(0, 8).join("\n") ||
            next.report.summaryExcerpt,
        };
      }
      // 상태 유지 (ready면 ready, awaiting이면 awaiting)
      const saved = await upsertVideo(next, expectedUpdatedAt);
      return jsonVideo(saved, { mode: "overview_preserve_fc" });
    }

    // 수동 요약 완료: 팩트체크·보고서를 새 요약에 맞춰 자동 갱신
    const rebuilt = rebuildFactChecksFromOverview(
      overview,
      next.videoId,
      body.updateOverview.summaryBullets
    );
    if (!rebuilt.items.length) {
      return NextResponse.json(
        {
          error:
            "요약에서 ‘근거 확인이 필요한’ 사실 단정·주장·의견을 찾지 못했습니다. 수치·시기·인명·인과가 드러나는 문장으로 조금 더 구체적으로 적어 주세요.",
        },
        { status: 400 }
      );
    }

    next = {
      ...next,
      overview,
      summaryBullets: rebuilt.summaryBullets,
      summarySource: "manual",
      items: rebuilt.items,
      factChecks: rebuilt.factChecks,
      factCheckSource: "heuristic",
      factCheckNotice:
        "요약을 수정해 팩트체크 항목을 다시 만들었습니다. 「인앱 AI 초안 생성」으로 답을 채우거나, AI 질문을 복사해 외부 AI에 물어본 뒤 붙여넣으세요.",
      factCheckRevisionNotice: {
        at: new Date().toISOString(),
        itemCount: rebuilt.items.filter((i) => i.needsFactCheck).length,
        reason: "summary_edit",
      },
      errorMessage: undefined,
      updatedAt: new Date().toISOString(),
    };

    // 변경된 요약 기준으로 조립 보고서·인포그래픽 골격 (답변 비어 있음)
    next.report = buildSkeletonReport(next);
    next.reportSource = "assembled";
    next.reportWriteNotice = SKELETON_REPORT_NOTICE;
    next.reportSkeletonEdited = undefined;
    next.infographic = await buildInfographic(next);
    // 새 FC 답변은 비어 있으므로 팩트체크 화면에서 이어서 정리
    next.status = "awaiting_factcheck";

    const saved = await upsertVideo(next, expectedUpdatedAt);
    return jsonVideo(saved, { mode: "overview_complete" });
  }

  if (body.redraftFactChecks) {
    if (
      next.status !== "awaiting_factcheck" &&
      next.status !== "ready"
    ) {
      return NextResponse.json(
        { error: "팩트체크 단계에서만 초안을 생성할 수 있습니다." },
        { status: 400 }
      );
    }
    const result = await redraftPendingFactChecks(
      next.items,
      next.factChecks,
      {
        title: next.title,
        channel: next.channel,
        description: next.description,
        chapters: next.chapters,
        transcriptSource: next.transcriptSource,
        videoId: next.videoId,
      }
    );
    next = {
      ...next,
      items: next.items,
      factChecks: result.factChecks,
      factCheckSource: result.source,
      factCheckNotice: result.notice,
      status: "awaiting_factcheck",
      updatedAt: new Date().toISOString(),
    };
    const saved = await upsertVideo(next, expectedUpdatedAt);
    return jsonVideo(saved, {
      mode: "fc_redraft",
      factCheckSource: result.source,
      notice: result.notice,
    });
  }

  if (body.factCheck) {
    if (!body.factCheck.explanation?.trim()) {
      return NextResponse.json(
        { error: "AI 답변·팩트체크 결과를 입력해 주세요." },
        { status: 400 }
      );
    }

    const prev = next.factChecks.find((f) => f.itemId === body.factCheck!.itemId);
    // 이미지는 upsert 시 외부 저장소로 빼므로, data URL이어도 여기서 건너뛰지 않음
    const prevImages = normalizeImageUrls(
      prev?.answerImageUrl,
      prev?.answerImageUrls
    );
    const nextImages =
      body.factCheck.answerImageUrls ??
      (body.factCheck.answerImageUrl !== undefined
        ? body.factCheck.answerImageUrl
          ? [body.factCheck.answerImageUrl]
          : []
        : prevImages);
    const incomingParts = body.factCheck.answerParts;
    const parts =
      incomingParts?.length
        ? incomingParts
        : pairAnswerParts(
            body.factCheck.explanation,
            nextImages,
            prev?.answerParts
          );
    const explanation =
      partsToExplanation(parts) ||
      normalizeAiAnswer(body.factCheck.explanation.trim());
    const flat = partsToImageUrls(parts).length
      ? partsToImageUrls(parts)
      : nextImages;
    const split = splitPrimaryImage(flat);

    const fc: FactCheckResult = {
      itemId: body.factCheck.itemId,
      mode: "manual",
      verdict: body.factCheck.verdict ?? "unverifiable",
      explanation,
      sources: body.factCheck.sources ?? [],
      checkedAt: new Date().toISOString(),
      answerImageUrl: split.imageUrl,
      answerImageUrls: split.imageUrls,
      answerParts: parts,
    };
    const others = next.factChecks.filter((f) => f.itemId !== fc.itemId);
    next = {
      ...next,
      factChecks: [...others, fc],
      updatedAt: new Date().toISOString(),
    };
    next = afterIncrementalFactEdit(next);

    const saved = await upsertVideo(next, expectedUpdatedAt);
    return jsonVideo(saved);
  }

  if (body.completeManual) {
    const progress = factCheckProgress(next);
    const allowPartial = body.allowPartialFactCheck === true;

    if (!progress.gateComplete) {
      if (!allowPartial || progress.doneCount < 1) {
        const msg =
          progress.doneCount < 1
            ? "최소 1건 이상 팩트체크를 완료한 뒤 보고서를 만들 수 있습니다."
            : `필수 항목 ${progress.gateTotal - progress.gateDoneCount}건이 남았습니다. 「나중에 해도 됨」으로 표시하거나, 미완료 무시하고 만들기를 선택하세요.`;
        return NextResponse.json(
          { error: msg, progress },
          { status: 400 }
        );
      }
    }

    const incompleteCount = progress.complete
      ? 0
      : progress.total - progress.doneCount;

    next = await finalizeReport(
      next,
      body.reportType ?? next.reportType,
      expectedUpdatedAt,
      incompleteCount > 0 ? { incompleteFactCheckCount: incompleteCount } : undefined
    );
    return jsonVideo(next);
  }

  if (body.rebuild && next.status === "ready") {
    const built = await buildReportDocument(next);
    next.report = built.report;
    next.reportSource = built.source;
    next.reportWriteNotice = built.notice;
    next.infographic = await buildInfographic(next);
    next.tags = Array.from(
      new Set([
        ...next.tags.filter(
          (t) => t !== "report-llm" && t !== "report-assembled"
        ),
        built.source === "llm" ? "report-llm" : "report-assembled",
      ])
    );
    next.updatedAt = new Date().toISOString();
  }

  const saved = await upsertVideo(next, expectedUpdatedAt);
  return jsonVideo(saved);
}
