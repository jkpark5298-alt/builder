import type { TypedReport, VideoRecord } from "./types";
import { sanitizePdfFilePart } from "./pdf-filename";

export const ARCHIVE_APP_FILE_KIND = "yfc-archive";
export const APP_FILE_TAG = "app-file";

export function isAppFileItem(
  video: Pick<VideoRecord, "tags">
): boolean {
  return (video.tags ?? []).includes(APP_FILE_TAG);
}

export type AppFileListItem = {
  id: string;
  title: string;
  inputMode: "youtube" | "report";
  importedAt: string;
  exists: boolean;
  href: string | null;
};
export const ARCHIVE_APP_FILE_VERSION = 1;
export const ARCHIVE_APP_FILE_EXT = ".yfc";

export type ArchiveAppFile = {
  kind: typeof ARCHIVE_APP_FILE_KIND;
  version: number;
  star: true;
  exportedAt: string;
  title: string;
  video: ArchiveAppVideo;
};

type ArchiveAppVideo = Pick<
  VideoRecord,
  | "inputMode"
  | "youtubeUrl"
  | "title"
  | "channel"
  | "sourceUrl"
  | "inputBodyHtml"
  | "articleImages"
  | "thumbnailUrl"
  | "publishedAt"
  | "description"
  | "chapters"
  | "transcript"
  | "transcriptSource"
  | "overview"
  | "summarySource"
  | "summaryBullets"
  | "items"
  | "factChecks"
  | "skipFactCheck"
  | "factCheckDecision"
  | "reportType"
  | "report"
  | "reportSource"
  | "reportWriteNotice"
  | "status"
  | "tags"
  | "userTags"
  | "scriptNotice"
>;

export function archiveAppFileName(title: string): string {
  return `★${sanitizePdfFilePart(title || "보고서", 48)}${ARCHIVE_APP_FILE_EXT}`;
}

export function buildArchiveAppFile(
  video: Pick<VideoRecord, keyof ArchiveAppVideo> & { report?: TypedReport | null }
): ArchiveAppFile {
  const title = (video.title || video.report?.meta.title || "보고서").trim();
  return {
    kind: ARCHIVE_APP_FILE_KIND,
    version: ARCHIVE_APP_FILE_VERSION,
    star: true,
    exportedAt: new Date().toISOString(),
    title,
    video: {
      inputMode: video.inputMode,
      youtubeUrl: video.youtubeUrl,
      title,
      channel: video.channel || "직접 입력",
      sourceUrl: video.sourceUrl,
      inputBodyHtml: video.inputBodyHtml,
      articleImages: video.articleImages,
      thumbnailUrl: video.thumbnailUrl,
      publishedAt: video.publishedAt,
      description: video.description,
      chapters: video.chapters || [],
      transcript: video.transcript || "",
      transcriptSource: video.transcriptSource || "none",
      overview: video.overview || "",
      summarySource: video.summarySource,
      summaryBullets: video.summaryBullets || [],
      items: video.items || [],
      factChecks: video.factChecks || [],
      skipFactCheck: video.skipFactCheck,
      factCheckDecision: video.factCheckDecision,
      reportType: video.reportType || "C",
      report: video.report ?? null,
      reportSource: video.reportSource,
      reportWriteNotice: video.reportWriteNotice,
      status: video.status,
      tags: video.tags || [],
      userTags: video.userTags,
      scriptNotice: video.scriptNotice,
    },
  };
}

export function parseArchiveAppFile(raw: unknown): ArchiveAppFile {
  if (!raw || typeof raw !== "object") {
    throw new Error("앱 파일이 아닙니다.");
  }
  const data = raw as Partial<ArchiveAppFile>;
  if (data.kind !== ARCHIVE_APP_FILE_KIND) {
    throw new Error("이 앱에서 저장한 파일만 불러올 수 있습니다. (★ .yfc)");
  }
  if (typeof data.version !== "number" || data.version > ARCHIVE_APP_FILE_VERSION) {
    throw new Error("이 앱 파일 버전을 읽지 못했습니다.");
  }
  const video = data.video;
  if (!video || typeof video !== "object") {
    throw new Error("앱 파일에 보고서가 없습니다.");
  }
  const title = (video.title || data.title || "").trim();
  if (title.length < 2) {
    throw new Error("앱 파일 제목이 없습니다.");
  }
  return {
    kind: ARCHIVE_APP_FILE_KIND,
    version: ARCHIVE_APP_FILE_VERSION,
    star: true,
    exportedAt: typeof data.exportedAt === "string" ? data.exportedAt : new Date().toISOString(),
    title,
    video: {
      ...video,
      title,
      inputMode: video.inputMode === "youtube" ? "youtube" : video.inputMode,
      youtubeUrl: typeof video.youtubeUrl === "string" ? video.youtubeUrl : "",
      channel: video.channel || "직접 입력",
      description: video.description || "",
      chapters: Array.isArray(video.chapters) ? video.chapters : [],
      transcript: video.transcript || "",
      overview: video.overview || "",
      summaryBullets: video.summaryBullets || [],
      items: Array.isArray(video.items) ? video.items : [],
      factChecks: Array.isArray(video.factChecks) ? video.factChecks : [],
      reportType: video.reportType || "C",
      report: video.report ?? null,
      status: video.status || "awaiting_factcheck",
      tags: Array.isArray(video.tags) ? video.tags : [],
    },
  };
}

export async function downloadArchiveAppFile(
  video: Pick<VideoRecord, keyof ArchiveAppVideo> & {
    report?: TypedReport | null;
    id?: string;
  }
) {
  const id = typeof video.id === "string" ? video.id.trim() : "";
  if (id) {
    const res = await fetch("/api/app-files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      throw new Error(data.error || "앱 파일 목록에 넣지 못했습니다.");
    }
    window.dispatchEvent(
      new CustomEvent("yfc-archive-saved", { detail: { id } })
    );
  }
  const file = buildArchiveAppFile(video);
  const name = archiveAppFileName(file.title);
  const blob = new Blob([JSON.stringify(file, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const native = new File([blob], name, {
    type: "application/json",
  });
  const shareData = { files: [native], title: name };
  if (
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function" &&
    navigator.canShare(shareData)
  ) {
    try {
      await navigator.share(shareData);
      return;
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.setAttribute("download", name);
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 800);
}
