import fs from "fs";
import path from "path";
import { jsPDF } from "jspdf";
import { resolveAnswerParts } from "./answer-parts";
import { normalizeImageUrls } from "./image-urls";
import { reportBodyPlain } from "./report";
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

function isYoutubeThumb(url?: string | null): boolean {
  if (!url) return false;
  return /i\.ytimg\.com|ytimg\.com\/vi\//i.test(url);
}

type PdfImage = { data: string; format: "JPEG" | "PNG" | "WEBP" };

async function resolveImage(url: string): Promise<PdfImage | null> {
  if (!url?.trim() || isYoutubeThumb(url)) return null;

  if (url.startsWith("data:image/")) {
    const m = /^data:image\/(png|jpeg|jpg|webp);base64,/i.exec(url);
    if (!m) return null;
    const format =
      m[1].toLowerCase() === "png"
        ? "PNG"
        : m[1].toLowerCase() === "webp"
          ? "WEBP"
          : "JPEG";
    return { data: url, format };
  }

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(12_000),
      headers: { Accept: "image/*" },
    });
    if (!res.ok) return null;
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 32 || buf.length > 4_500_000) return null;
    let format: PdfImage["format"] = "JPEG";
    if (ct.includes("png") || url.toLowerCase().includes(".png")) format = "PNG";
    else if (ct.includes("webp")) format = "WEBP";
    const mime =
      format === "PNG"
        ? "image/png"
        : format === "WEBP"
          ? "image/webp"
          : "image/jpeg";
    return {
      data: `data:${mime};base64,${buf.toString("base64")}`,
      format,
    };
  } catch {
    return null;
  }
}

