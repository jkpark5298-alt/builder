import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const UPSTREAM = "https://iphone-calendar-2026.vercel.app/api/gemini";

type GeminiAction = "summarize" | "fact-check";

/**
 * Browser → this app (same origin) → upstream Gemini helper.
 * Avoids CORS and keeps the bearer token server-side.
 */
export async function POST(req: Request) {
  const token =
    process.env.APP_API_TOKEN?.trim() ||
    process.env.GEMINI_API_TOKEN?.trim() ||
    "";

  if (!token) {
    return NextResponse.json(
      {
        error:
          "서버에 APP_API_TOKEN(또는 GEMINI_API_TOKEN)이 없습니다. .env.local에 설정한 뒤 재시작해 주세요.",
      },
      { status: 503 }
    );
  }

  try {
    const body = (await req.json()) as {
      action?: string;
      text?: string;
    };
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (text.length < 40) {
      return NextResponse.json(
        { error: "요약할 자막이 너무 짧습니다. 자막을 먼저 가져와 주세요." },
        { status: 400 }
      );
    }

    const rawAction = body.action?.trim() || "summarize";
    const action: GeminiAction =
      rawAction === "fact-check" ? "fact-check" : "summarize";

    const upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ action, text }),
    });

    const data = (await upstream.json().catch(() => ({}))) as {
      ok?: boolean;
      result?: string;
      error?: string;
    };

    if (!upstream.ok) {
      return NextResponse.json(
        {
          error:
            data.error ||
            (upstream.status === 401
              ? "제미나이 API 권한이 없습니다. APP_API_TOKEN을 확인해 주세요."
              : "제미나이 API 호출에 실패했습니다."),
        },
        { status: upstream.status === 401 ? 401 : 502 }
      );
    }

    const result =
      typeof data.result === "string" ? data.result.trim() : "";
    if (!result) {
      return NextResponse.json(
        { error: "제미나이 API가 빈 결과를 반환했습니다." },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true, result, action });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "제미나이 API 호출 중 오류가 발생했습니다.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
