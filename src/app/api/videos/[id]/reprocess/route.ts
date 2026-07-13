import { NextResponse } from "next/server";
import { reprocessFromId } from "@/lib/process";
import { getVideo } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/** Re-fetch YouTube meta + re-summarize. Body may include pastedScript. */
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const existing = await getVideo(id);
  if (!existing) {
    return NextResponse.json({ error: "없음" }, { status: 404 });
  }
  try {
    const body = (await req.json().catch(() => ({}))) as {
      pastedScript?: string;
    };
    const video = await reprocessFromId(id, body.pastedScript);
    return NextResponse.json({ video });
  } catch (e) {
    const message = e instanceof Error ? e.message : "재분석 실패";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
