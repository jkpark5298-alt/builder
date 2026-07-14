import { v4 as uuid } from "uuid";
import { buildInfographic } from "./infographic";
import { autoFactCheck, hasLlm, summarizeContent } from "./pipeline";
import { buildTypedReport } from "./report";
import { getVideo, upsertVideo, deleteVideo } from "./store";
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

export { hasUsablePastedScript, normalizePastedText } from "./paste";
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
      notice = "붙여넣은 스크립트(텍스트)를 기준으로 요약합니다.";
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
  const existing = await getVideo(id);
  if (!existing) throw new Error("영상을 찾을 수 없습니다.");

  const pastedScript = hasUsablePastedScript(pastedScriptOverride)
    ? normalizePastedText(pastedScriptOverride!)
    : existing.transcript &&
        hasUsablePastedScript(existing.transcript) &&
        existing.transcriptSource !== "creator_meta"
      ? existing.transcript
      : undefined;

  const youtubeUrl = existing.youtubeUrl;
  const creatorNotes = existing.description?.trim() || undefined;
  await deleteVideo(id);
  const job = await createVideoJob(youtubeUrl);
  return runVideoPipeline(job.id, creatorNotes, pastedScript);
}

function normalizeUrl(videoId: string, original: string) {
  if (original.includes("youtube.com") || original.includes("youtu.be")) {
    return original.trim();
  }
  return `https://www.youtube.com/watch?v=${videoId}`;
}