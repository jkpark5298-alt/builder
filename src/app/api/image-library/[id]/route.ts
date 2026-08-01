import { NextResponse } from "next/server";
import {
  deleteLibraryImage,
  getLibraryImage,
  upsertLibraryImage,
} from "@/lib/image-library-store";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const image = await getLibraryImage(id);
  if (!image) {
    return NextResponse.json({ error: "이미지를 찾을 수 없습니다." }, { status: 404 });
  }
  return NextResponse.json({ image });
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const rate = await checkRateLimit(req, "image-library-patch", 60, 10 * 60_000);
  if (!rate.ok) {
    return NextResponse.json(
      { error: `요청이 너무 많습니다. ${rate.retryAfter}초 후 다시 시도해 주세요.` },
      { status: 429, headers: { "Retry-After": String(rate.retryAfter) } }
    );
  }

  const { id } = await ctx.params;
  const existing = await getLibraryImage(id);
  if (!existing) {
    return NextResponse.json({ error: "이미지를 찾을 수 없습니다." }, { status: 404 });
  }

  try {
    const body = (await req.json()) as { memo?: string; tag?: string | null };
    const image = await upsertLibraryImage({
      ...existing,
      memo: typeof body.memo === "string" ? body.memo : existing.memo,
      tag:
        body.tag === null
          ? undefined
          : typeof body.tag === "string"
            ? body.tag.trim() || undefined
            : existing.tag,
    });
    return NextResponse.json({ image });
  } catch (e) {
    const message = e instanceof Error ? e.message : "수정 실패";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const rate = await checkRateLimit(req, "image-library-delete", 40, 10 * 60_000);
  if (!rate.ok) {
    return NextResponse.json(
      { error: `요청이 너무 많습니다. ${rate.retryAfter}초 후 다시 시도해 주세요.` },
      { status: 429, headers: { "Retry-After": String(rate.retryAfter) } }
    );
  }

  const { id } = await ctx.params;
  const ok = await deleteLibraryImage(id);
  if (!ok) {
    return NextResponse.json({ error: "이미지를 찾을 수 없습니다." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
