import { NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
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
import { normalizePastedText } from "@/lib/paste";
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
import { normalizeSimpleVerdict } from "@/lib/labels";
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
    /** 외부 AI 답변 일괄 적용 */
    bulkFactChecks?: Array<{
      itemId: string;
      verdict?: FactCheckResult["verdict"];
      explanation: string;
      sources?: string[];
      /** 붙여넣기 주장으로 항목 문장 갱신/생성 */
      statement?: string;
      isNew?: boolean;
    }>;
    /** 간편 붙여넣기란 원문 보관 */
    factCheckPasteDraft?: string;
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
    /** 팩트체크 대상 항목 추가 */
    addFactCheckItem?: {
      statement?: string;
    };
    /** 팩트체크 대상 삭제 */
    deleteItem?: { itemId: string };
    /** 휴지통 전체 원복 */
    restoreFactCheckTrash?: boolean;
    /** 휴지통 한 건 원복 */
    restoreFactCheckItem?: { itemId: string };
    /** 요약 본문으로 FC 항목 다시 만들기 (삭제 복구 대안) */
    rebuildFactChecksFromOverview?: boolean;
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

  if (body.addFactCheckItem) {
    const statement =
      body.addFactCheckItem.statement?.trim() || "새 팩트체크 대상";
    const newId = uuid();
    const item: SummaryItem = {
      id: newId,
      type: "claim",
      statement,
      detail: "직접 추가한 검증 항목",
      evidence: [
        {
          text: buildFactCheckPrompt(statement),
          sourceHint: "factcheck-guide",
        },
      ],
      needsFactCheck: true,
      imageUrl: next.thumbnailUrl,
    };
    const fc: FactCheckResult = {
      itemId: newId,
      mode: "manual",
      verdict: "pending",
      explanation: buildFactCheckPrompt(statement),
      sources: [],
      checkedAt: new Date().toISOString(),
    };
    next = {
      ...next,
      items: [...next.items, item],
      factChecks: [...next.factChecks, fc],
      status:
        next.status === "ready" ? next.status : "awaiting_factcheck",
      updatedAt: new Date().toISOString(),
    };
    next = afterIncrementalFactEdit(next);
    const saved = await upsertVideo(next, expectedUpdatedAt);
    return jsonVideo(saved, { mode: "add_factcheck_item" });
  }

  if (body.deleteItem?.itemId) {
    const itemId = body.deleteItem.itemId;
    const removed = next.items.find((i) => i.id === itemId);
    if (!removed) {
      return NextResponse.json(
        { error: "삭제할 팩트체크 대상이 없습니다." },
        { status: 404 }
      );
    }
    const removedFc =
      next.factChecks.find((f) => f.itemId === itemId) ?? null;
    const trashEntry = {
      item: removed,
      factCheck: removedFc,
      deletedAt: new Date().toISOString(),
    };
    const prevTrash = next.factCheckTrash ?? [];
    next = {
      ...next,
      items: next.items.filter((i) => i.id !== itemId),
      factChecks: next.factChecks.filter((f) => f.itemId !== itemId),
      factCheckTrash: [trashEntry, ...prevTrash]
        .filter(
          (t, i, arr) => arr.findIndex((x) => x.item.id === t.item.id) === i
        )
        .slice(0, 30),
      factCheckNotice: `「${removed.statement.slice(0, 40)}${removed.statement.length > 40 ? "…" : ""}」을 삭제했습니다. 아래에서 원복할 수 있습니다.`,
      updatedAt: new Date().toISOString(),
    };
    next = afterIncrementalFactEdit(next);
  }

  if (body.restoreFactCheckItem?.itemId || body.restoreFactCheckTrash) {
    const trash = next.factCheckTrash ?? [];
    if (!trash.length) {
      return NextResponse.json(
        {
          error:
            "원복할 삭제 항목이 없습니다. 요약에서 팩트체크 항목을 다시 만들어 보세요.",
        },
        { status: 400 }
      );
    }

    const toRestore = body.restoreFactCheckTrash
      ? trash
      : trash.filter((t) => t.item.id === body.restoreFactCheckItem!.itemId);

    if (!toRestore.length) {
      return NextResponse.json(
        { error: "해당 삭제 항목을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    const existingIds = new Set(next.items.map((i) => i.id));
    const restoredItems = toRestore
      .filter((t) => !existingIds.has(t.item.id))
      .map((t) => ({ ...t.item, needsFactCheck: true }));
    const restoredFcs = toRestore
      .filter((t) => !existingIds.has(t.item.id) && t.factCheck)
      .map((t) => t.factCheck!);

    const restoredIds = new Set(restoredItems.map((i) => i.id));
    next = {
      ...next,
      items: [...next.items, ...restoredItems],
      factChecks: [
        ...next.factChecks.filter((f) => !restoredIds.has(f.itemId)),
        ...restoredFcs,
      ],
      factCheckTrash: trash.filter((t) => !restoredIds.has(t.item.id)),
      factCheckNotice: `${restoredItems.length}건 팩트체크 항목을 원복했습니다.`,
      status:
        next.status === "ready" ? next.status : "awaiting_factcheck",
      updatedAt: new Date().toISOString(),
    };
    next = afterIncrementalFactEdit(next);
    if (next.status === "awaiting_factcheck") {
      next.report = buildSkeletonReport(next);
      next.reportSource = "assembled";
      next.reportWriteNotice = SKELETON_REPORT_NOTICE;
    }
    const saved = await upsertVideo(next, expectedUpdatedAt);
    return jsonVideo(saved, {
      mode: "restore_factcheck_trash",
      restored: restoredItems.length,
    });
  }

  if (body.rebuildFactChecksFromOverview) {
    const overview = next.overview?.trim() ?? "";
    if (overview.length < 40) {
      return NextResponse.json(
        {
          error:
            "요약이 없어 항목을 다시 만들 수 없습니다. 위에서 요약을 입력·완료한 뒤 다시 시도해 주세요.",
        },
        { status: 400 }
      );
    }
    const rebuilt = rebuildFactChecksFromOverview(
      overview,
      next.videoId,
      next.summaryBullets
    );
    if (!rebuilt.items.length) {
      return NextResponse.json(
        {
          error:
            "요약에서 검증할 주장을 찾지 못했습니다. 요약을 더 구체적으로 작성해 주세요.",
        },
        { status: 400 }
      );
    }
    const stamp = new Date().toISOString();
    const oldFcItems = next.items.filter((i) => i.needsFactCheck);
    const oldFcIds = new Set(oldFcItems.map((i) => i.id));
    const moving = oldFcItems.map((item) => ({
      item,
      factCheck: next.factChecks.find((f) => f.itemId === item.id) ?? null,
      deletedAt: stamp,
    }));
    next = {
      ...next,
      items: [
        ...next.items.filter((i) => !i.needsFactCheck),
        ...rebuilt.items,
      ],
      factChecks: [
        ...next.factChecks.filter((f) => !oldFcIds.has(f.itemId)),
        ...rebuilt.factChecks,
      ],
      factCheckTrash: [...moving, ...(next.factCheckTrash ?? [])]
        .filter(
          (t, i, arr) => arr.findIndex((x) => x.item.id === t.item.id) === i
        )
        .slice(0, 30),
      summaryBullets: rebuilt.summaryBullets,
      factCheckSource: "heuristic",
      factCheckNotice: `요약에서 팩트체크 ${rebuilt.items.filter((i) => i.needsFactCheck).length}건을 다시 만들었습니다. 이전 항목은 휴지통에서 원복할 수 있습니다.`,
      status: "awaiting_factcheck",
      updatedAt: stamp,
    };
    next.report = buildSkeletonReport(next);
    next.reportSource = "assembled";
    next.reportWriteNotice = SKELETON_REPORT_NOTICE;
    const saved = await upsertVideo(next, expectedUpdatedAt);
    return jsonVideo(saved, { mode: "rebuild_fc_from_overview" });
  }

  if (body.answerImages?.itemId || body.answerImage?.itemId) {
    const itemId = (body.answerImages ?? body.answerImage)!.itemId;
    const answerImagesBody = body.answerImages as
      | {
          itemId: string;
          imageUrls?: string[];
          /** 예전 클라이언트 키 — imageUrls 와 동일 */
          answerImageUrls?: string[];
          answerParts?: AnswerPart[];
        }
      | undefined;
    const urls =
      answerImagesBody?.imageUrls ??
      answerImagesBody?.answerImageUrls ??
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
        "요약을 수정해 팩트체크 항목을 다시 만들었습니다. 위 「전체 질문 복사 → 답변 한 번에 붙여넣기」로 채우거나, 「인앱 AI 초안 생성」을 쓰세요.",
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

  if (body.bulkFactChecks) {
    const rows = body.bulkFactChecks;
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json(
        { error: "적용할 팩트체크가 없습니다." },
        { status: 400 }
      );
    }

    let items = [...next.items];
    let fcList = [...next.factChecks];
    let applied = 0;

    for (const row of rows) {
      let itemId = row.itemId?.trim() ?? "";
      const explanationRaw = row.explanation?.trim() ?? "";
      const statement = row.statement?.trim() ?? "";
      if (explanationRaw.length < 8) continue;

      let item = items.find((i) => i.id === itemId);
      if (!item && (row.isNew || itemId.startsWith("new-")) && statement) {
        const newId = uuid();
        item = {
          id: newId,
          type: "claim",
          statement,
          detail: "붙여넣기에서 추가된 검증 항목",
          evidence: [
            {
              text: buildFactCheckPrompt(statement),
              sourceHint: "factcheck-guide",
            },
          ],
          needsFactCheck: true,
          imageUrl: next.thumbnailUrl,
        };
        items = [...items, item];
        itemId = newId;
      } else if (item && statement && statement !== item.statement) {
        items = items.map((i) =>
          i.id === item.id
            ? {
                ...i,
                statement,
                evidence: [
                  ...i.evidence.filter((e) => e.sourceHint !== "factcheck-guide"),
                  {
                    text: buildFactCheckPrompt(statement, i.detail),
                    sourceHint: "factcheck-guide",
                  },
                ],
              }
            : i
        );
        item = items.find((i) => i.id === itemId);
      }

      if (!item) continue;

      const prev = fcList.find((f) => f.itemId === itemId);
      const prevImages = normalizeImageUrls(
        prev?.answerImageUrl,
        prev?.answerImageUrls
      );
      // 간편 답변은 항목=번호 1칸. 내부 1.2.3 재분할하지 않음
      const explanation = normalizeAiAnswer(explanationRaw);
      const parts: AnswerPart[] = [
        {
          number: 1,
          text: explanation,
          imageUrls: prevImages,
        },
      ];
      const split = splitPrimaryImage(prevImages);
      const verdict = normalizeSimpleVerdict(
        row.verdict && row.verdict !== "pending" ? row.verdict : "unverifiable"
      );

      const fc: FactCheckResult = {
        itemId,
        mode: "manual",
        verdict,
        explanation,
        sources: row.sources ?? [],
        checkedAt: new Date().toISOString(),
        answerImageUrl: split.imageUrl,
        answerImageUrls: split.imageUrls,
        answerParts: parts,
      };
      fcList = [...fcList.filter((f) => f.itemId !== itemId), fc];
      applied += 1;
    }

    if (applied === 0) {
      return NextResponse.json(
        { error: "유효한 팩트체크 항목이 없습니다. (답변 8자 이상)" },
        { status: 400 }
      );
    }

    next = {
      ...next,
      items,
      factChecks: fcList,
      factCheckPasteDraft:
        typeof body.factCheckPasteDraft === "string"
          ? body.factCheckPasteDraft
          : next.factCheckPasteDraft,
      factCheckNotice: `간편 답변 ${applied}건을 반영했습니다. 아래 항목 번호에 이미지를 붙일 수 있습니다.`,
      updatedAt: new Date().toISOString(),
    };
    next = afterIncrementalFactEdit(next);
    if (next.status === "awaiting_factcheck") {
      next.report = buildSkeletonReport(next);
      next.reportSource = "assembled";
      next.reportWriteNotice = SKELETON_REPORT_NOTICE;
    }
    const saved = await upsertVideo(next, expectedUpdatedAt);
    return jsonVideo(saved, { mode: "bulk_factchecks", applied });
  }

  if (typeof body.factCheckPasteDraft === "string" && !body.bulkFactChecks) {
    next = {
      ...next,
      factCheckPasteDraft: body.factCheckPasteDraft,
      updatedAt: new Date().toISOString(),
    };
    const saved = await upsertVideo(next, expectedUpdatedAt);
    return jsonVideo(saved, { mode: "paste_draft" });
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
      verdict: body.factCheck.verdict
        ? normalizeSimpleVerdict(body.factCheck.verdict)
        : "unverifiable",
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
