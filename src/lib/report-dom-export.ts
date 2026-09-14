"use client";

import {
  buildReaderPdfCaptureElement,
  READER_PDF_FONT_FAMILY,
  READER_PDF_FONT_PX,
  READER_PDF_LINE_HEIGHT,
  readerDocFromReport,
} from "@/lib/reader-view";
import type { TypedReport } from "@/lib/types";

/** 보고서 보기 모드로 전환 (인쇄·PDF 전 본문 DOM 확보) */
export function requestReportViewMode(videoId?: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("factcheck:edit-report", {
      detail: { id: videoId, mode: "view" },
    })
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function waitForReportBody(timeoutMs = 2500): Promise<HTMLElement | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const root =
      document.getElementById("report-body-export") ||
      document.getElementById("report");
    const body = root?.querySelector(".report-body") as HTMLElement | null;
    if (root && body && body.innerHTML.trim().length > 0) {
      return root as HTMLElement;
    }
    await wait(50);
  }
  return (
    (document.getElementById("report-body-export") as HTMLElement | null) ||
    (document.getElementById("report") as HTMLElement | null)
  );
}

/** 인쇄 전에 보기 본문 DOM이 준비되게 함 (편집 중이어도 export 루트 사용) */
export async function prepareReportForPrint(videoId?: string): Promise<void> {
  const exportRoot = document.getElementById("report-body-export");
  if (!exportRoot) {
    requestReportViewMode(videoId);
    await waitForReportBody();
  }
  document.getElementById("report")?.scrollIntoView({
    behavior: "auto",
    block: "start",
  });
  await wait(150);
}

/** A4 96dpi 기준 가로폭 (약 210mm) */
const CAPTURE_WIDTH_PX = 794;
/** A4 세로 비율 */
const A4_RATIO = 297 / 210;
const CAPTURE_PAGE_HEIGHT_PX = Math.round(CAPTURE_WIDTH_PX * A4_RATIO);
/** 본문 안쪽 여백 (약 14mm) */
const CAPTURE_PAD_X = 52;
const CAPTURE_PAD_Y = 48;
/** 한 페이지에 이미지가 텍스트를 밀어내지 않도록 높이 상한 */
const MAX_IMAGE_PAGE_RATIO = 0.48;

/**
 * html2canvas 는 object-fit 을 무시해 width:100%+max-height 이미지가 찌그러짐.
 * A4 한 페이지 안에 텍스트와 같이 보이도록 비율·높이 상한을 맞춤.
 */
function normalizeImagesForCapture(root: HTMLElement): void {
  const contentW = CAPTURE_WIDTH_PX - CAPTURE_PAD_X * 2;
  const maxImgH = Math.floor(
    (CAPTURE_PAGE_HEIGHT_PX - CAPTURE_PAD_Y * 2) * MAX_IMAGE_PAGE_RATIO
  );

  root.querySelectorAll("img").forEach((img) => {
    const el = img as HTMLImageElement;
    el.style.setProperty("width", "auto", "important");
    el.style.setProperty("max-width", "100%", "important");
    el.style.setProperty("height", "auto", "important");
    el.style.setProperty("max-height", `${maxImgH}px`, "important");
    el.style.setProperty("object-fit", "contain", "important");
    el.style.setProperty("object-position", "left center", "important");
    el.style.setProperty("display", "block", "important");
    el.style.setProperty("margin", "10px 0 14px", "important");
    const nw = el.naturalWidth || 0;
    const nh = el.naturalHeight || 0;
    if (nw > 0 && nh > 0) {
      let drawW = Math.min(contentW, nw);
      let drawH = Math.round((nh * drawW) / nw);
      if (drawH > maxImgH) {
        drawH = maxImgH;
        drawW = Math.round((nw * drawH) / nh);
      }
      el.style.setProperty("width", `${drawW}px`, "important");
      el.style.setProperty("height", `${drawH}px`, "important");
    }
  });
  root.querySelectorAll("figure.report-s-image, .report-s-image").forEach((fig) => {
    const el = fig as HTMLElement;
    el.style.setProperty("width", "100%", "important");
    el.style.setProperty("max-width", "100%", "important");
    el.style.setProperty("height", "auto", "important");
    el.style.setProperty("overflow", "visible", "important");
    el.style.setProperty("margin", "8px 0 12px", "important");
    el.style.setProperty("page-break-inside", "avoid", "important");
    el.style.setProperty("break-inside", "avoid", "important");
  });

  // 문단·제목이 페이지 경계에서 덜 잘리게
  root.querySelectorAll("p, h1, h2, h3, h4, li").forEach((node) => {
    const el = node as HTMLElement;
    el.style.setProperty("orphans", "3", "important");
    el.style.setProperty("widows", "3", "important");
  });
}

