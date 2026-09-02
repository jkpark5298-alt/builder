import { NextResponse } from "next/server";
import { fetchArticleFromUrl } from "@/lib/article-fetch";
import { extractVideoId } from "@/lib/youtube";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 팩트체크보고서 URL 입력 — 공개 웹 페이지 본문·이미지를 가져와 저장.
 */
export async function POST(req: Request) {
  const rate = await checkRateLimit(req, "article-fetch", 8, 10 * 60_000);
  if (!rate.ok) {
    return NextResponse.json(
      {
        error: `요청이 너무 많습니다. ${rate.retryAfter}초 후 다시 시도해 주세요.`,
      },
      {
        status: 429,
        headers: { "Retry-After": String(rate.retryAfter) },
      }
    );
  }

  try {
    const body = (await req.json()) as { url?: string };
    const url = body.url?.trim() ?? "";
    if (!url) {
      return NextResponse.json(
        { error: "URL을 입력해 주세요." },
        { status: 400 }
      );
    }
    if (extractVideoId(url)) {
      return NextResponse.json(
        {
          error:
            "유튜브 주소입니다. 홈 「유튜브」 탭에서 자막을 가져와 주세요.",
        },
        { status: 400 }
      );
    }

    const article = await fetchArticleFromUrl(url);
    return NextResponse.json({ article });
  } catch (e) {
    const message = e instanceof Error ? e.message : "본문을 가져오지 못했습니다.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
