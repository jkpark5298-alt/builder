import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import type { LibraryImage } from "./types";
import { databaseUrl, ensureSchema, hasDatabase, sql } from "./db";
import { persistMediaDataUrl } from "./media-store";

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
const LIB_FILE = path.join(DATA_DIR, "image-library.json");

function ensureLocalLib() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(LIB_FILE)) {
    fs.writeFileSync(LIB_FILE, JSON.stringify({ images: [] }, null, 2), "utf-8");
  }
}

export function normalizeLibraryImage(raw: LibraryImage): LibraryImage {
  return {
    id: String(raw.id || uuid()),
    url: String(raw.url || "").trim(),
    memo: String(raw.memo ?? "").trim(),
    tag: raw.tag?.trim() || undefined,
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || new Date().toISOString(),
  };
}

function readLocalImages(): LibraryImage[] {
  ensureLocalLib();
  const parsed = JSON.parse(fs.readFileSync(LIB_FILE, "utf-8")) as {
    images?: LibraryImage[];
  };
  return (parsed.images ?? [])
    .map(normalizeLibraryImage)
    .filter((img) => Boolean(img.url));
}

function writeLocalImages(images: LibraryImage[]) {
  ensureLocalLib();
  fs.writeFileSync(LIB_FILE, JSON.stringify({ images }, null, 2), "utf-8");
}

function rowToImage(row: { data: unknown }): LibraryImage {
  const data =
    typeof row.data === "string"
      ? (JSON.parse(row.data) as LibraryImage)
      : (row.data as LibraryImage);
  return normalizeLibraryImage(data);
}

async function dbReadAll(): Promise<LibraryImage[]> {
  await ensureSchema();
  const db = sql();
  const rows = (await db`
    SELECT data FROM image_library
    ORDER BY (data->>'createdAt') DESC NULLS LAST
  `) as Array<{ data: unknown }>;
  return rows.map(rowToImage).filter((img) => Boolean(img.url));
}

async function dbGet(id: string): Promise<LibraryImage | undefined> {
  await ensureSchema();
  const db = sql();
  const rows = (await db`
    SELECT data FROM image_library WHERE id = ${id} LIMIT 1
  `) as Array<{ data: unknown }>;
  if (!rows.length) return undefined;
  return rowToImage(rows[0]!);
}

async function dbUpsert(image: LibraryImage): Promise<void> {
  await ensureSchema();
  const db = sql();
  const json = JSON.stringify(image);
  await db`
    INSERT INTO image_library (id, data, created_at, updated_at)
    VALUES (${image.id}, ${json}::jsonb, now(), now())
    ON CONFLICT (id)
    DO UPDATE SET data = EXCLUDED.data, updated_at = now()
  `;
}

async function dbDelete(id: string): Promise<boolean> {
  await ensureSchema();
  const db = sql();
  const rows = (await db`
    DELETE FROM image_library WHERE id = ${id} RETURNING id
  `) as Array<{ id: string }>;
  return rows.length > 0;
}

export async function readAllLibraryImages(): Promise<LibraryImage[]> {
  try {
    if (hasDatabase()) return await dbReadAll();
    return readLocalImages();
  } catch (e) {
    console.error("[image-library] readAll failed", e);
    if (!onVercel()) {
      try {
        return readLocalImages();
      } catch {
        return [];
      }
    }
    return [];
  }
}

export async function getLibraryImage(
  id: string
): Promise<LibraryImage | undefined> {
  if (hasDatabase()) {
    try {
      return await dbGet(id);
    } catch (e) {
      console.error("[image-library] get failed", e);
      if (!onVercel()) return readLocalImages().find((i) => i.id === id);
      throw e;
    }
  }
  return readLocalImages().find((i) => i.id === id);
}

export async function upsertLibraryImage(
  image: LibraryImage
): Promise<LibraryImage> {
  const prepared = normalizeLibraryImage({
    ...image,
    updatedAt: new Date().toISOString(),
  });
  if (!prepared.url) {
    throw new Error("이미지 URL이 필요합니다.");
  }
  if (hasDatabase()) {
    try {
      await dbUpsert(prepared);
      return prepared;
    } catch (e) {
      if (onVercel()) throw e;
      console.warn("[image-library] db write → local", e);
    }
  }
  const all = readLocalImages();
  const idx = all.findIndex((i) => i.id === prepared.id);
  if (idx >= 0) all[idx] = prepared;
  else all.unshift(prepared);
  writeLocalImages(all);
  return prepared;
}

export async function deleteLibraryImage(id: string): Promise<boolean> {
  if (hasDatabase()) {
    try {
      return await dbDelete(id);
    } catch (e) {
      if (onVercel()) throw e;
      console.warn("[image-library] db delete → local", e);
    }
  }
  const all = readLocalImages();
  const next = all.filter((i) => i.id !== id);
  if (next.length === all.length) return false;
  writeLocalImages(next);
  return true;
}

export async function searchLibraryImages(
  query: string
): Promise<LibraryImage[]> {
  const q = query.trim().toLowerCase();
  const all = await readAllLibraryImages();
  if (!q) return all;
  return all.filter((img) => {
    const hay = [img.memo, img.tag ?? "", img.url].join(" ").toLowerCase();
    return hay.includes(q);
  });
}

/** data URL 또는 기존 URL로 라이브러리 항목 생성 */
export async function createLibraryImage(opts: {
  dataUrl?: string;
  url?: string;
  memo?: string;
  tag?: string;
}): Promise<LibraryImage> {
  let url = opts.url?.trim() ?? "";
  if (opts.dataUrl?.startsWith("data:image/")) {
    url = await persistMediaDataUrl(opts.dataUrl, {
      prefix: "library",
    });
  }
  if (!url) {
    throw new Error("이미지 데이터가 필요합니다.");
  }
  const now = new Date().toISOString();
  return upsertLibraryImage({
    id: uuid(),
    url,
    memo: opts.memo?.trim() ?? "",
    tag: opts.tag?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  });
}

export function storageHasDatabase(): boolean {
  return hasDatabase() || Boolean(databaseUrl());
}
