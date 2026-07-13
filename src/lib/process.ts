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
  parseChaptersFromDescription,
  thumbnailUrl,
} from "./youtube";

export async function createAndProcessVideo(
  youtubeUrl: string,
  creatorNotes?: string,
  pastedScript?: string
): Promise<VideoRecord> {
  const videoId = extractVideoId(youtubeUrl);
  if (!videoId) {
    throw new Error("유효한 유튜브 URL이 아닙니다.");
  }

  const now = new Date().toISOString();
  let record: VideoRecord = {
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

  try {
    record = {
      ...record,
      status: "fetching",
      updatedAt: new Date().toISOString(),
    };
    await upsertVideo(record);

    let meta = await fetchYoutubeMeta(record.youtubeUrl, videoId);

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

    // 사용자가 붙여넣은 스크립트 최우선
    if (pastedScript && pastedScript.trim().length > 80) {
      text = pastedScript.trim();
      source = "pasted";
      notice = "붙여넣은 스크립트(텍스트)를 기준으로 요약합니다.";
    } else {
      const fetched = await fetchTranscript(videoId, meta);
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

    // 1) 요약
    record = {
      ...record,
      status: "summarizing",
      updatedAt: new Date().toISOString(),
    };
    await upsertVideo(record);

    const summary = await summarizeContent(
      { ...meta, transcriptSource: source, videoId },
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

    // 2) 자동 팩트체크 → 수동 수정 대기
    record = {
      ...record,
      status: "fact_checking",
      updatedAt: new Date().toISOString(),
    };
    await upsertVideo(record);

    const factChecks = await autoFactCheck(summary.items, {
      ...meta,
      transcriptSource: source,
      videoId,
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
  const infographic = buildInfographic(withReport);
  const next: VideoRecord = {
    ...withReport,
    infographic,
    status: "ready",
    updatedAt: new Date().toISOString(),
  };
  await upsertVideo(next);
  return next;
}

export async function reprocessFromId(id: string): Promise<VideoRecord> {
  const existing = await getVideo(id);
  if (!existing) throw new Error("영상을 찾을 수 없습니다.");

  const pastedScript =
    existing.transcript &&
    existing.transcript.length > 80 &&
    existing.transcriptSource !== "none" &&
    existing.transcriptSource !== "creator_meta"
      ? existing.transcript
      : undefined;

  await deleteVideo(id);
  return createAndProcessVideo(
    existing.youtubeUrl,
    existing.description?.trim() || undefined,
    pastedScript
  );
}

function normalizeUrl(videoId: string, original: string) {
  if (original.includes("youtube.com") || original.includes("youtu.be")) {
    return original.trim();
  }
  return `https://www.youtube.com/watch?v=${videoId}`;
}
