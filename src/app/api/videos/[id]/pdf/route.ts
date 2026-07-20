import { NextResponse } from "next/server";
import { buildReportPdf } from "@/lib/pdf";
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
        error:
          "보고서가 아직 없습니다. 수동 팩트체크를 완료한 뒤 다시 시도하세요.",
      },
      { status: 400 }
    );
  }

  const origin = new URL(req.url).origin;
  const bytes = await buildReportPdf(video, { origin });
  const filename = `factcheck-${video.videoId}.pdf`;
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Pragma: "no-cache",
    },
  });
}
