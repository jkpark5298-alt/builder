import { v4 as uuid } from "uuid";
import { buildInfographic } from "./infographic";
import { autoFactCheck, hasLlm, summarizeContent } from "./pipeline";
import { buildReportDocument } from "./report-write";
import { getVideo, upsertVideo } from "./store";
import { fetchTranscript } from "./transcript";
import type { ReportType, VideoRecord } from "./types";
import {
  extractVideoId,
  fetchYoutubeMeta,
  fetchYoutubeMetaLite,
  parseChaptersFromDescription,
  thumbnailUrl,
} from "./youtube";

import { hasUsablePastedScript, normalizePastedText } from "./paste";
import { reportThumbnailUrl } from "./input-mode";
import type { YoutubeMeta } from "./youtube";

export async function createManualOverviewJob(
  youtubeUrl: string,
  pastedScript: string
): Promise<VideoRecord> {
  const job = await createVideoJob(youtubeUrl);
  const script = normalizePastedText(pastedScript);
  let title = job.title;
  let channel = job.channel;
  try {
    const meta = await fetchYoutubeMetaLite(job.youtubeUrl, job.videoId);
    title = meta.title || title;
    channel = meta.channel || channel;
  } catch {
    /* keep job defaults */
  }

  const record: VideoRecord = {
    ...job,
    inputMode: "youtube",
    title: title === "불러오는 중…" ? `YouTube ${job.videoId}` : title,
    channel: channel || "알 수 없음",
    transcript: script,
    transcriptSource: "pasted",
    scriptNotice:
      "AI 요약 없이 시작합니다. 「1. 유튜브 내용 요약」에 수동으로 요약을 입력한 뒤 완료를 누르세요.",
    overview: "",
    summarySource: "none",
    summaryBullets: [],
    items: [],
    factChecks: [],
    status: "awaiting_factcheck",
    errorMessage: undefined,
    tags: [channel || "youtube", "youtube", "has-script", "manual-overview"],
    updatedAt: new Date().toISOString(),
  };
  await upsertVideo(record);
  return record;
}

export async function createVideoJob(youtubeUrl: string): Promise<VideoRecord> {
  const videoId = extractVideoId(youtubeUrl);
  if (!videoId) {
    throw new Error("유효한 유튜브 URL이 아닙니다.");
  }

  const now = new Date().toISOString();
  const record: VideoRecord = {
    id: uuid(),
    inputMode: "youtube",
    youtubeUrl: normalizeUrl(videoId, youtubeUrl),
    videoId,
    title: "불러오는 중…",
    channel: "",
    thumbnailUrl: thumbnailUrl(videoId),
    description: "",
    chapters: [],
    transcript: "",
    transcriptSource: "none",
    scriptNotice: undefined,
    overview: "",
    summarySource: "none",
    summaryBullets: [],
    items: [],
    factChecks: [],
    reportType: "C",
    report: null,
    infographic: null,
    status: "queued",
    tags: [],
    createdAt: now,
    updatedAt: now,
  };
  await upsertVideo(record);
  return record;
}

