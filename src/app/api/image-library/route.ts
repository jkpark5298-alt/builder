import { NextResponse } from "next/server";
import {
  createLibraryImage,
  readAllLibraryImages,
  searchLibraryImages,
} from "@/lib/image-library-store";
import { checkRateLimit } from "@/lib/rate-limit";
import { storageMode } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";
  const images = q
    ? await searchLibraryImages(q)
    : await readAllLibraryImages();
  return NextResponse.json({ images, storage: storageMode() });
}

export async function POST(req: Request) {
  const rate = await checkRateLimit(req, "image-library-create", 40, 10 * 60_000);
  if (!rate.ok) {
    return NextResponse.json(
      { error: `요청이 너무 많습니다. ${rate.retryAfter}초 후 다시 시도해 주세요.` },
      { status: 429, headers: { "Retry-After": String(rate.retryAfter) } }
    );
  }

  try {
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      const memo = String(form.get("memo") ?? "");
      const tag = String(form.get("tag") ?? "");
      if (!(file instanceof File)) {
        return NextResponse.json(
          { error: "이미지 파일(file)이 필요합니다." },
          { status: 400 }
        );
      }
      if (!file.type.startsWith("image/")) {
        return NextResponse.json(
          { error: "이미지 파일만 올릴 수 있습니다." },
          { status: 400 }
        );
      }
      const buf = Buffer.from(await file.arrayBuffer());
      if (buf.byteLength > 6 * 1024 * 1024) {
        return NextResponse.json(
          { error: "이미지가 너무 큽니다. 6MB 이하로 올려 주세요." },
          { status: 413 }
        );
      }
      const dataUrl = `data:${file.type};base64,${buf.toString("base64")}`;
      const image = await createLibraryImage({ dataUrl, memo, tag });
      return NextResponse.json({ image });
    }

    const body = (await req.json()) as {
      dataUrl?: string;
      url?: string;
      memo?: string;
      tag?: string;
    };
    const image = await createLibraryImage({
      dataUrl: body.dataUrl,
      url: body.url,
      memo: body.memo,
      tag: body.tag,
    });
    return NextResponse.json({ image });
  } catch (e) {
    const message = e instanceof Error ? e.message : "이미지 저장 실패";
    console.error("[image-library POST]", message);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
