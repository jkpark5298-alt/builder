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
  try {
    const b64 = dataUrl.split(",")[1] ?? "";
    if (!b64) return null;
    const buf = Buffer.from(b64, "base64");
    if (dataUrl.startsWith("data:image/png") && buf.length > 24) {
      return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    }
    if (
      (dataUrl.startsWith("data:image/jpeg") ||
        dataUrl.startsWith("data:image/jpg")) &&
      buf.length > 4
    ) {
      // JPEG SOF0/SOF2 scan
      let i = 2;
      while (i < buf.length - 8) {
        if (buf[i] !== 0xff) {
          i += 1;
          continue;
        }
        const marker = buf[i + 1];
        if (marker === 0xd8 || marker === 0xd9) {
          i += 2;
          continue;
        }
        const len = buf.readUInt16BE(i + 2);
        if (
          marker >= 0xc0 &&
          marker <= 0xc3 &&
          i + 8 < buf.length
        ) {
          return {
            h: buf.readUInt16BE(i + 5),
            w: buf.readUInt16BE(i + 7),
          };
        }
        i += 2 + len;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * WEBP → JPEG. jsPDF는 WEBP에서 가로 줄·깨짐이 자주 남.
 * sharp 없으면 null (해당 이미지는 PDF에서 생략).
 */
async function webpToJpegDataUrl(dataUrl: string): Promise<string | null> {
  try {
    const sharpMod = await import("sharp").catch(() => null);
    if (!sharpMod?.default) return null;
    const b64 = dataUrl.split(",")[1];
    if (!b64) return null;
    const out = await sharpMod
      .default(Buffer.from(b64, "base64"))
      .jpeg({ quality: 82 })
      .toBuffer();
    return `data:image/jpeg;base64,${out.toString("base64")}`;
  } catch {
    return null;
  }
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
  const margin = 52;
  const maxW = pageW - margin * 2;
  const bottomLimit = pageH - margin;
  /** 본문 시작 y — 첫 줄 ascent가 잘리지 않게 폰트 크기만큼 아래로 */
  let y = margin + 14;

  const setFace = (style: "normal" | "bold" = "normal") => {
    doc.setFont(font, style);
  };

  const remaining = () => bottomLimit - y;

  const ensureSpace = (need: number) => {
    if (need > remaining()) {
      doc.addPage();
      y = margin + 14;
    }
  };

  /** 한글 폰트 기준 줄 간격 (너무 촘촘하면 글자가 찍혀 보임) */
  const lineAdvance = (fontSize: number) => Math.ceil(fontSize * 1.55);

  const writeWrapped = (text: string, fontSize = 11, gap = 8) => {
    if (!text?.trim()) return;
    doc.setFontSize(fontSize);
    const advance = lineAdvance(fontSize);
    const lines = doc.splitTextToSize(text, maxW) as string[];
    for (const line of lines) {
      ensureSpace(advance);
      doc.text(line, margin, y);
      y += advance;
    }
    y += gap;
  };

  const drawImage = async (url: string, caption?: string) => {
    const img = await resolveImage(url, opts);
    if (!img) return;

    // WEBP는 jsPDF에서 깨지거나 가로줄이 생기는 경우가 많아 JPEG로 취급 시도
    let format: "JPEG" | "PNG" = img.format === "PNG" ? "PNG" : "JPEG";
    let data = img.data;
    if (img.format === "WEBP") {
      const converted = await webpToJpegDataUrl(img.data);
      if (!converted) return;
      data = converted;
      format = "JPEG";
    }

    const natural = imageNaturalSize(data);
    const aspect = natural ? natural.w / Math.max(natural.h, 1) : 4 / 3;
    const captionH = caption ? 18 : 0;
    const padBefore = 10;
    const padAfter = 12;

    // 페이지에 남을 높이 기준으로 맞춤 — 절대 페이지를 가로질러 자르지 않음
    const fitOnPage = (avail: number) => {
      const maxImgH = Math.min(300, Math.max(60, avail - captionH - padAfter));
      let drawW = maxW;
      let drawH = drawW / aspect;
      if (drawH > maxImgH) {
        drawH = maxImgH;
        drawW = drawH * aspect;
      }
      return { drawW, drawH };
    };

    // 아래쪽에 사진이 들어갈 여유가 거의 없으면 먼저 넘김
    if (remaining() < 120) {
      doc.addPage();
      y = margin + 14;
    }

    y += padBefore;
    let avail = remaining();
    let { drawW, drawH } = fitOnPage(avail);
    // 남은 칸이 부족하면 새 페이지 — 사진을 중간에서 자르지 않음
    if (drawH + captionH + padAfter > avail - 2) {
      doc.addPage();
      y = margin + 14 + padBefore;
      avail = remaining();
      ({ drawW, drawH } = fitOnPage(avail));
    }

    try {
      doc.addImage(data, format, margin, y, drawW, drawH, undefined, "FAST");
      y += drawH + 8;
      if (caption) {
        setFace("normal");
        doc.setFontSize(8);
        doc.setTextColor(100);
        ensureSpace(14);
        doc.text(caption, margin, y);
        doc.setTextColor(0);
        y += 14;
      } else {
        y += padAfter - 8;
      }
    } catch {
      /* skip broken image */
    }
  };

  doc.setFillColor(196, 92, 38);
  doc.rect(0, 0, pageW, 10, "F");
  y = margin + 18;

  const report = video.report;
  setFace("bold");
  writeWrapped("유튜브 요약 · 팩트체크 보고서", 16, 4);
  setFace("normal");

  writeWrapped(`제목: ${video.title}`, 12, 6);
  writeWrapped(`채널: ${video.channel}`, 11, 4);
  writeWrapped(`링크: ${video.youtubeUrl}`, 10, 4);
  writeWrapped(
    `작성일: ${report?.meta.writtenAt ?? new Date(video.updatedAt).toLocaleString("ko-KR")}`,
    10,
    4
  );
  writeWrapped(
    `최종 수정: ${new Date(video.updatedAt).toLocaleString("ko-KR")}`,
    10,
    4
  );
  writeWrapped(
    `보고서 유형: ${REPORT_TYPE_LABELS[video.reportType]}`,
    11,
    14
  );

  if (!report) {
    writeWrapped(
      "보고서가 아직 준비되지 않았습니다. 팩트체크를 먼저 완료해 주세요."
    );
    return new Uint8Array(doc.output("arraybuffer"));
  }

  setFace("bold");
  writeWrapped("— 보고서 —", 13, 14);
  setFace("normal");

  // 보고서 본문: 요약 서술 + 섹션 이미지 (팩트체크는 맨 뒤 부록)
  for (const sec of report.sections) {
    ensureSpace(56);
    setFace("bold");
    writeWrapped(sec.heading, 13, 10);
    setFace("normal");

    const plain = reportBodyPlain(sec.body, sec.rich);
    if (plain) writeWrapped(plain, 10, 12);

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

    y += 14;
  }

  const fcMarkers = collectFcMarkers(report);
  if (fcMarkers.length > 0) {
    doc.addPage();
    y = margin + 18;
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
