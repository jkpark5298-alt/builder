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

/** Neon에 이미지 저장 → /api/media/{id} URL 반환.
 *  idHint가 안정적이면(해시 포함) 같은 파일을 재사용해 용량을 줄인다.
 */
export async function putNeonMedia(
  buffer: Buffer,
  contentType: string,
  idHint?: string
): Promise<string> {
  await ensureMediaSchema();
  const safeHint = (idHint || "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 80);
  const looksStable = /_[a-f0-9]{16,}$/i.test(safeHint);
  const key = (
    looksStable
      ? safeHint
      : `${safeHint || "img"}_${Date.now().toString(36)}_${Math.random()
          .toString(36)
          .slice(2, 8)}`
  ).slice(0, 100);
  const dataBase64 = buffer.toString("base64");

  if (looksStable) {
    const existing = await sql()`
      SELECT id FROM media_files WHERE id = ${key} LIMIT 1
    `;
    if ((existing as Array<{ id?: string }>).length > 0) {
      return `/api/media/${encodeURIComponent(key)}`;
    }
  }

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

export async function neonMediaStats(): Promise<{
  files: number;
  approxBytes: number;
  approxMb: number;
}> {
  if (!hasDatabase()) {
    return { files: 0, approxBytes: 0, approxMb: 0 };
  }
  await ensureMediaSchema();
  try {
    const rows = await sql()`
      SELECT
        COUNT(*)::int AS files,
        COALESCE(SUM(LENGTH(data_base64)), 0)::bigint AS b64_len
      FROM media_files
    `;
    const row = rows[0] as { files?: number; b64_len?: string | number } | undefined;
    const files = Number(row?.files ?? 0);
    const b64Len = Number(row?.b64_len ?? 0);
    // base64 ≈ 4/3 of binary; approx binary size
    const approxBytes = Math.round((b64Len * 3) / 4);
    return {
      files,
      approxBytes,
      approxMb: Math.round((approxBytes / (1024 * 1024)) * 10) / 10,
    };
  } catch {
    return { files: 0, approxBytes: 0, approxMb: 0 };
  }
}

export async function listNeonMediaIds(): Promise<string[]> {
  if (!hasDatabase()) return [];
  await ensureMediaSchema();
  try {
    const rows = await sql()`SELECT id FROM media_files`;
    return (rows as Array<{ id?: string }>)
      .map((r) => r.id)
      .filter((id): id is string => Boolean(id));
  } catch {
    return [];
  }
}

/** 보고서 JSON에서 참조되지 않는 Neon 미디어 삭제 */
export async function purgeUnusedNeonMedia(
  referencedIds: Set<string>
): Promise<{ deleted: number; kept: number; scanned: number }> {
  if (!hasDatabase()) {
    return { deleted: 0, kept: 0, scanned: 0 };
  }
  await ensureMediaSchema();
  const ids = await listNeonMediaIds();
  let deleted = 0;
  let kept = 0;
  for (const id of ids) {
    if (referencedIds.has(id)) {
      kept += 1;
      continue;
    }
    try {
      await sql()`DELETE FROM media_files WHERE id = ${id}`;
      deleted += 1;
    } catch {
      /* skip */
    }
  }
  return { deleted, kept, scanned: ids.length };
}

