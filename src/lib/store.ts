import fs from "fs";
import path from "path";
import type { ReportType, VideoRecord } from "./types";

const DATA_DIR = process.env.VERCEL
  ? path.join("/tmp", "youtube-factcheck-data")
  : path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "videos.json");

function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ videos: [] }, null, 2), "utf-8");
  }
}

function normalizeVideo(raw: VideoRecord): VideoRecord {
  const source = String(raw.transcriptSource ?? "none");
  const allowed = new Set([
    "youtube",
    "youtube_auto",
    "speech_text",
    "pasted",
    "creator_meta",
    "none",
  ]);
  const rt = (raw.reportType ?? "C") as ReportType;
  return {
    ...raw,
    description: raw.description ?? "",
    chapters: raw.chapters ?? [],
    summaryBullets: raw.summaryBullets ?? [],
    scriptNotice: raw.scriptNotice,
    reportType: ["H", "S", "C", "P"].includes(rt) ? rt : "C",
    report: raw.report ?? null,
    transcriptSource: (allowed.has(source)
      ? source
      : "none") as VideoRecord["transcriptSource"],
  };
}

export function readAllVideos(): VideoRecord[] {
  ensureDb();
  const raw = fs.readFileSync(DB_FILE, "utf-8");
  const parsed = JSON.parse(raw) as { videos: VideoRecord[] };
  return (parsed.videos ?? []).map(normalizeVideo);
}

export function writeAllVideos(videos: VideoRecord[]) {
  ensureDb();
  fs.writeFileSync(DB_FILE, JSON.stringify({ videos }, null, 2), "utf-8");
}

export function getVideo(id: string): VideoRecord | undefined {
  return readAllVideos().find((v) => v.id === id);
}

export function upsertVideo(video: VideoRecord): VideoRecord {
  const videos = readAllVideos();
  const idx = videos.findIndex((v) => v.id === video.id);
  if (idx >= 0) videos[idx] = video;
  else videos.unshift(video);
  writeAllVideos(videos);
  return video;
}

export function deleteVideo(id: string): boolean {
  const videos = readAllVideos();
  const next = videos.filter((v) => v.id !== id);
  if (next.length === videos.length) return false;
  writeAllVideos(next);
  return true;
}

export function searchVideos(query: string): VideoRecord[] {
  const q = query.trim().toLowerCase();
  if (!q) return readAllVideos();
  return readAllVideos().filter((v) => {
    const hay = [
      v.title,
      v.channel,
      v.description,
      v.overview,
      v.reportType,
      v.youtubeUrl,
      ...(v.summaryBullets ?? []),
      ...(v.chapters ?? []).map((c) => c.title),
      ...v.tags,
      ...v.items.map((i) => i.statement),
      ...v.factChecks.map((f) => f.explanation),
      v.report?.summaryExcerpt ?? "",
      ...(v.report?.sections?.map((s) => `${s.heading} ${s.body}`) ?? []),
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}
