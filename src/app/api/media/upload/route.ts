import { NextResponse } from "next/server";
import { persistMediaDataUrl } from "@/lib/media-store";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 클라이언트에서 압축한 data URL 이미지를 Blob(또는 로컬)에 올리고
 * 짧은 URL만 반환. 이후 PATCH에는 이 URL만 넣어 JSON 폭증을 막음.
 */
export async function POST(req: Request) {
  const rate = await checkRateLimit(req, "media-upload", 60, 60_000);
  if (!rate.ok) {
    return NextResponse.json(
      { error: `요청이 너무 많습니다. ${rate.retryAfter}초 후 다시 시도해 주세요.` },
      { status: 429, headers: { "Retry-After": String(rate.retryAfter) } }
    );
  }

  let body: { dataUrl?: string; prefix?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { error: "이미지 본문을 읽지 못했습니다. 용량이 너무 클 수 있습니다." },
      { status: 400 }
    );
  }

  const dataUrl = body.dataUrl?.trim();
  if (!dataUrl || !dataUrl.startsWith("data:image/")) {
    return NextResponse.json(
      { error: "data:image/... 형식의 이미지가 필요합니다." },
      { status: 400 }
    );
  }
  // ~1.5MB base64 상한 (클라이언트 압축 220KB면 여유)
  if (dataUrl.length > 2_000_000) {
    return NextResponse.json(
      { error: "이미지가 너무 큽니다. 다시 압축해 주세요." },
      { status: 413 }
    );
  }

  try {
    const url = await persistMediaDataUrl(dataUrl, {
      prefix: body.prefix || "uploads",
    });
    if (url.startsWith("data:")) {
      return NextResponse.json(
        {
          error:
            "이미지 외부 저장에 실패했습니다. Vercel Blob(BLOB_READ_WRITE_TOKEN) 설정을 확인하세요.",
        },
        { status: 502 }
      );
    }
    return NextResponse.json({ url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[media/upload]", msg);
    return NextResponse.json(
      { error: `이미지 저장 실패: ${msg}` },
      { status: 502 }
    );
  }
}