/** Report 생성 — URL·자막 자동 수집 없이 스크립트·메타만으로 시작 */
export async function createReportJob(opts: {
  title: string;
  channel?: string;
  pastedScript: string;
  creatorNotes?: string;
  thumbnailUrl?: string;
}): Promise<VideoRecord> {
  const script = normalizePastedText(opts.pastedScript);
  if (!hasUsablePastedScript(script)) {
    throw new Error("스크립트(본문)를 80자 이상 붙여넣어 주세요.");
  }
  const title = opts.title.trim();
  if (title.length < 2) {
    throw new Error("제목을 2자 이상 입력해 주세요.");
  }

  const id = uuid();
  const now = new Date().toISOString();
  const channel = opts.channel?.trim() || "직접 입력";
  const description = opts.creatorNotes?.trim() ?? "";
  const chapters = description
    ? parseChaptersFromDescription(description)
    : [];

  const record: VideoRecord = {
    id,
    inputMode: "report",
    youtubeUrl: "",
    videoId: `report-${id.replace(/-/g, "").slice(0, 11)}`,
    title,
    channel,
    thumbnailUrl: opts.thumbnailUrl?.trim() || reportThumbnailUrl(),
    description,
    chapters,
    transcript: script,
    transcriptSource: "pasted",
    scriptNotice: `붙여넣은 스크립트 전체(${script.length.toLocaleString()}자)를 기준으로 요약합니다.`,
    overview: "",
    summarySource: "none",
    summaryBullets: [],
    items: [],
    factChecks: [],
    reportType: "C",
    report: null,
    infographic: null,
    status: "queued",
    tags: ["report", channel, "has-script"],
    createdAt: now,
    updatedAt: now,
  };
  await upsertVideo(record);
  return record;
}

/** Report 입력 임시 저장 — 제목·스크립트 일부만 있어도 서버에 보관 */
export async function saveReportInputDraft(opts: {
  id?: string;
  title: string;
  channel?: string;
  pastedScript?: string;
  creatorNotes?: string;
  thumbnailUrl?: string;
}): Promise<VideoRecord> {
  const title = opts.title.trim();
  if (title.length < 2) {
    throw new Error("제목을 2자 이상 입력해 주세요.");
  }

  const script = normalizePastedText(opts.pastedScript ?? "");
  const channel = opts.channel?.trim() || "직접 입력";
  const description = opts.creatorNotes?.trim() ?? "";
  const chapters = description
    ? parseChaptersFromDescription(description)
    : [];
  const now = new Date().toISOString();
  const scriptNotice = script
    ? `입력 중 · 스크립트 ${script.length.toLocaleString()}자 (80자 이상이면 요약·검증을 시작할 수 있습니다)`
  : "입력 중 · 제목만 저장됨. 스크립트를 이어서 붙여넣어 주세요.";

  if (opts.id) {
    const existing = await getVideo(opts.id);
    if (!existing) {
      throw new Error("항목을 찾을 수 없습니다.");
    }
    if (
      existing.inputMode !== "report" ||
      existing.status !== "report_input_draft"
    ) {
      throw new Error("이 항목은 입력 임시 저장을 수정할 수 없습니다.");
    }
    const record: VideoRecord = {
      ...existing,
      title,
      channel,
      description,
      chapters,
      transcript: script,
      transcriptSource: script ? "pasted" : "none",
      scriptNotice,
      thumbnailUrl: opts.thumbnailUrl?.trim() || existing.thumbnailUrl,
      tags: Array.from(
        new Set([
          ...existing.tags.filter((t) => t !== "has-script"),
          "report",
          channel,
          ...(script ? ["has-script"] : []),
        ])
      ),
      updatedAt: now,
    };
    await upsertVideo(record);
    return record;
  }

  const id = uuid();
  const record: VideoRecord = {
    id,
    inputMode: "report",
    youtubeUrl: "",
    videoId: `report-${id.replace(/-/g, "").slice(0, 11)}`,
    title,
    channel,
    thumbnailUrl: opts.thumbnailUrl?.trim() || reportThumbnailUrl(),
    description,
    chapters,
    transcript: script,
    transcriptSource: script ? "pasted" : "none",
    scriptNotice,
    overview: "",
    summarySource: "none",
    summaryBullets: [],
    items: [],
    factChecks: [],
    reportType: "C",
    report: null,
    infographic: null,
    status: "report_input_draft",
    tags: ["report", channel, ...(script ? ["has-script"] : [])],
    createdAt: now,
    updatedAt: now,
  };
  await upsertVideo(record);
  return record;
}

