import { NextResponse } from "next/server";
import {
  neonMediaStats,
  purgeUnusedNeonMedia,
} from "@/lib/neon-media";
import {
  collectMediaUrlsFromValue,
  purgeUnreferencedBlobs,
} from "@/lib/media-gc";
import { readAllVideos } from "@/lib/store";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function collectReferencedMediaIds(videos: unknown[]): Set<string> {
  const ids = new Set<string>();
  const re = /\/api\/media\/([^"'\\\s<>]+)/g;
  const json = JSON.stringify(videos);
  let m: RegExpExecArray | null;
  while ((m = re.exec(json))) {
    try {
      const id = decodeURIComponent(m[1]);
      if (id && !id.includes("..") && !id.includes("/")) ids.add(id);
    } catch {
      /* skip */
    }
  }
  return ids;
}

/** Neon 미디어 용량·참조 현황 */
export async function GET(req: Request) {
  const rate = await checkRateLimit(req, "media-cleanup-get", 20, 60_000);
  if (!rate.ok) {
    return NextResponse.json(
      { error: `요청이 너무 많습니다. ${rate.retryAfter}초 후 다시 시도해 주세요.` },
      { status: 429 }
    );
  }
  try {
    const stats = await neonMediaStats();
    const videos = await readAllVideos();
    const referenced = collectReferencedMediaIds(videos);
    const allUrls = collectMediaUrlsFromValue(videos);
    return NextResponse.json({
      ...stats,
      referenced: referenced.size,
      referencedUrls: allUrls.size,
      hasBlobToken: Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim()),
      hint:
        stats.approxMb >= 450
          ? "Neon 미디어 용량이 거의 찼습니다. POST /api/media/cleanup 으로 미사용 이미지를 정리하거나 Vercel Blob을 연결하세요."
          : undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** 미사용 Neon + Vercel Blob 정리 */
export async function POST(req: Request) {
  const rate = await checkRateLimit(req, "media-cleanup-post", 5, 10 * 60_000);
  if (!rate.ok) {
    return NextResponse.json(
      { error: `요청이 너무 많습니다. ${rate.retryAfter}초 후 다시 시도해 주세요.` },
      { status: 429 }
    );
  }
  try {
    const before = await neonMediaStats();
    const videos = await readAllVideos();
    const referencedIds = collectReferencedMediaIds(videos);
    const referencedUrls = collectMediaUrlsFromValue(videos);
    const neonResult = await purgeUnusedNeonMedia(referencedIds);
    const blobResult = await purgeUnreferencedBlobs(referencedUrls, "videos/");
    const after = await neonMediaStats();
    const deleted = neonResult.deleted + blobResult.deleted;
    return NextResponse.json({
      ok: true,
      before,
      after,
      neon: neonResult,
      blob: blobResult,
      deleted,
      message:
        deleted > 0
          ? `미사용 이미지 Neon ${neonResult.deleted}개 · Blob ${blobResult.deleted}개를 삭제했습니다.`
          : "삭제할 미사용 이미지가 없습니다.",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[media/cleanup]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
