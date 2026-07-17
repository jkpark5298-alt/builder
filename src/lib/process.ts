import { v4 as uuid } from "uuid";
import { buildInfographic } from "./infographic";
import { autoFactCheck, hasLlm, summarizeContent } from "./pipeline";
import { buildTypedReport } from "./report";
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

  try {
    record = {
      ...record,
      status: "fetching",
      updatedAt: new Date().toISOString(),
    };
    await upsertVideo(record);

    let meta = script
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

    let text = "";
    let source: VideoRecord["transcriptSource"] = "none";
    let notice: string | undefined;

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

    record = {
      ...record,
      title: meta.title,
      channel: meta.channel,
      description: meta.description,
      chapters: meta.chapters,
      transcript: text,
      transcriptSource: source,
      scriptNotice: notice,
      tags: [
        meta.channel,
        "youtube",
        ...(meta.chapters.length ? ["chapters"] : []),
        ...(source === "none" || source === "creator_meta"
          ? ["no-script"]
          : ["has-script"]),
      ].filter(Boolean),
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

    const factChecks = await autoFactCheck(summary.items, {
      ...meta,
      transcriptSource: source,
      videoId: record.videoId,
    });
    record = {
      ...record,
      items: summary.items,
      factChecks,
      report: null,
      infographic: null,
      status: "awaiting_factcheck",
      tags: Array.from(
        new Set([
          ...record.tags,
          hasLlm() ? "auto-factcheck" : "heuristic-factcheck",
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
        scriptNotice:
          `AI 자동 요약에 실패했습니다 (${message}). 「1. 유튜브 내용 요약」에서 수동으로 입력한 뒤 완료를 눌러 주세요.`,
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

/** 3) 요약+팩트체크 → 유형별 보고서 + 인포그래픽 */
export async function finalizeReport(
  video: VideoRecord,
  reportType?: ReportType
): Promise<VideoRecord> {
  const typed = {
    ...video,
    reportType: reportType ?? video.reportType,
    updatedAt: new Date().toISOString(),
  };
  const report = buildTypedReport(typed);
  const withReport = { ...typed, report };
  const infographic = await buildInfographic(withReport);
  const next: VideoRecord = {
    ...withReport,
    infographic,
    status: "ready",
    updatedAt: new Date().toISOString(),
  };
  await upsertVideo(next);
  return next;
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