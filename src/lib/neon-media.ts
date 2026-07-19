import { ensureSchema, hasDatabase, sql } from "./db";

let mediaSchemaReady: Promise<void> | null = null;

async function ensureMediaSchema(): Promise<void> {
  if (!hasDatabase()) {
    throw new Error("DATABASE_URL 이 없어 Neon 미디어 저장소를 쓸 수 없습니다.");
  }
  await ensureSchema();
  if (!mediaSchemaReady) {
    mediaSchemaReady = (async () => {
      // 신규 테이블명 — 구 media_blobs(BYTEA)와 충돌 방지
      await sql()`
        CREATE TABLE IF NOT EXISTS media_files (
          id TEXT PRIMARY KEY,
          content_type TEXT NOT NULL,
          data_base64 TEXT NOT NULL,
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

/** Neon에 이미지 저장 → /api/media/{id} URL 반환 */
export async function putNeonMedia(
  buffer: Buffer,
  contentType: string,
  idHint?: string
): Promise<string> {
  await ensureMediaSchema();
  const safeHint = (idHint || "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 60);
  const key = `${safeHint || "img"}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`.slice(0, 100);
  const dataBase64 = buffer.toString("base64");
  await sql()`
    INSERT INTO media_files (id, content_type, data_base64)
    VALUES (${key}, ${contentType}, ${dataBase64})
    ON CONFLICT (id) DO UPDATE SET
      content_type = EXCLUDED.content_type,
      data_base64 = EXCLUDED.data_base64
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

  // 신규 테이블
  try {
    const rows = await sql()`
      SELECT content_type, data_base64 FROM media_files WHERE id = ${key} LIMIT 1
    `;
    const row = rows[0] as
      | { content_type?: string; data_base64?: string }
      | undefined;
    if (row?.data_base64) {
      return {
        buffer: Buffer.from(row.data_base64, "base64"),
        contentType: row.content_type || "application/octet-stream",
      };
    }
  } catch {
    /* ignore */
  }

  // 구 media_blobs 호환 (BYTEA 또는 base64)
  try {
    const rows = await sql()`
      SELECT content_type, data_base64 FROM media_blobs WHERE id = ${key} LIMIT 1
    `;
    const row = rows[0] as
      | { content_type?: string; data_base64?: string }
      | undefined;
    if (row?.data_base64) {
      return {
        buffer: Buffer.from(row.data_base64, "base64"),
        contentType: row.content_type || "application/octet-stream",
      };
    }
  } catch {
    /* ignore */
  }

  try {
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
  } catch {
    return null;
  }
}
