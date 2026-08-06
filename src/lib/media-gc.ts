import fs from "fs";
import path from "path";
import { del, list } from "@vercel/blob";
import { hasDatabase } from "./db";

function readEnv(name: string): string | undefined {
  const v = process.env[name];
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length ? t : undefined;
}

function blobToken(): string | undefined {
  return readEnv("BLOB_READ_WRITE_TOKEN");
}

function onVercel(): boolean {
  return Boolean(readEnv("VERCEL") || readEnv("AWS_LAMBDA_FUNCTION_NAME"));
}

function mediaDir(): string {
  if (onVercel()) {
    return path.join("/tmp", "youtube-factcheck", "media");
  }
  return path.join(process.cwd(), "data", "media");
}

/** JSON 어디에든 등장하는 미디어 URL 수집 */
export function collectMediaUrlsFromValue(data: unknown): Set<string> {
  const urls = new Set<string>();
  const re =
    /(https?:\/\/[^\s"'<>]+|(?:^|[^\w])\/api\/media\/[^\s"'<>]+)/gi;
  const walk = (v: unknown) => {
    if (typeof v === "string") {
      if (
        v.startsWith("http://") ||
        v.startsWith("https://") ||
        v.startsWith("/api/media/")
      ) {
        urls.add(v.trim());
      }
      let m: RegExpExecArray | null;
      const matcher = new RegExp(re.source, "gi");
      while ((m = matcher.exec(v))) {
        const raw = m[0].replace(/^[^\w/]+/, "").trim();
        if (raw.startsWith("/api/media/") || raw.startsWith("http")) {
          urls.add(raw.replace(/[)\\],.;]+$/, ""));
        }
      }
      return;
    }
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    if (v && typeof v === "object") {
      for (const x of Object.values(v as Record<string, unknown>)) walk(x);
    }
  };
  walk(data);
  return urls;
}

export function isNeonMediaUrl(url: string): boolean {
  return url.startsWith("/api/media/");
}

export function isVercelBlobUrl(url: string): boolean {
  return /vercel-storage\.com/i.test(url) || /blob\.vercel-storage/i.test(url);
}

function neonIdFromUrl(url: string): string | null {
  if (!isNeonMediaUrl(url)) return null;
  try {
    const id = decodeURIComponent(url.replace(/^\/api\/media\//, "").split("?")[0] || "");
    if (!id || id.includes("..") || id.includes("/")) return null;
    return id;
  } catch {
    return null;
  }
}

async function deleteNeonMedia(id: string): Promise<boolean> {
  if (!hasDatabase()) return false;
  const { ensureSchema, sql } = await import("./db");
  await ensureSchema();
  try {
    await sql()`DELETE FROM media_files WHERE id = ${id}`;
    return true;
  } catch {
    return false;
  }
}

async function deleteLocalMedia(url: string): Promise<boolean> {
  const id = neonIdFromUrl(url);
  if (!id) return false;
  try {
    const filePath = path.join(mediaDir(), id);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/** 단일 URL 삭제 (Blob / Neon / 로컬). 실패해도 throw 하지 않음. */
export async function deletePersistedMediaUrl(url: string): Promise<boolean> {
  const u = url.trim();
  if (!u || u.startsWith("data:")) return false;

  if (isVercelBlobUrl(u)) {
    const token = blobToken();
    if (!token) return false;
    try {
      await del(u, { token });
      return true;
    } catch (e) {
      console.warn("[media-gc] blob del failed", u, e);
      return false;
    }
  }

  if (isNeonMediaUrl(u)) {
    const id = neonIdFromUrl(u);
    if (!id) return false;
    const neonOk = await deleteNeonMedia(id);
    const localOk = await deleteLocalMedia(u);
    return neonOk || localOk;
  }

  return false;
}

/**
 * 전역 참조 집합에 없는 URL만 삭제.
 * @returns 삭제 시도·성공 수
 */
export async function purgeUnreferencedMediaUrls(
  candidates: string[],
  referenced: Set<string>
): Promise<{ deleted: number; skipped: number }> {
  let deleted = 0;
  let skipped = 0;
  const seen = new Set<string>();
  for (const url of candidates) {
    const u = url.trim();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    if (referenced.has(u)) {
      skipped += 1;
      continue;
    }
    if (await deletePersistedMediaUrl(u)) deleted += 1;
    else skipped += 1;
  }
  return { deleted, skipped };
}

/** Vercel Blob 스토어에서 prefix 아래 고아 파일 삭제 */
export async function purgeUnreferencedBlobs(
  referenced: Set<string>,
  prefix = "videos/"
): Promise<{ deleted: number; scanned: number }> {
  const token = blobToken();
  if (!token) return { deleted: 0, scanned: 0 };

  let cursor: string | undefined;
  let scanned = 0;
  let deleted = 0;
  const toDelete: string[] = [];

  do {
    const page = await list({
      prefix,
      cursor,
      limit: 1000,
      token,
    });
    for (const blob of page.blobs) {
      scanned += 1;
      if (!referenced.has(blob.url)) {
        toDelete.push(blob.url);
      }
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  // batch delete
  for (let i = 0; i < toDelete.length; i += 100) {
    const chunk = toDelete.slice(i, i + 100);
    try {
      await del(chunk, { token });
      deleted += chunk.length;
    } catch (e) {
      console.warn("[media-gc] blob batch del failed", e);
      for (const u of chunk) {
        if (await deletePersistedMediaUrl(u)) deleted += 1;
      }
    }
  }

  return { deleted, scanned };
}