function imageNaturalSize(
  dataUrl: string
): { w: number; h: number } | null {
  // PNG IHDR / JPEG SOF — rough parse; fallback aspect later
  try {
    if (dataUrl.startsWith("data:image/png")) {
      const b64 = dataUrl.split(",")[1] ?? "";
      const buf = Buffer.from(b64, "base64");
      if (buf.length > 24) {
        return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function buildReportPdf(video: VideoRecord): Promise<Uint8Array> {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const hasKr = await ensureKoreanFonts(doc);
  const font = hasKr ? FONT_FAMILY : "helvetica";

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 48;
  const maxW = pageW - margin * 2;
  let y = margin;

  const setFace = (style: "normal" | "bold" = "normal") => {
    doc.setFont(font, style);
  };

  const ensureSpace = (need: number) => {
    if (y + need > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  };

  const writeWrapped = (text: string, fontSize = 11, gap = 6) => {
    if (!text?.trim()) return;
    doc.setFontSize(fontSize);
    const lines = doc.splitTextToSize(text, maxW) as string[];
    for (const line of lines) {
      ensureSpace(fontSize + 4);
      doc.text(line, margin, y);
      y += fontSize + 3;
    }
    y += gap;
  };

  const drawImage = async (url: string, caption?: string) => {
    const img = await resolveImage(url);
    if (!img) return;
    const natural = imageNaturalSize(img.data);
    const aspect = natural ? natural.w / Math.max(natural.h, 1) : 16 / 9;
    let drawW = maxW;
    let drawH = drawW / aspect;
    const maxH = Math.min(280, pageH - margin * 2 - 40);
    if (drawH > maxH) {
      drawH = maxH;
      drawW = drawH * aspect;
    }
    ensureSpace(drawH + (caption ? 22 : 10));
    try {
      doc.addImage(
        img.data,
        img.format,
        margin,
        y,
        drawW,
        drawH,
        undefined,
        "FAST"
      );
      y += drawH + 6;
      if (caption) {
        setFace("normal");
        doc.setFontSize(8);
        doc.setTextColor(100);
        doc.text(caption, margin, y);
        doc.setTextColor(0);
        y += 14;
      } else {
        y += 4;
      }
    } catch {
      /* skip broken image */
    }
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
    `최종 수정: ${new Date(video.updatedAt).toLocaleString("ko-KR")}`,
    10,
    2
  );
  writeWrapped(
    `보고서 유형: ${REPORT_TYPE_LABELS[video.reportType]} (${video.reportType})`,
    11,
    12
  );

  if (!report) {
    writeWrapped(
      "보고서가 아직 준비되지 않았습니다. 팩트체크를 먼저 완료해 주세요."
    );
    return new Uint8Array(doc.output("arraybuffer"));
  }

  // 저장된 보고서(수정본) 기준으로 섹션·이미지 전부 출력 (팩트체크 상세는 부록)
  let fcIndex = 0;
  for (const sec of report.sections) {
    ensureSpace(40);
    setFace("bold");
    writeWrapped(sec.heading, 13, 6);
    setFace("normal");

    const plain = reportBodyPlain(sec.body, sec.rich);
    if (plain) writeWrapped(plain, 10, 8);

    const sectionImages = Array.from(
      new Set(
        [sec.imageUrl, ...(sec.images ?? [])].filter(
          (u): u is string => Boolean(u) && !isYoutubeThumb(u)
        )
      )
    );
    for (const src of sectionImages) {
      await drawImage(src);
    }

    // 본문에는 F 번호만 (상세는 부록)
    for (const entry of sec.entries ?? []) {
      fcIndex += 1;
      setFace("normal");
      writeWrapped(`  [F${fcIndex}] ${entry.text}`, 9, 4);
    }
    y += 8;
  }

  // 부록: 팩트 체크 내용
  if (fcIndex > 0) {
    doc.addPage();
    y = 40;
    setFace("bold");
    writeWrapped("팩트 체크 내용", 16, 10);
    setFace("normal");

    let n = 0;
    for (const sec of report.sections) {
      for (const entry of sec.entries ?? []) {
        n += 1;
        const fc = report.factChecks.find((f) => f.itemId === entry.itemId);
        ensureSpace(50);
        setFace("bold");
        writeWrapped(`F${n}. ${entry.text}`, 11, 4);
        setFace("normal");

        if (fc?.verdict === "false" || fc?.verdict === "mostly_false") {
          setFace("bold");
          writeWrapped("  FACT CHECK ✗", 10, 2);
        } else if (fc?.verdict && fc.verdict !== "pending") {
          writeWrapped(`  판정: ${fc.verdict}`, 9, 2);
        }

        const parts = resolveAnswerParts({
          explanation: fc?.checkGuide || entry.html || "",
          answerImageUrl: entry.answerImageUrl ?? fc?.answerImageUrl,
          answerImageUrls: entry.answerImageUrls ?? fc?.answerImageUrls,
          answerParts: entry.answerParts ?? fc?.answerParts,
        });

        if (parts.length) {
          for (const part of parts) {
            setFace("normal");
            if (part.text.trim()) {
              writeWrapped(`  ${part.number}. ${part.text}`, 9, 4);
            } else {
              writeWrapped(`  ${part.number}.`, 9, 2);
            }
            for (const src of (part.imageUrls ?? []).filter(
              (u) => !isYoutubeThumb(u)
            )) {
              await drawImage(src, `${part.number}번 이미지`);
            }
          }
        } else {
          if (fc?.checkGuide) {
            setFace("normal");
            writeWrapped(`  ${fc.checkGuide}`, 9, 6);
          } else if (entry.html) {
            setFace("normal");
            writeWrapped(`  ${reportBodyPlain(entry.html, true)}`, 9, 6);
          }

          const entryImages = normalizeImageUrls(
            entry.answerImageUrl,
            entry.answerImageUrls
          ).filter((u) => !isYoutubeThumb(u));
          const fcImages = normalizeImageUrls(
            fc?.answerImageUrl,
            fc?.answerImageUrls
          ).filter((u) => !isYoutubeThumb(u));
          const allEntryImgs = Array.from(
            new Set([...entryImages, ...fcImages])
          );
          for (const src of allEntryImgs) {
            await drawImage(src, "관련 이미지");
          }
        }
        y += 6;
      }
    }
  }

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