/** 입력 임시 저장 → 요약·팩트체크 파이프라인 시작 */
export async function startReportFromDraft(
  id: string,
  creatorNotes?: string
): Promise<VideoRecord> {
  const existing = await getVideo(id);
  if (!existing) {
    throw new Error("항목을 찾을 수 없습니다.");
  }
  if (existing.status !== "report_input_draft") {
    throw new Error("이미 요약·검증이 시작된 항목입니다.");
  }

  const script = normalizePastedText(existing.transcript ?? "");
  if (!hasUsablePastedScript(script)) {
    throw new Error("스크립트(본문)를 80자 이상 붙여넣어 주세요.");
  }

  const now = new Date().toISOString();
  let record: VideoRecord = {
    ...existing,
    transcript: script,
    transcriptSource: "pasted",
    scriptNotice: `붙여넣은 스크립트 전체(${script.length.toLocaleString()}자)를 기준으로 요약합니다.`,
    status: "queued",
    updatedAt: now,
  };
  await upsertVideo(record);
  return runVideoPipeline(id, creatorNotes, script);
}

function buildReportMeta(
  record: VideoRecord,
  creatorNotes?: string
): YoutubeMeta {
  let description = record.description ?? "";
  let chapters = record.chapters ?? [];

  if (creatorNotes && creatorNotes.length > 20) {
    const noteChapters = parseChaptersFromDescription(creatorNotes);
    description =
      creatorNotes.length >= description.length
        ? creatorNotes
        : [description, creatorNotes].filter(Boolean).join("\n\n");
    if (noteChapters.length) chapters = noteChapters;
  }

  return {
    title: record.title,
    channel: record.channel,
    description,
    chapters,
  };
}

