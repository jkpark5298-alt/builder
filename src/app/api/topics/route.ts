import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { readAllTopics, searchTopics } from "@/lib/store";
import { createTopic } from "@/lib/topic";
import type { ReportType } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  const topics = q.trim() ? await searchTopics(q) : await readAllTopics();
  return NextResponse.json({ topics });
}

export async function POST(req: Request) {
  const rate = await checkRateLimit(req, "topic-create", 30, 60_000);
  if (!rate.ok) {
    return NextResponse.json(
      { error: `요청이 너무 많습니다. ${rate.retryAfter}초 후 다시 시도해 주세요.` },
      { status: 429, headers: { "Retry-After": String(rate.retryAfter) } }
    );
  }
  try {
    const body = (await req.json()) as {
      title?: string;
      description?: string;
      themeTag?: string;
      reportType?: ReportType;
    };
    const topic = await createTopic({
      title: body.title ?? "",
      description: body.description,
      themeTag: body.themeTag,
      reportType: body.reportType,
    });
    return NextResponse.json({ topic });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "주제 생성 실패";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
