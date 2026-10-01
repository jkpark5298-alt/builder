import { NextResponse } from "next/server";
import { isAllowedRemoteImageUrl } from "@/lib/allowed-image-url";
import { fetchPublicMeta } from "@/lib/instagram-meta";
import { persistMediaBuffer } from "@/lib/media-store";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

async function storePreview(imageUrl: string): Promise<string | null> {
  if (!isAllowedRemoteImageUrl(imageUrl)) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(imageUrl, {
      signal: controller.signal,
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
      },
      redirect: "follow",
      cache: "no-store",
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "image/jpeg";
    if (!contentType.startsWith("image/")) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (!bytes.length || bytes.length > 4_000_000) return null;
    return await persistMediaBuffer(bytes, contentType, {
      prefix: "videos/instagram",
    });
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const rate = await checkRateLimit(req, "ig-meta", 8, 10 * 60_000);
  if (!rate.ok) {
    return NextResponse.json(
      { error: `요청이 너무 많습니다. ${rate.retryAfter}초 후 다시 시도해 주세요.` },
      { status: 429, headers: { "Retry-After": String(rate.retryAfter) } }
    );
  }

  try {
    const body = (await req.json()) as { url?: string };
    const url = body.url?.trim() || "";
    if (!url) {
      return NextResponse.json({ error: "인스타 URL이 필요합니다." }, { status: 400 });
    }

    const meta = await fetchPublicMeta(url);
    const remote = meta.imageUrls?.[0] || meta.imageUrl;
    const stored = remote ? await storePreview(remote) : null;
    const imageUrl = stored || undefined;

    return NextResponse.json({
      title: meta.title || "",
      description: meta.description || "",
      imageUrl: imageUrl || null,
      warning: meta.warning || null,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "메타 보기에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