/** 백그라운드 파이프라인 (요약·팩트체크) */
export async function runVideoPipeline(
  recordId: string,
  creatorNotes?: string,
  pastedScript?: string
): Promise<VideoRecord> {
  let record = await getVideo(recordId);
  if (!record) {
    throw new Error("영상을 찾을 수 없습니다.");
  }

  const script = hasUsablePastedScript(pastedScript)
    ? normalizePastedText(pastedScript!)
    : undefined;

  const isReport = record.inputMode === "report";

  try {
    record = {
      ...record,
      status: "fetching",
      updatedAt: new Date().toISOString(),
    };
    await upsertVideo(record);

    let meta: YoutubeMeta;
    let text = "";
    let source: VideoRecord["transcriptSource"] = "none";
    let notice: string | undefined;

    if (isReport) {
      meta = buildReportMeta(record, creatorNotes);
      const body =
        script ||
        (hasUsablePastedScript(record.transcript)
          ? normalizePastedText(record.transcript)
          : "");
      if (!hasUsablePastedScript(body)) {
        throw new Error("Report 생성에는 스크립트(본문)가 필요합니다.");
      }
      text = body;
      source = "pasted";
      notice = `붙여넣은 스크립트 전체(${body.length.toLocaleString()}자)를 기준으로 요약합니다.`;
    } else {
      meta = script
        ? await fetchYoutubeMetaLite(record.youtubeUrl, record.videoId)
        : await fetchYoutubeMeta(record.youtubeUrl, record.videoId);

      if (creatorNotes && creatorNotes.length > 20) {
        const noteChapters = parseChaptersFromDescription(creatorNotes);
        meta = {
          ...meta,
          description:
            creatorNotes.length >= (meta.description?.length ?? 0)
              ? creatorNotes
              : [meta.description, creatorNotes].filter(Boolean).join("\n\n"),
          chapters: noteChapters.length ? noteChapters : meta.chapters,
        };
      }

      if (script) {
        text = script;
        source = "pasted";
        notice =
          script.length > 48000
            ? `붙여넣은 스크립트 전체(${script.length.toLocaleString()}자)를 구간으로 나눠 요약합니다.`
            : `붙여넣은 스크립트 전체(${script.length.toLocaleString()}자)를 기준으로 요약합니다.`;
      } else {
        const fetched = await fetchTranscript(record.videoId, meta);
        text = fetched.text;
        source = fetched.source;
        notice = fetched.notice;
      }
    }

    record = {
      ...record,
      title: meta.title,
      channel: meta.channel,
      description: meta.description,
      chapters: meta.chapters,
      transcript: text,
      transcriptSource: source,
      scriptNotice: notice,
      tags: Array.from(
        new Set([
          ...(isReport ? ["report"] : ["youtube"]),
          meta.channel,
          ...(meta.chapters.length ? ["chapters"] : []),
          ...(source === "none" || source === "creator_meta"
            ? ["no-script"]
            : ["has-script"]),
        ])
      ).filter(Boolean),
      updatedAt: new Date().toISOString(),
    };
    await upsertVideo(record);

    record = {
      ...record,
      status: "summarizing",
      updatedAt: new Date().toISOString(),
    };
    await upsertVideo(record);

    const summary = await summarizeContent(
      { ...meta, transcriptSource: source, videoId: record.videoId },
      text
    );
    record = {
      ...record,
      overview: summary.overview,
      summaryBullets: summary.summaryBullets,
      summarySource: summary.summarySource,
      items: summary.items,
      reportType: summary.reportType,
      tags: Array.from(new Set([...record.tags, `type-${summary.reportType}`])),
      updatedAt: new Date().toISOString(),
    };
    await upsertVideo(record);

    record = {
      ...record,
      status: "fact_checking",
      updatedAt: new Date().toISOString(),
    };
    await upsertVideo(record);

    const fcResult = await autoFactCheck(summary.items, {
      ...meta,
      transcriptSource: source,
      videoId: record.videoId,
    });
    record = {
      ...record,
      items: summary.items,
      factChecks: fcResult.factChecks,
      factCheckSource: fcResult.source,
      factCheckNotice: fcResult.notice,
      report: null,
      infographic: null,
      reportSource: undefined,
      reportWriteNotice: undefined,
      status: "awaiting_factcheck",
      tags: Array.from(
        new Set([
          ...record.tags,
          fcResult.source === "llm_draft"
            ? "fc-llm-draft"
            : hasLlm()
              ? "auto-factcheck"
              : "heuristic-factcheck",
          "manual-review",
        ])
      ),
      updatedAt: new Date().toISOString(),
    };
    await upsertVideo(record);
    return record;
  } catch (e) {
    const message = e instanceof Error ? e.message : "처리 실패";
    // 스크립트가 있으면 AI 요약 실패해도 수동 요약 화면으로 넘김
    const hasScript =
      Boolean(script) ||
      (record.transcript?.trim().length ?? 0) >= 80;
    if (hasScript) {
      record = {
        ...record,
        transcript: script || record.transcript,
        transcriptSource: script ? "pasted" : record.transcriptSource,
        overview: record.overview || "",
        summarySource: "none",
        summaryBullets: record.summaryBullets?.length
          ? record.summaryBullets
          : [],
        items: record.items?.length ? record.items : [],
        factChecks: record.factChecks?.length ? record.factChecks : [],
        status: "awaiting_factcheck",
        errorMessage: undefined,
        scriptNotice: isReport
          ? `AI 자동 요약에 실패했습니다 (${message}). 「1. 내용 요약」에서 수동으로 입력한 뒤 완료를 눌러 주세요.`
          : `AI 자동 요약에 실패했습니다 (${message}). 「1. 유튜브 내용 요약」에서 수동으로 입력한 뒤 완료를 눌러 주세요.`,
        updatedAt: new Date().toISOString(),
      };
      await upsertVideo(record);
      return record;
    }
    record = {
      ...record,
      status: "error",
      errorMessage: message,
      updatedAt: new Date().toISOString(),
    };
    await upsertVideo(record);
    throw e;
  }
}

