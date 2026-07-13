import { jsPDF } from "jspdf";
import type { VideoRecord } from "./types";
import { REPORT_TYPE_LABELS } from "./types";

export function buildReportPdf(video: VideoRecord): Uint8Array {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 48;
  const maxW = pageW - margin * 2;
  let y = margin;

  const ensureSpace = (need: number) => {
    if (y + need > doc.internal.pageSize.getHeight() - margin) {
      doc.addPage();
      y = margin;
    }
  };

  const writeWrapped = (text: string, fontSize = 11, gap = 6) => {
    doc.setFontSize(fontSize);
    const lines = doc.splitTextToSize(text, maxW) as string[];
    for (const line of lines) {
      ensureSpace(fontSize + 4);
      doc.text(line, margin, y);
      y += fontSize + 3;
    }
    y += gap;
  };

  doc.setFillColor(196, 92, 38);
  doc.rect(0, 0, pageW, 10, "F");
  y = 40;

  const report = video.report;
  doc.setFont("helvetica", "bold");
  writeWrapped("YouTube Summary & Fact-Check Report", 16, 4);
  doc.setFont("helvetica", "normal");

  // Header meta
  writeWrapped(`Title: ${video.title}`, 12, 2);
  writeWrapped(`Channel: ${video.channel}`, 11, 2);
  writeWrapped(`Link: ${video.youtubeUrl}`, 10, 2);
  writeWrapped(
    `Date: ${report?.meta.writtenAt ?? new Date(video.updatedAt).toLocaleString("ko-KR")}`,
    10,
    2
  );
  writeWrapped(
    `Type: ${REPORT_TYPE_LABELS[video.reportType]} (${video.reportType})`,
    11,
    12
  );

  if (!report) {
    writeWrapped("Report not ready. Complete fact-check first.");
    return new Uint8Array(doc.output("arraybuffer"));
  }

  doc.setFont("helvetica", "bold");
  writeWrapped("1. Summary", 13, 6);
  doc.setFont("helvetica", "normal");
  writeWrapped(report.summaryExcerpt, 10, 12);

  doc.setFont("helvetica", "bold");
  writeWrapped(`2. Typed body — ${report.reportTypeLabel}`, 13, 6);
  doc.setFont("helvetica", "normal");

  report.sections.forEach((sec) => {
    ensureSpace(40);
    doc.setFont("helvetica", "bold");
    writeWrapped(sec.heading, 12, 4);
    doc.setFont("helvetica", "normal");
    writeWrapped(sec.body, 10, 10);
  });

  doc.setFont("helvetica", "bold");
  writeWrapped("3. Fact-check checklist", 13, 6);
  doc.setFont("helvetica", "normal");
  report.factChecks.forEach((fc, idx) => {
    writeWrapped(`${idx + 1}. ${fc.statement}`, 10, 2);
    writeWrapped(fc.checkGuide, 9, 8);
  });

  return new Uint8Array(doc.output("arraybuffer"));
}