async function waitForImages(root: HTMLElement): Promise<void> {
  const imgs = Array.from(root.querySelectorAll("img"));
  await Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((resolve) => {
          const el = img as HTMLImageElement;
          if (el.complete && el.naturalWidth > 0) {
            resolve();
            return;
          }
          el.onload = () => resolve();
          el.onerror = () => resolve();
          window.setTimeout(() => resolve(), 5000);
        })
    )
  );
}

/** 가로줄이 거의 흰색이면 문단/이미지 사이 여백으로 본다 */
function isMostlyBlankRow(
  ctx: CanvasRenderingContext2D,
  y: number,
  width: number
): boolean {
  const clamped = Math.max(0, Math.min(y, ctx.canvas.height - 1));
  const sample = Math.min(width, 640);
  const step = Math.max(1, Math.floor(sample / 80));
  const data = ctx.getImageData(0, clamped, sample, 1).data;
  let bright = 0;
  let n = 0;
  for (let x = 0; x < sample; x += step) {
    const i = x * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (r > 245 && g > 245 && b > 245) bright += 1;
    n += 1;
  }
  return n > 0 && bright / n >= 0.92;
}

/**
 * 페이지 끝 근처에서 흰 여백(문단·이미지 사이)을 찾아 자른다.
 * 이미지/글자 한가운데를 가로로 끊는 것을 줄인다.
 */
function findPageBreakY(
  ctx: CanvasRenderingContext2D,
  startY: number,
  idealEndY: number,
  canvasH: number
): number {
  const hardEnd = Math.min(canvasH, idealEndY);
  if (hardEnd <= startY + 40) return hardEnd;

  const searchFrom = Math.max(startY + Math.floor((hardEnd - startY) * 0.62), hardEnd - 140);
  let best = hardEnd;
  let bestScore = -1;

  for (let y = hardEnd; y >= searchFrom; y -= 2) {
    if (!isMostlyBlankRow(ctx, y, ctx.canvas.width)) continue;
    // 연속 여백의 중앙에 가깝게
    let y0 = y;
    while (y0 > searchFrom && isMostlyBlankRow(ctx, y0 - 2, ctx.canvas.width)) {
      y0 -= 2;
    }
    let y1 = y;
    while (y1 < hardEnd && isMostlyBlankRow(ctx, y1 + 2, ctx.canvas.width)) {
      y1 += 2;
    }
    const mid = Math.floor((y0 + y1) / 2);
    const gap = y1 - y0;
    const nearIdeal = 1 - Math.abs(hardEnd - mid) / Math.max(1, hardEnd - searchFrom);
    const score = gap * 2 + nearIdeal * 40;
    if (score > bestScore) {
      bestScore = score;
      best = mid;
    }
  }
  return Math.max(startY + 40, Math.min(best, hardEnd));
}

