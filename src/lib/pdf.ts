import fs from "fs";
import path from "path";
import { jsPDF } from "jspdf";
import type { VideoRecord } from "./types";
import { REPORT_TYPE_LABELS } from "./types";

const FONT_FAMILY = "NanumGothic";
let fontsReady: Promise<void> | null = null;

function bufferToBase64(buf: Buffer): string {
  return buf.toString("base64");
}

function readLocalFont(filename: string): Buffer | null {
  const candidates = [
    path.join(process.cwd(), "public", "fonts", filename),
    path.join(process.cwd(), "fonts", filename),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p);
    } catch {
      /* ignore */
    }
  }
  return null;
}

async function fetchFont(filename: string): Promise<Buffer | null> {
  const local = readLocalFont(filename);
  if (local?.length) return local;

  const url = `https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/nanumgothic/${filename}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

async function ensureKoreanFonts(doc: jsPDF): Promise<boolean> {
  if (!fontsReady) {
    fontsReady = (async () => {
      const regular = await fetchFont("NanumGothic-Regular.ttf");
      const bold =
        (await fetchFont("NanumGothic-Bold.ttf")) ?? regular;
      if (!regular) {
        throw new Error("한글 폰트를 불러오지 못했습니다.");
      }
      // stash on doc constructor for reuse across instances
      const g = globalThis as unknown as {
        __ycFonts?: { regular: string; bold: string };
      };
      g.__ycFonts = {
        regular: bufferToBase64(regular),
        bold: bufferToBase64(bold!),
      };
    })().catch((e) => {
      fontsReady = null;
      throw e;
    });
  }

  try {
    await fontsReady;
  } catch {
    return false;
  }

  const g = globalThis as unknown as {
    __ycFonts?: { regular: string; bold: string };
  };
  if (!g.__ycFonts) return false;

  doc.addFileToVFS("NanumGothic-Regular.ttf", g.__ycFonts.regular);
  doc.addFont("NanumGothic-Regular.ttf", FONT_FAMILY, "normal");
  doc.addFileToVFS("NanumGothic-Bold.ttf", g.__ycFonts.bold);
  doc.addFont("NanumGothic-Bold.ttf", FONT_FAMILY, "bold");
  return true;
}

export async function buildReportPdf(video: VideoRecord): Promise<Uint8Array> {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const hasKr = await ensureKoreanFonts(doc);
  const font = hasKr ? FONT_FAMILY : "helvetica";

  const pageW = doc.internal.pageSize.getWidth();
  const margin = 48;
  const maxW = pageW - margin * 2;
  let y = margin;

  const setFace = (style: "normal" | "bold" = "normal") => {
    doc.setFont(font, style);
  };

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
  setFace("bold");
  writeWrapped("유튜브 요약 · 팩트체크 보고서", 16, 4);
  setFace("normal");

  writeWrapped(`제목: ${video.title}`, 12, 2);
  writeWrapped(`채널: ${video.channel}`, 11, 2);
  writeWrapped(`링크: ${video.youtubeUrl}`, 10, 2);
  writeWrapped(
    `작성일: ${report?.meta.writtenAt ?? new Date(video.updatedAt).toLocaleString("ko-KR")}`,
    10,
    2
  );
  writeWrapped(
    `보고서 유형: ${REPORT_TYPE_LABELS[video.reportType]} (${video.reportType})`,
    11,
    12
  );

  if (!report) {
    writeWrapped("보고서가 아직 준비되지 않았습니다. 팩트체크를 먼저 완료해 주세요.");
    return new Uint8Array(doc.output("arraybuffer"));
  }

  setFace("bold");
  writeWrapped("1. 요약", 13, 6);
  setFace("normal");
  writeWrapped(report.summaryExcerpt, 10, 12);

  setFace("bold");
  writeWrapped(`2. 본문 — ${report.reportTypeLabel}`, 13, 6);
  setFace("normal");

  report.sections.forEach((sec) => {
    ensureSpace(40);
    setFace("bold");
    writeWrapped(sec.heading, 12, 4);
    setFace("normal");
    writeWrapped(sec.body, 10, 10);
  });

  setFace("bold");
  writeWrapped("3. 팩트체크 정리", 13, 6);
  setFace("normal");
  report.factChecks.forEach((fc, idx) => {
    setFace("bold");
    writeWrapped(`${idx + 1}. ${fc.statement}`, 10, 2);
    setFace("normal");
    writeWrapped(fc.checkGuide, 9, 8);
  });

  if (!hasKr) {
    ensureSpace(40);
    writeWrapped(
      "(경고) 한글 폰트를 불러오지 못해 일부 글자가 깨질 수 있습니다.",
      9,
      0
    );
  }

  return new Uint8Array(doc.output("arraybuffer"));
}
