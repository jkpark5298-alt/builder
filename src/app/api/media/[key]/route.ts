import { NextResponse } from "next/server";
import { readLocalMedia } from "@/lib/media-store";
import { getNeonMedia } from "@/lib/neon-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ key: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { key } = await ctx.params;

  // 1) 로컬 파일
  const local = readLocalMedia(key);
  if (local) {
    return new NextResponse(new Uint8Array(local.buffer), {
      headers: {
        "Content-Type": local.contentType,
        "Cache-Control": "private, max-age=86400",
      },
    });
  }

  // 2) Neon BYTEA 폴백
  try {
    const neon = await getNeonMedia(key);
    if (neon) {
      return new NextResponse(new Uint8Array(neon.buffer), {
        headers: {
          "Content-Type": neon.contentType,
          "Cache-Control": "private, max-age=86400",
        },
      });
    }
  } catch (e) {
    console.warn("[api/media] neon read failed", e);
  }

  return NextResponse.json({ error: "없음" }, { status: 404 });
}
