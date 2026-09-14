import { NextResponse } from "next/server";
import { buildReportPdf } from "@/lib/pdf";
import { buildInfPdfFileName } from "@/lib/pdf-filename";
import { reportDocumentTitle } from "@/lib/input-mode";
import { getVideo } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const video = await getVideo(id);
  if (!video) {
    return NextResponse.json({ error: "없음" }, { status: 404 });
  }
  if (video.status !== "ready" || !video.report) {
    return NextResponse.json(
      {
        error: video.skipFactCheck
          ? "보고서가 아직 없습니다. 요약을 완료한 뒤 다시 시도하세요."
          : "보고서가 아직 없습니다. 수동 팩트체크를 완료한 뒤 다시 시도하세요.",
      },
      { status: 400 }
    );
  }

  const origin = new URL(req.url).origin;
  const bytes = await buildReportPdf(video, { origin });
  const filename = buildInfPdfFileName({
    title:
      video.report.meta.title?.trim() ||
      video.title ||
      reportDocumentTitle(video),
    writtenAt: video.report.meta.writtenAt || video.updatedAt,
  });
  const asciiFallback = filename.replace(/[^\x20-\x7E]/g, "_");
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Pragma: "no-cache",
    },
  });
}