/** 긴 캔버스를 A4 페이지 높이로 잘라 PDF에 넣음 (여백·이미지 경계 고려) */
function addCanvasPagesToPdf(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdf: any,
  canvas: HTMLCanvasElement
): void {
  const pageW = pdf.internal.pageSize.getWidth() as number;
  const pageH = pdf.internal.pageSize.getHeight() as number;
  const margin = 12;
  const usableW = pageW - margin * 2;
  const usableH = pageH - margin * 2;
  const pxPerMm = canvas.width / usableW;
  const pageHeightPx = Math.max(1, Math.floor(usableH * pxPerMm));

  const probe = document.createElement("canvas");
  probe.width = Math.min(canvas.width, 640);
  probe.height = 1;
  const probeCtx = probe.getContext("2d", { willReadFrequently: true });
  const fullCtx = canvas.getContext("2d", { willReadFrequently: true });

  let srcY = 0;
  let pageIndex = 0;
  while (srcY < canvas.height - 1) {
    if (pageIndex > 0) pdf.addPage();
    const idealEnd = Math.min(canvas.height, srcY + pageHeightPx);
    let endY = idealEnd;
    if (fullCtx && probeCtx && idealEnd < canvas.height) {
      // 축소 샘플로 여백 탐색 (성능)
      const scale = probe.width / canvas.width;
      const sampleH = Math.max(1, Math.ceil((idealEnd - srcY) * scale));
      const sample = document.createElement("canvas");
      sample.width = probe.width;
      sample.height = sampleH;
      const sctx = sample.getContext("2d", { willReadFrequently: true });
      if (sctx) {
        sctx.drawImage(
          canvas,
          0,
          srcY,
          canvas.width,
          idealEnd - srcY,
          0,
          0,
          sample.width,
          sample.height
        );
        const breakLocal = findPageBreakY(
          sctx,
          0,
          sample.height,
          sample.height
        );
        endY = srcY + Math.round(breakLocal / scale);
        endY = Math.max(srcY + 40, Math.min(endY, idealEnd));
      }
    }

    const sliceH = Math.max(1, endY - srcY);
    const slice = document.createElement("canvas");
    slice.width = canvas.width;
    slice.height = sliceH;
    const ctx = slice.getContext("2d");
    if (!ctx) break;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, slice.width, slice.height);
    ctx.drawImage(
      canvas,
      0,
      srcY,
      canvas.width,
      sliceH,
      0,
      0,
      canvas.width,
      sliceH
    );
    const data = slice.toDataURL("image/jpeg", 0.93);
    const sliceHmm = sliceH / pxPerMm;
    pdf.addImage(data, "JPEG", margin, margin, usableW, Math.min(sliceHmm, usableH));
    srcY = endY;
    pageIndex += 1;
    if (pageIndex > 80) break;
  }
}

function canvasesToPdfBlob(canvases: HTMLCanvasElement[]): Promise<Blob> {
  return import("jspdf").then(({ jsPDF }) => {
    const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });
    let firstCanvas = true;
    for (const canvas of canvases) {
      if (!canvas.width || !canvas.height) continue;
      if (!firstCanvas) pdf.addPage();
      firstCanvas = false;
      addCanvasPagesToPdf(pdf, canvas);
    }
    return pdf.output("blob");
  });
}

/**
 * 복제 노드를 A4 폭 컨테이너에서 캡처 — 텍스트·이미지가 한 흐름으로 보이게
 */