export async function createAndProcessVideo(
  youtubeUrl: string,
  creatorNotes?: string,
  pastedScript?: string
): Promise<VideoRecord> {
  const job = await createVideoJob(youtubeUrl);
  return runVideoPipeline(job.id, creatorNotes, pastedScript);
}

export async function createAndProcessReport(opts: {
  title: string;
  channel?: string;
  pastedScript: string;
  creatorNotes?: string;
  thumbnailUrl?: string;
}): Promise<VideoRecord> {
  const job = await createReportJob(opts);
  return runVideoPipeline(job.id, opts.creatorNotes, opts.pastedScript);
}

/** 3) 요약+팩트체크 → 글쓰기 AI 보고서(실패 시 조립) + 인포그래픽 */
export async function finalizeReport(
  video: VideoRecord,
  reportType?: ReportType,
  expectedUpdatedAt?: string
): Promise<VideoRecord> {
  const typed = {
    ...video,
    reportType: reportType ?? video.reportType,
    updatedAt: new Date().toISOString(),
  };
  const built = await buildReportDocument(typed);
  const withReport = {
    ...typed,
    report: built.report,
    reportSource: built.source,
    reportWriteNotice: built.notice,
  };
  const infographic = await buildInfographic(withReport);
  const next: VideoRecord = {
    ...withReport,
    infographic,
    status: "ready",
    tags: Array.from(
      new Set([
        ...typed.tags.filter(
          (t) => t !== "report-llm" && t !== "report-assembled"
        ),
        built.source === "llm" ? "report-llm" : "report-assembled",
      ])
    ),
    updatedAt: new Date().toISOString(),
  };
  return upsertVideo(next, expectedUpdatedAt);
}

export async function reprocessFromId(
  id: string,
  pastedScriptOverride?: string
): Promise<VideoRecord> {
  const prepared = await prepareReprocess(id, pastedScriptOverride);
  return runVideoPipeline(
    prepared.video.id,
    prepared.creatorNotes,
    prepared.script
  );
}

/** 재요약 준비: 같은 ID 유지, 요약·FC·보고서만 초기화 */
export async function prepareReprocess(
  id: string,
  pastedScriptOverride?: string
): Promise<{
  video: VideoRecord;
  script?: string;
  creatorNotes?: string;
}> {
  const existing = await getVideo(id);
  if (!existing) throw new Error("영상을 찾을 수 없습니다.");

  const script = hasUsablePastedScript(pastedScriptOverride)
    ? normalizePastedText(pastedScriptOverride!)
    : existing.transcript &&
        hasUsablePastedScript(existing.transcript) &&
        existing.transcriptSource !== "creator_meta"
      ? existing.transcript
      : undefined;

  if (!script && !hasUsablePastedScript(existing.transcript)) {
    // 스크립트 없이도 메타 기준 재요약은 가능 — 다만 사용자에게 안내
  }

  const creatorNotes = existing.description?.trim() || undefined;
  const reset: VideoRecord = {
    ...existing,
    overview: "",
    summaryBullets: [],
    summarySource: "none",
    items: [],
    factChecks: [],
    report: null,
    infographic: null,
    status: "queued",
    errorMessage: undefined,
    ...(script
      ? {
          transcript: script,
          transcriptSource: "pasted" as const,
          scriptNotice: `스크립트 전체(${script.length.toLocaleString()}자)로 상세 재요약 중…`,
        }
      : {
          scriptNotice:
            existing.scriptNotice ||
            "저장된 스크립트/메타로 재요약합니다. 자막이 없으면 결과가 부실할 수 있습니다.",
        }),
    updatedAt: new Date().toISOString(),
  };
  await upsertVideo(reset);
  return { video: reset, script, creatorNotes };
}

function normalizeUrl(videoId: string, original: string) {
  if (original.includes("youtube.com") || original.includes("youtu.be")) {
    return original.trim();
  }
  return `https://www.youtube.com/watch?v=${videoId}`;
}