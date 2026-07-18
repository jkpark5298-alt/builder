import fs from "fs";
import path from "path";
import type { ReportType, VideoRecord } from "./types";
import { databaseUrl, ensureSchema, hasDatabase, sql } from "./db";

/**
 * 저장소: Neon(Postgres)이 기본. DATABASE_URL 이 없으면 로컬 파일로 폴백(개발용).
 */
function readEnv(name: string): string | undefined {
  const env = process.env as Record<string, string | undefined>;
  const v = env[name];
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length ? t : undefined;
}

function onVercel(): boolean {
  return Boolean(readEnv("VERCEL") || readEnv("AWS_LAMBDA_FUNCTION_NAME"));
}

function resolveDataDir(): string {
  if (onVercel()) {
    return path.join("/tmp", "youtube-factcheck", "data");
  }
  return path.join(process.cwd(), "data");
}

const DATA_DIR = resolveDataDir();
const DB_FILE = path.join(DATA_DIR, "videos.json");

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
    throw new Error(`로컬 저장소를 열 수 없습니다 (${DATA_DIR}). ${msg}`);
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
  const summaryAllowed = new Set(["ai", "manual", "fallback", "none"]);
  let summarySource = String(raw.summarySource ?? "");
  if (!summaryAllowed.has(summarySource)) {
    const ov = raw.overview ?? "";
    if (!ov.trim()) summarySource = "none";
    else if (
      /OPENAI_API_KEY|발췌 메모|다시 시도|구간 발췌/i.test(ov) ||
      ov.length < 350
    )
      summarySource = "fallback";
    else summarySource = "ai";
  }
  return {
    ...raw,
    description: raw.description ?? "",
    chapters: raw.chapters ?? [],
    summaryBullets: raw.summaryBullets ?? [],
    scriptNotice: raw.scriptNotice,
    summarySource: summarySource as VideoRecord["summarySource"],
    reportType: ["H", "S", "C", "P"].includes(rt) ? rt : "C",
    report: raw.report ?? null,
    transcriptSource: (allowed.has(source)
      ? source
      : "none") as VideoRecord["transcriptSource"],
  };
}

/* ------------------------------------------------------------------ */
/* 로컬 파일 (개발용 폴백)                                             */
/* ------------------------------------------------------------------ */

function readLocalVideos(): VideoRecord[] {
  ensureLocalDb();
  const raw = fs.readFileSync(DB_FILE, "utf-8");
  const parsed = JSON.parse(raw) as { videos: VideoRecord[] };
  return (parsed.videos ?? []).map(normalizeVideo);
}

function readLocalVideosSafe(): VideoRecord[] {
  try {
    return readLocalVideos();
  } catch {
    return [];
  }
}

function writeLocalVideos(videos: VideoRecord[]) {
  ensureLocalDb();
  fs.writeFileSync(DB_FILE, JSON.stringify({ videos }, null, 2), "utf-8");
}

function upsertLocalVideo(video: VideoRecord): VideoRecord {
  const videos = readLocalVideosSafe();
  const idx = videos.findIndex((v) => v.id === video.id);
  if (idx >= 0) videos[idx] = video;
  else videos.unshift(video);
  writeLocalVideos(videos);
  return video;
}

function deleteLocalVideo(id: string): boolean {
  const videos = readLocalVideosSafe();
  const next = videos.filter((v) => v.id !== id);
  if (next.length === videos.length) return false;
  writeLocalVideos(next);
  return true;
}

/* ------------------------------------------------------------------ */
/* Postgres (Neon)                                                    */
/* ------------------------------------------------------------------ */

function rowToVideo(row: { data: unknown }): VideoRecord {
  const data =
    typeof row.data === "string"
      ? (JSON.parse(row.data) as VideoRecord)
      : (row.data as VideoRecord);
  return normalizeVideo(data);
}

async function dbReadAll(): Promise<VideoRecord[]> {
  await ensureSchema();
  const db = sql();
  const rows = (await db`
    SELECT data FROM videos
    ORDER BY (data->>'createdAt') DESC NULLS LAST
  `) as Array<{ data: unknown }>;
  return rows.map(rowToVideo);
}

async function dbGet(id: string): Promise<VideoRecord | undefined> {
  await ensureSchema();
  const db = sql();
  const rows = (await db`
    SELECT data FROM videos WHERE id = ${id} LIMIT 1
  `) as Array<{ data: unknown }>;
  if (!rows.length) return undefined;
  return rowToVideo(rows[0]);
}

async function dbUpsert(video: VideoRecord): Promise<void> {
  await ensureSchema();
  const db = sql();
  const json = JSON.stringify(video);
  await db`
    INSERT INTO videos (id, data, created_at, updated_at)
    VALUES (${video.id}, ${json}::jsonb, now(), now())
    ON CONFLICT (id)
    DO UPDATE SET data = EXCLUDED.data, updated_at = now()
  `;
}

async function dbDelete(id: string): Promise<boolean> {
  await ensureSchema();
  const db = sql();
  const rows = (await db`
    DELETE FROM videos WHERE id = ${id} RETURNING id
  `) as Array<{ id: string }>;
  return rows.length > 0;
}

/* ------------------------------------------------------------------ */
/* 진단                                                               */
/* ------------------------------------------------------------------ */

export function storageMode(): "postgres" | "local" {
  return hasDatabase() ? "postgres" : "local";
}

export function storageDiagnostics() {
  return {
    mode: storageMode(),
    onVercel: onVercel(),
    hasDatabaseUrl: Boolean(databaseUrl()),
  };
}

/* ------------------------------------------------------------------ */
/* 공개 API                                                           */
/* ------------------------------------------------------------------ */

export async function readAllVideos(): Promise<VideoRecord[]> {
  try {
    if (hasDatabase()) return await dbReadAll();
    return readLocalVideos();
  } catch (e) {
    console.error("[store] readAllVideos failed", e);
    if (!onVercel()) return readLocalVideosSafe();
    return [];
  }
}

export async function getVideo(id: string): Promise<VideoRecord | undefined> {
  if (hasDatabase()) {
    try {
      return await dbGet(id);
    } catch (e) {
      console.error("[store] getVideo failed", e);
      if (!onVercel()) return readLocalVideosSafe().find((v) => v.id === id);
      throw e;
    }
  }
  return readLocalVideos().find((v) => v.id === id);
}

export async function upsertVideo(video: VideoRecord): Promise<VideoRecord> {
  if (hasDatabase()) {
    try {
      await dbUpsert(video);
      return video;
    } catch (e) {
      if (onVercel()) throw e;
      console.warn("[store] db write failed → local file fallback", e);
      return upsertLocalVideo(video);
    }
  }
  return upsertLocalVideo(video);
}

export async function deleteVideo(id: string): Promise<boolean> {
  if (hasDatabase()) {
    try {
      return await dbDelete(id);
    } catch (e) {
      if (onVercel()) throw e;
      console.warn("[store] db delete failed → local file fallback", e);
      return deleteLocalVideo(id);
    }
  }
  return deleteLocalVideo(id);
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
