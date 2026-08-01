import { NextResponse } from "next/server";
import {
  extractTextFromPdfBuffer,
  PDF_EXTRACT_MAX_BYTES,
} from "@/lib/pdf-extract";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 요약용 PDF 텍스트 추출.
 * multipart: file=<pdf> 또는 JSON: { dataBase64 }
 */
export async function POST(req: Request) {
  const rate = await checkRateLimit(req, "pdf-extract", 12, 10 * 60_000);
  if (!rate.ok) {
    return NextResponse.json(
      { error: `요청이 너무 많습니다. ${rate.retryAfter}초 후 다시 시도해 주세요.` },
      { status: 429, headers: { "Retry-After": String(rate.retryAfter) } }
    );
  }

  try {
    const contentType = req.headers.get("content-type") || "";
    let bytes: Uint8Array | null = null;
    let fileName = "upload.pdf";

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json(
          { error: "PDF 파일(file)이 필요합니다." },
          { status: 400 }
        );
      }
      fileName = file.name || fileName;
      const type = (file.type || "").toLowerCase();
      const looksPdf =
        type === "application/pdf" ||
        type === "application/x-pdf" ||
        fileName.toLowerCase().endsWith(".pdf");
      if (!looksPdf) {
        return NextResponse.json(
          { error: "PDF 파일만 올릴 수 있습니다." },
          { status: 400 }
        );
      }
      if (file.size > PDF_EXTRACT_MAX_BYTES) {
        return NextResponse.json(
          {
            error: `PDF가 너무 큽니다. ${(PDF_EXTRACT_MAX_BYTES / (1024 * 1024)).toFixed(0)}MB 이하로 올려 주세요.`,
          },
          { status: 413 }
        );
      }
      bytes = new Uint8Array(await file.arrayBuffer());
    } else {
      const body = (await req.json()) as { dataBase64?: string; fileName?: string };
      const raw = body.dataBase64?.trim() ?? "";
      const b64 = raw.includes(",")
        ? raw.slice(raw.indexOf(",") + 1)
        : raw.replace(/^data:application\/pdf;base64,/i, "");
      if (!b64) {
        return NextResponse.json(
          { error: "PDF 데이터(dataBase64)가 필요합니다." },
          { status: 400 }
        );
      }
      if (body.fileName?.trim()) fileName = body.fileName.trim();
      const buf = Buffer.from(b64, "base64");
      if (buf.byteLength > PDF_EXTRACT_MAX_BYTES) {
        return NextResponse.json(
          {
            error: `PDF가 너무 큽니다. ${(PDF_EXTRACT_MAX_BYTES / (1024 * 1024)).toFixed(0)}MB 이하로 올려 주세요.`,
          },
          { status: 413 }
        );
      }
      bytes = new Uint8Array(buf);
    }

    if (!bytes || bytes.byteLength < 5) {
      return NextResponse.json(
        { error: "PDF 파일을 읽지 못했습니다." },
        { status: 400 }
      );
    }
    const header = String.fromCharCode(
      bytes[0]!,
      bytes[1]!,
      bytes[2]!,
      bytes[3]!,
      bytes[4]!
    );
    if (!header.startsWith("%PDF")) {
      return NextResponse.json(
        { error: "올바른 PDF 파일이 아닙니다." },
        { status: 400 }
      );
    }

    const { text, pageCount } = await extractTextFromPdfBuffer(bytes);
    return NextResponse.json({
      text,
      pageCount,
      charCount: text.length,
      fileName,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "PDF 읽기 실패";
    console.error("[pdf/extract]", message);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
