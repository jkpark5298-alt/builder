import { createHash } from "crypto";
import { ensureSchema, hasDatabase, sql } from "./db";

type RateEntry = {
  count: number;
  resetAt: number;
};

type RateState = Map<string, RateEntry>;

const globalRate = globalThis as typeof globalThis & {
  __youtubeFactcheckRateLimits?: RateState;
  __youtubeFactcheckRateLimitCleanupAt?: number;
};

const state: RateState =
  globalRate.__youtubeFactcheckRateLimits ??
  (globalRate.__youtubeFactcheckRateLimits = new Map());

export type RateLimitResult =
  | { ok: true; remaining: number; resetAt: number }
  | { ok: false; remaining: 0; resetAt: number; retryAfter: number };

export function clientIp(req: Request): string {
  const raw =
    req.headers.get("x-vercel-forwarded-for") ||
    req.headers.get("x-forwarded-for") ||
    req.headers.get("x-real-ip") ||
    "unknown";
  return raw.split(",")[0]?.trim() || "unknown";
}

/**
 * Neon 고정 윈도우 속도 제한. DB 장애/로컬 개발에서는 메모리 제한으로 폴백.
 * 외부 인증 도입 전까지 반복 클릭·자동 스크립트의 과도한 호출을 완화한다.
 */
export async function checkRateLimit(
  req: Request,
  scope: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  const now = Date.now();
  const ipHash = createHash("sha256")
    .update(clientIp(req))
    .digest("hex")
    .slice(0, 20);
  const bucket = Math.floor(now / windowMs);
  const key = `${scope}:${ipHash}:${bucket}`;
  const resetAt = (bucket + 1) * windowMs;

  if (hasDatabase()) {
    try {
      await ensureSchema();
      const db = sql();
      const rows = (await db`
        INSERT INTO api_rate_limits (bucket_key, request_count, expires_at)
        VALUES (${key}, 1, ${new Date(resetAt).toISOString()}::timestamptz)
        ON CONFLICT (bucket_key)
        DO UPDATE SET request_count = api_rate_limits.request_count + 1
        RETURNING request_count
      `) as Array<{ request_count: number }>;
      const count = Number(rows[0]?.request_count ?? 1);
      if (
        !globalRate.__youtubeFactcheckRateLimitCleanupAt ||
        now - globalRate.__youtubeFactcheckRateLimitCleanupAt > 60 * 60_000
      ) {
        globalRate.__youtubeFactcheckRateLimitCleanupAt = now;
        void db`
          DELETE FROM api_rate_limits
          WHERE expires_at < now() - interval '1 day'
        `.catch((e) => console.warn("[rate-limit] cleanup failed", e));
      }
      if (count > limit) {
        return {
          ok: false,
          remaining: 0,
          resetAt,
          retryAfter: Math.max(1, Math.ceil((resetAt - now) / 1000)),
        };
      }
      return {
        ok: true,
        remaining: Math.max(0, limit - count),
        resetAt,
      };
    } catch (e) {
      // 제한 저장소 장애가 본 기능까지 막지 않도록 인스턴스 제한으로 폴백
      console.warn("[rate-limit] database fallback", e);
    }
  }

  return checkMemoryLimit(key, limit, windowMs, now);
}

function checkMemoryLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number
): RateLimitResult {
  const current = state.get(key);

  if (!current || current.resetAt <= now) {
    const resetAt = now + windowMs;
    state.set(key, { count: 1, resetAt });
    pruneExpired(now);
    return { ok: true, remaining: Math.max(0, limit - 1), resetAt };
  }

  if (current.count >= limit) {
    return {
      ok: false,
      remaining: 0,
      resetAt: current.resetAt,
      retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }

  current.count += 1;
  return {
    ok: true,
    remaining: Math.max(0, limit - current.count),
    resetAt: current.resetAt,
  };
}

function pruneExpired(now: number) {
  if (state.size < 500) return;
  for (const [key, entry] of state) {
    if (entry.resetAt <= now) state.delete(key);
  }
}

