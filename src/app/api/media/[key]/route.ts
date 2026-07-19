import { NextResponse } from "next/server";
import { readLocalMedia } from "@/lib/media-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ key: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { key } = await ctx.params;
  const file = readLocalMedia(key);
  if (!file) {
    return NextResponse.json({ error: "없음" }, { status: 404 });
  }
  return new NextResponse(new Uint8Array(file.buffer), {
    headers: {
      "Content-Type": file.contentType,
      "Cache-Control": "private, max-age=86400",
    },
  });
}
