import { NextResponse } from "next/server";
import {
  persistMediaBuffer,
  persistMediaDataUrl,
} from "@/lib/media-store";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 1_000_000;

function friendlyMediaError(msg: string): string {
  if (/project size limit|512\s*MB|could not extend file/i.test(msg)) {
    return "Neon DB capacity full. Connect Vercel Blob or run /api/media/cleanup.";
  }
  if (/suspended/i.test(msg)) {
    return "Blob store suspended. Retry after refresh.";
  }
  return msg.replace(/^이미지 저장 실패:\s*/i, "");
}

type UploadBlob = {
  arrayBuffer: () => Promise<ArrayBuffer>;
  type?: string;
};

async function respondPersist(
  persist: () => Promise<string>
): Promise<NextResponse> {
  try {
    const url = await persist();
    if (url.startsWith("data:")) {
      return NextResponse.json(
        { error: "Failed to externalize image. Retry shortly." },
        { status: 502 }
      );
    }
    return NextResponse.json({ url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[media/upload]", msg);
    return NextResponse.json(
      { error: "이미지 저장 실패: " + friendlyMediaError(msg) },
      { status: 502 }
    );
  }
}

export async function POST(req: Request) {
  const rate = await checkRateLimit(req, "media-upload", 60, 60_000);
  if (!rate.ok) {
    return NextResponse.json(
      {
        error:
          "요청이 너무 많습니다. " +
          rate.retryAfter +
          "초 후 다시 시도해 주세요.",
      },
      { status: 429, headers: { "Retry-After": String(rate.retryAfter) } }
    );
  }

  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    try {
      const form = await req.formData();
      const file = form.get("file") as UploadBlob | string | null;
      const prefix =
        (typeof form.get("prefix") === "string"
          ? (form.get("prefix") as string)
          : "uploads") || "uploads";
      if (
        !file ||
        typeof file === "string" ||
        typeof file.arrayBuffer !== "function"
      ) {
        return NextResponse.json(
          { error: "file field required" },
          { status: 400 }
        );
      }
      const buf = Buffer.from(await file.arrayBuffer());
      if (!buf.length) {
        return NextResponse.json({ error: "empty file" }, { status: 400 });
      }
      if (buf.length > MAX_BYTES) {
        return NextResponse.json(
          { error: "image too large" },
          { status: 413 }
        );
      }
      const ct = (typeof file.type === "string" && file.type) || "image/jpeg";
      if (!ct.startsWith("image/")) {
        return NextResponse.json(
          { error: "image files only" },
          { status: 400 }
        );
      }
      return respondPersist(() => persistMediaBuffer(buf, ct, { prefix }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json(
        { error: "upload read failed: " + msg },
        { status: 400 }
      );
    }
  }

  let body: { dataUrl?: string; prefix?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { error: "could not read image body" },
      { status: 400 }
    );
  }

  const dataUrl = body.dataUrl?.trim();
  if (!dataUrl || !dataUrl.startsWith("data:image/")) {
    return NextResponse.json(
      { error: "data:image/... required" },
      { status: 400 }
    );
  }
  if (dataUrl.length > 1_400_000) {
    return NextResponse.json({ error: "image too large" }, { status: 413 });
  }

  return respondPersist(() =>
    persistMediaDataUrl(dataUrl, { prefix: body.prefix || "uploads" })
  );
}
