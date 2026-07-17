import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

/**
 * Neon(Postgres) 연결.
 * DATABASE_URL 이 있으면 DB 저장소를 사용하고, 없으면 로컬 파일 저장소로 폴백.
 */
function readEnv(name: string): string | undefined {
  const env = process.env as Record<string, string | undefined>;
  const v = env[name];
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length ? t : undefined;
}

export function databaseUrl(): string | undefined {
  return (
    readEnv("DATABASE_URL") ||
    readEnv("POSTGRES_URL") ||
    readEnv("POSTGRES_PRISMA_URL") ||
    readEnv("NEON_DATABASE_URL")
  );
}

export function hasDatabase(): boolean {
  return Boolean(databaseUrl());
}

let client: NeonQueryFunction<false, false> | null = null;
let schemaReady: Promise<void> | null = null;

export function sql(): NeonQueryFunction<false, false> {
  const url = databaseUrl();
  if (!url) {
    throw new Error(
      "DATABASE_URL 이 설정되지 않았습니다. Neon(무료 Postgres) 연결 문자열을 환경 변수에 추가하세요."
    );
  }
  if (!client) {
    client = neon(url);
  }
  return client;
}

/** videos 테이블이 없으면 생성 (최초 1회) */
export async function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    const db = sql();
    schemaReady = (async () => {
      await db`
        CREATE TABLE IF NOT EXISTS videos (
          id TEXT PRIMARY KEY,
          data JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
    })().catch((e) => {
      schemaReady = null;
      throw e;
    });
  }
  return schemaReady;
}
