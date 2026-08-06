"use client";

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

const CAPTURE_WIDTH_PX = 794;

/**
 * html2canvas 는 object-fit 을 무시해 width:100%+max-height 이미지가 찌그러짐.
 * 캡처용 복제본에서 원본 비율로 고친다.
 */
function normalizeImagesForCapture(root: HTMLElement): void {
  root.querySelectorAll("img").forEach((img) => {
    const el = img as HTMLImageElement;
    el.style.setProperty("width", "auto", "important");
    el.style.setProperty("max-width", "100%", "important");
    el.style.setProperty("height", "auto", "important");
    el.style.setProperty("max-height", "none", "important");
    el.style.setProperty("object-fit", "contain", "important");
    el.style.setProperty("object-position", "left center", "important");
    el.style.setProperty("display", "block", "important");
    const nw = el.naturalWidth || 0;
    const nh = el.naturalHeight || 0;
    if (nw > 0 && nh > 0) {
      const maxW = Math.min(CAPTURE_WIDTH_PX - 48, nw);
      const scaledH = Math.round((nh * maxW) / nw);
      el.style.setProperty("width", `${maxW}px`, "important");
      el.style.setProperty("height", `${scaledH}px`, "important");
    }
  });
  root.querySelectorAll("figure.report-s-image, .report-s-image").forEach((fig) => {
    const el = fig as HTMLElement;
    el.style.setProperty("width", "100%", "important");
    el.style.setProperty("max-width", "100%", "important");
    el.style.setProperty("height", "auto", "important");
    el.style.setProperty("overflow", "visible", "important");
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

/** 긴 캔버스를 A4 페이지 높이로 잘라 PDF에 넣음 (비율 유지, 음수 y 슬라이스 금지) */
function addCanvasPagesToPdf(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdf: any,
  canvas: HTMLCanvasElement
): void {
  const pageW = pdf.internal.pageSize.getWidth() as number;
  const pageH = pdf.internal.pageSize.getHeight() as number;
  const margin = 8;
  const usableW = pageW - margin * 2;
  const usableH = pageH - margin * 2;
  const pxPerMm = canvas.width / usableW;
  const pageHeightPx = Math.max(1, Math.floor(usableH * pxPerMm));

  let srcY = 0;
  let pageIndex = 0;
  while (srcY < canvas.height) {
    if (pageIndex > 0) pdf.addPage();
    const sliceH = Math.min(pageHeightPx, canvas.height - srcY);
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
    const data = slice.toDataURL("image/jpeg", 0.92);
    const sliceHmm = sliceH / pxPerMm;
    pdf.addImage(data, "JPEG", margin, margin, usableW, sliceHmm);
    srcY += sliceH;
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
 * 복제 노드를 고정 폭 컨테이너에서 캡처 — 화면 레이아웃·object-fit 왜곡 방지
 */
async function captureElement(el: HTMLElement): Promise<HTMLCanvasElement> {
  const html2canvas = (await import("html2canvas")).default;
  const host = document.createElement("div");
  host.className = "report-pdf-capture";
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = [
    "position:fixed",
    "left:0",
    "top:0",
    `width:${CAPTURE_WIDTH_PX}px`,
    "max-width:100vw",
    "z-index:-1",
    "background:#ffffff",
    "padding:20px 24px",
    "box-sizing:border-box",
    "overflow:visible",
    "pointer-events:none",
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
 * 화면의 보고서 본문(+부록)을 보기와 동일한 형식으로 PDF Blob 생성
 */
export async function buildReportPdfBlobFromDom(opts?: {
  videoId?: string;
  includeAppendix?: boolean;
}): Promise<Blob> {
  const includeAppendix = opts?.includeAppendix !== false;
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

  const canvases: HTMLCanvasElement[] = [await captureElement(root)];
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
}): Promise<void> {
  const blob = await buildReportPdfBlobFromDom({ videoId: opts.videoId });
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
}): Promise<"shared" | "downloaded"> {
  const blob = await buildReportPdfBlobFromDom({ videoId: opts.videoId });
  const fileName = `report-${opts.videoId}.pdf`;
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
