import fs from "fs";
import path from "path";
import { del, get, list, put } from "@vercel/blob";
import type { ReportType, VideoRecord } from "./types";

/**
 * Vercel `/var/task` 는 읽기 전용.
 * 공유 저장소(Blob) 없을 때만 `/tmp` 사용 — 인스턴스마다 달라 404 원인.
 */
function resolveDataDir(): string {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return path.join("/tmp", "youtube-factcheck", "data");
  }
  return path.join(process.cwd(), "data");
}

const DATA_DIR = resolveDataDir();
const DB_FILE = path.join(DATA_DIR, "videos.json");
const BLOB_PREFIX = "videos/";

function useBlob(): boolean {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN?.trim() ||
      process.env.BLOB_STORE_ID?.trim() ||
      // Vercel 런타임 OIDC + 연결된 Blob 스토어
      (process.env.VERCEL && process.env.VERCEL_OIDC_TOKEN)
  );
}

function blobTokenOpts(): { token?: string } {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  return token ? { token } : {};
}

function ensureLocalDb() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify({ videos: [] }, null, 2), "utf-8");
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `로컬 저장소를 열 수 없습니다 (${DATA_DIR}). ${msg}`
    );
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

function readLocalVideos(): VideoRecord[] {
  ensureLocalDb();
  const raw = fs.readFileSync(DB_FILE, "utf-8");
  const parsed = JSON.parse(raw) as { videos: VideoRecord[] };
  return (parsed.videos ?? []).map(normalizeVideo);
}

function writeLocalVideos(videos: VideoRecord[]) {
  ensureLocalDb();
  fs.writeFileSync(DB_FILE, JSON.stringify({ videos }, null, 2), "utf-8");
}

function blobPath(id: string) {
  return `${BLOB_PREFIX}${id}.json`;
}

async function streamToJson<T>(stream: ReadableStream<Uint8Array>): Promise<T> {
  const text = await new Response(stream).text();
  return JSON.parse(text) as T;
}

/** public/private 스토어 모두 호환 */
async function readBlobVideo(id: string): Promise<VideoRecord | undefined> {
  const opts = blobTokenOpts();
  for (const access of ["private", "public"] as const) {
    try {
      const result = await get(blobPath(id), {
        access,
        useCache: false,
        ...opts,
      });
      if (!result?.stream) continue;
      const raw = await streamToJson<VideoRecord>(result.stream);
      return normalizeVideo(raw);
    } catch (e) {
      console.warn(`[store] blob get(${access}) failed for ${id}`, e);
    }
  }
  return undefined;
}

async function writeBlobVideo(video: VideoRecord): Promise<void> {
  const body = JSON.stringify(video);
  const base = {
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json" as const,
    ...blobTokenOpts(),
  };

  let lastError: unknown;
  for (const access of ["private", "public"] as const) {
    try {
      await put(blobPath(video.id), body, { ...base, access });
      return;
    } catch (e) {
      lastError = e;
      console.warn(`[store] blob put(${access}) failed`, e);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Vercel Blob에 저장하지 못했습니다. BLOB_READ_WRITE_TOKEN을 확인하세요.");
}

async function deleteBlobVideo(id: string): Promise<boolean> {
  try {
    await del(blobPath(id), blobTokenOpts());
    return true;
  } catch {
    return false;
  }
}

async function listBlobVideos(): Promise<VideoRecord[]> {
  try {
    const out: VideoRecord[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({
        prefix: BLOB_PREFIX,
        cursor,
        limit: 100,
        ...blobTokenOpts(),
      });
      for (const blob of page.blobs) {
        if (!blob.pathname.endsWith(".json")) continue;
        const id = blob.pathname
          .slice(BLOB_PREFIX.length)
          .replace(/\.json$/i, "");
        const video = await readBlobVideo(id);
        if (video) out.push(video);
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);

    return out.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  } catch (e) {
    console.error("[store] listBlobVideos failed", e);
    return [];
  }
}

export function storageMode(): "blob" | "local" {
  return useBlob() ? "blob" : "local";
}

export async function readAllVideos(): Promise<VideoRecord[]> {
  try {
    if (useBlob()) return await listBlobVideos();
    return readLocalVideos();
  } catch (e) {
    console.error("[store] readAllVideos failed", e);
    return [];
  }
}

export async function getVideo(id: string): Promise<VideoRecord | undefined> {
  if (useBlob()) return readBlobVideo(id);
  return readLocalVideos().find((v) => v.id === id);
}

export async function upsertVideo(video: VideoRecord): Promise<VideoRecord> {
  if (useBlob()) {
    await writeBlobVideo(video);
    return video;
  }
  // Vercel에서 Blob 없이 /tmp만 쓰면 다른 인스턴스에서 404
  if (process.env.VERCEL) {
    throw new Error(
      "배포 환경에 BLOB_READ_WRITE_TOKEN(또는 Blob 스토어)이 필요합니다. Vercel Storage에서 Blob을 연결하세요."
    );
  }
  const videos = readLocalVideos();
  const idx = videos.findIndex((v) => v.id === video.id);
  if (idx >= 0) videos[idx] = video;
  else videos.unshift(video);
  writeLocalVideos(videos);
  return video;
}

export async function deleteVideo(id: string): Promise<boolean> {
  if (useBlob()) {
    const existing = await readBlobVideo(id);
    if (!existing) return false;
    return deleteBlobVideo(id);
  }
  const videos = readLocalVideos();
  const next = videos.filter((v) => v.id !== id);
  if (next.length === videos.length) return false;
  writeLocalVideos(next);
  return true;
}

export async function searchVideos(query: string): Promise<VideoRecord[]> {
  try {
    const q = query.trim().toLowerCase();
    const all = await readAllVideos();
    if (!q) return all;
    return all.filter((v) => {
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
  } catch (e) {
    console.error("[store] searchVideos failed", e);
    return [];
  }
}