async function captureElement(el: HTMLElement): Promise<HTMLCanvasElement> {
  const html2canvas = (await import("html2canvas")).default;
  const host = document.createElement("div");
  host.className = "report-pdf-capture";
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = [
    "position:fixed",
    "left:-10000px",
    "top:0",
    `width:${CAPTURE_WIDTH_PX}px`,
    "max-width:none",
    "z-index:0",
    "opacity:1",
    "visibility:visible",
    "background:#ffffff",
    `padding:${CAPTURE_PAD_Y}px ${CAPTURE_PAD_X}px`,
    "box-sizing:border-box",
    "overflow:visible",
    "pointer-events:none",
    `font-family:${READER_PDF_FONT_FAMILY}`,
    `font-size:${READER_PDF_FONT_PX}px`,
    `line-height:${READER_PDF_LINE_HEIGHT}`,
    "color:#1a1a1a",
    "word-break:keep-all",
  ].join(";");

  const clone = el.cloneNode(true) as HTMLElement;
  clone.classList.remove("report-export-offscreen");
  clone.removeAttribute("aria-hidden");
  clone.style.cssText = [
    "position:static",
    "left:auto",
    "top:auto",
    "opacity:1",
    "visibility:visible",
    "width:100%",
    "max-width:100%",
    "pointer-events:none",
    "z-index:auto",
  ].join(";");

  // 인쇄 전용 숨김 버튼 등 제거
  clone.querySelectorAll(".print\\:hidden, [class*='print:hidden']").forEach((n) => {
    n.remove();
  });

  host.appendChild(clone);
  document.body.appendChild(host);

  try {
    await waitForImages(clone);
    normalizeImagesForCapture(clone);
    await wait(80);
    return await html2canvas(host, {
      scale: 2,
      useCORS: true,
      allowTaint: false,
      logging: false,
      backgroundColor: "#ffffff",
      width: CAPTURE_WIDTH_PX,
      windowWidth: CAPTURE_WIDTH_PX,
      scrollX: 0,
      scrollY: 0,
    });
  } finally {
    host.remove();
  }
}

/**
 * 화면의 보고서 본문(+부록)을 PDF Blob 생성.
 * report 가 있으면 읽기 도구와 같은 글자·문단·이미지 형식으로 만듭니다.
 */
export async function buildReportPdfBlobFromDom(opts?: {
  videoId?: string;
  includeAppendix?: boolean;
  report?: TypedReport | null;
  extraImages?: string[];
}): Promise<Blob> {
  const includeAppendix = opts?.includeAppendix !== false;
  const canvases: HTMLCanvasElement[] = [];

  if (opts?.report) {
    const doc = readerDocFromReport(opts.report, opts.extraImages);
    const readerEl = buildReaderPdfCaptureElement(doc);
    canvases.push(await captureElement(readerEl));
  } else {
    let root = document.getElementById("report-body-export") as HTMLElement | null;
    if (!root) {
      requestReportViewMode(opts?.videoId);
      root = await waitForReportBody();
    }
    if (!root) {
      throw new Error(
        "보고서 본문을 찾지 못했습니다. 보고서 페이지에서 다시 시도해 주세요."
      );
    }
    await waitForImages(root);
    await wait(50);
    canvases.push(await captureElement(root));
  }

  if (includeAppendix) {
    const appendix = document.getElementById("fc-appendix");
    if (appendix && appendix.innerText.trim().length > 20) {
      canvases.push(await captureElement(appendix));
    }
  }

  return canvasesToPdfBlob(canvases);
}

export async function downloadReportPdfFromDom(opts: {
  videoId: string;
  fileName?: string;
  report?: TypedReport | null;
  extraImages?: string[];
}): Promise<void> {
  const blob = await buildReportPdfBlobFromDom({
    videoId: opts.videoId,
    report: opts.report,
    extraImages: opts.extraImages,
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = opts.fileName || `factcheck-report-${opts.videoId}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function shareReportPdfToGoodNotes(opts: {
  videoId: string;
  title: string;
  report?: TypedReport | null;
  fileName?: string;
}): Promise<"shared" | "downloaded"> {
  const blob = await buildReportPdfBlobFromDom({
    videoId: opts.videoId,
    report: opts.report,
  });
  const fileName = opts.fileName || `INF_report.pdf`;
  const file = new File([blob], fileName, { type: "application/pdf" });

  if (
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    (!navigator.canShare || navigator.canShare({ files: [file] }))
  ) {
    try {
      await navigator.share({
        files: [file],
        title: opts.title,
        text: "보고서 PDF · Goodnotes에서 열어 필기하세요",
      });
      return "shared";
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") throw e;
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
  return "downloaded";
}
