import fs from "fs";
import path from "path";
import { jsPDF } from "jspdf";
import { resolveAnswerParts } from "./answer-parts";
import { collectFcMarkers } from "./fc-markers";
import { normalizeImageUrls } from "./image-urls";
import { readLocalMedia } from "./media-store";
import { getNeonMedia } from "./neon-media";
import { reportBodyPlain } from "./report";
import { verdictBadge } from "./text-format";
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

type PdfBuildOpts = { origin?: string };

function bufferToPdfImage(
  buf: Buffer,
  contentType: string
): PdfImage | null {
  if (buf.length < 32 || buf.length > 4_500_000) return null;
  const ct = contentType.toLowerCase();
  if (ct.includes("svg")) return null;
  let format: PdfImage["format"] = "JPEG";
  if (ct.includes("png")) format = "PNG";
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
}

async function resolveMediaKey(key: string): Promise<PdfImage | null> {
  const local = readLocalMedia(key);
  if (local) return bufferToPdfImage(local.buffer, local.contentType);
  try {
    const neon = await getNeonMedia(key);
    if (neon) return bufferToPdfImage(neon.buffer, neon.contentType);
  } catch {
    /* ignore */
  }
  return null;
}

async function resolveImage(
  url: string,
  opts?: PdfBuildOpts
): Promise<PdfImage | null> {
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

  const mediaMatch = url.match(/^\/api\/media\/(.+)$/);
  if (mediaMatch) {
    const fromStore = await resolveMediaKey(decodeURIComponent(mediaMatch[1]));
    if (fromStore) return fromStore;
    if (!opts?.origin) return null;
    url = `${opts.origin}${url}`;
  } else if (url.startsWith("/") && opts?.origin) {
    url = `${opts.origin}${url}`;
  }

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(12_000),
      headers: { Accept: "image/*" },
    });
    if (!res.ok) return null;
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    const buf = Buffer.from(await res.arrayBuffer());
    return bufferToPdfImage(buf, ct || "image/jpeg");
  } catch {
    return null;
  }
}

function claimImagesForItem(video: VideoRecord, itemId?: string): string[] {
  if (!itemId) return [];
  const item = video.items.find((i) => i.id === itemId);
  if (!item) return [];
  return normalizeImageUrls(item.imageUrl, item.imageUrls).filter(
    (u) => !isYoutubeThumb(u)
  );
}

function fcExplanationText(explanation?: string | null): string {
  const raw = explanation?.trim() ?? "";
  if (!raw) return "";
  if (/^다음 주장을/.test(raw) && /팩트체크/.test(raw)) return "";
  return raw;
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

export async function buildReportPdf(
  video: VideoRecord,
  opts?: PdfBuildOpts
): Promise<Uint8Array> {
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
    const img = await resolveImage(url, opts);
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
    `보고서 유형: ${REPORT_TYPE_LABELS[video.reportType]}`,
    11,
    8
  );

  if (!report) {
    writeWrapped(
      "보고서가 아직 준비되지 않았습니다. 팩트체크를 먼저 완료해 주세요."
    );
    return new Uint8Array(doc.output("arraybuffer"));
  }

  setFace("bold");
  writeWrapped("— 보고서 —", 13, 10);
  setFace("normal");

  // 보고서 본문: 요약 서술만 (팩트체크·관련 이미지는 맨 뒤 부록)
  for (const sec of report.sections) {
    ensureSpace(40);
    setFace("bold");
    writeWrapped(sec.heading, 13, 6);
    setFace("normal");

    const plain = reportBodyPlain(sec.body, sec.rich);
    if (plain) writeWrapped(plain, 10, 8);
    y += 8;
  }

  const fcMarkers = collectFcMarkers(report);
  if (fcMarkers.length > 0) {
    doc.addPage();
    y = 40;
    setFace("bold");
    writeWrapped("부록: 팩트체크", 16, 4);
    setFace("normal");
    writeWrapped(
      "아래는 보고서 본문과 별도로 정리한 팩트체크 검증 내용입니다.",
      9,
      10
    );

    for (const marker of fcMarkers) {
      const { n, entry } = marker;
      const fc = report.factChecks.find((f) => f.itemId === entry.itemId);
      ensureSpace(50);
      setFace("bold");
      writeWrapped(`F${n}. ${entry.text}`, 11, 4);
      setFace("normal");

      if (fc?.verdict) {
        const badge = verdictBadge(fc.verdict);
        writeWrapped(`  판정: ${badge.mark} ${badge.label}`, 10, 4);
      }

      for (const src of claimImagesForItem(video, entry.itemId)) {
        await drawImage(src, "검증 대상 이미지");
      }

      const explanation = fcExplanationText(fc?.checkGuide);
      const parts = resolveAnswerParts({
        explanation,
        answerImageUrl: entry.answerImageUrl ?? fc?.answerImageUrl,
        answerImageUrls: entry.answerImageUrls ?? fc?.answerImageUrls,
        answerParts: entry.answerParts ?? fc?.answerParts,
      });

      if (parts.length) {
        for (const part of parts) {
          setFace("normal");
          if (part.text.trim()) {
            writeWrapped(`  ${part.number}. ${part.text}`, 9, 4);
          } else if (parts.length > 1) {
            writeWrapped(`  ${part.number}.`, 9, 2);
          }
          for (const src of (part.imageUrls ?? []).filter(
            (u) => !isYoutubeThumb(u)
          )) {
            await drawImage(src, `${part.number}번 이미지`);
          }
        }
      } else if (explanation) {
        writeWrapped(`  ${explanation}`, 9, 6);
        const answerImgs = normalizeImageUrls(
          entry.answerImageUrl ?? fc?.answerImageUrl,
          entry.answerImageUrls ?? fc?.answerImageUrls
        ).filter((u) => !isYoutubeThumb(u));
        for (const src of answerImgs) {
          await drawImage(src, "관련 이미지");
        }
      }
      y += 6;
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
