import { NextResponse } from "next/server";
import { listAppFileItems, markAppFileSaved } from "@/lib/app-file-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const scopeRaw = searchParams.get("scope");
  const scope =
    scopeRaw === "youtube" || scopeRaw === "report" ? scopeRaw : undefined;
  const items = await listAppFileItems(scope);
  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { id?: string };
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) {
    return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });
  }
  try {
    const video = await markAppFileSaved(id);
    return NextResponse.json({ ok: true, video });
  } catch (e) {
    const message = e instanceof Error ? e.message : "앱 파일로 표시하지 못했습니다.";
    const status = message.includes("찾을 수 없") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
