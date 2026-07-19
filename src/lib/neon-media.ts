import { ensureSchema, hasDatabase, sql } from "./db";

let mediaSchemaReady: Promise<void> | null = null;

async function ensureMediaSchema(): Promise<void> {
  if (!hasDatabase()) {
    throw new Error("DATABASE_URL 이 없어 Neon 미디어 저장소를 쓸 수 없습니다.");
  }
  await ensureSchema();
  if (!mediaSchemaReady) {
    mediaSchemaReady = (async () => {
      await sql()`
        CREATE TABLE IF NOT EXISTS media_blobs (
          id TEXT PRIMARY KEY,
          content_type TEXT NOT NULL,
          bytes BYTEA NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
    })().catch((e) => {
      mediaSchemaReady = null;
      throw e;
    });
  }
  return mediaSchemaReady;
}

/** Neon에 바이너리 저장 → /api/media/{id} URL 반환 */
export async function putNeonMedia(
  buffer: Buffer,
  contentType: string,
  idHint?: string
): Promise<string> {
  await ensureMediaSchema();
  const id = (idHint || cryptoRandom()).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  const key = id || cryptoRandom();
  // neon serverless accepts Uint8Array for BYTEA
  const bytes = new Uint8Array(buffer);
  await sql()`
    INSERT INTO media_blobs (id, content_type, bytes)
    VALUES (${key}, ${contentType}, ${bytes})
    ON CONFLICT (id) DO UPDATE SET
      content_type = EXCLUDED.content_type,
      bytes = EXCLUDED.bytes
  `;
  return `/api/media/${encodeURIComponent(key)}`;
}

export async function getNeonMedia(id: string): Promise<{
  buffer: Buffer;
  contentType: string;
} | null> {
  if (!hasDatabase()) return null;
  await ensureMediaSchema();
  const key = decodeURIComponent(id);
  if (!key || key.includes("..") || key.includes("/")) return null;
  const rows = await sql()`
    SELECT content_type, bytes FROM media_blobs WHERE id = ${key} LIMIT 1
  `;
  const row = rows[0] as { content_type?: string; bytes?: unknown } | undefined;
  if (!row?.bytes) return null;
  const buffer = Buffer.isBuffer(row.bytes)
    ? row.bytes
    : Buffer.from(row.bytes as ArrayBuffer);
  return {
    buffer,
    contentType: row.content_type || "application/octet-stream",
  };
}

function cryptoRandom(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
