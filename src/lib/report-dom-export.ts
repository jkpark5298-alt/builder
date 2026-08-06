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

function canvasToPdfBlob(
  canvases: HTMLCanvasElement[]
): Promise<Blob> {
  return import("jspdf").then(({ jsPDF }) => {
    const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    let firstPage = true;

    for (const canvas of canvases) {
      if (!canvas.width || !canvas.height) continue;
      const imgData = canvas.toDataURL("image/jpeg", 0.92);
      const imgW = pageW;
      const imgH = (canvas.height * imgW) / canvas.width;
      let heightLeft = imgH;
      let y = 0;

      if (!firstPage) pdf.addPage();
      firstPage = false;

      pdf.addImage(imgData, "JPEG", 0, y, imgW, imgH);
      heightLeft -= pageH;

      while (heightLeft > 1) {
        y = heightLeft - imgH;
        pdf.addPage();
        pdf.addImage(imgData, "JPEG", 0, y, imgW, imgH);
        heightLeft -= pageH;
      }
    }

    return pdf.output("blob");
  });
}

async function captureElement(el: HTMLElement): Promise<HTMLCanvasElement> {
  const html2canvas = (await import("html2canvas")).default;
  const prev = {
    opacity: el.style.opacity,
    visibility: el.style.visibility,
    position: el.style.position,
    left: el.style.left,
    top: el.style.top,
    zIndex: el.style.zIndex,
    width: el.style.width,
    maxWidth: el.style.maxWidth,
    pointerEvents: el.style.pointerEvents,
  };
  // 편집 중 offscreen 복제본도 캡처 가능하게 잠깐 보이게
  el.style.opacity = "1";
  el.style.visibility = "visible";
  el.style.pointerEvents = "none";
  if (getComputedStyle(el).position === "fixed" || el.classList.contains("report-export-offscreen")) {
    el.style.position = "fixed";
    el.style.left = "0";
    el.style.top = "0";
    el.style.zIndex = "-1";
    el.style.width = "794px";
    el.style.maxWidth = "794px";
  }
  try {
    return await html2canvas(el, {
      scale: 2,
      useCORS: true,
      allowTaint: false,
      logging: false,
      backgroundColor: "#ffffff",
      windowWidth: Math.max(el.scrollWidth, 794),
    });
  } finally {
    el.style.opacity = prev.opacity;
    el.style.visibility = prev.visibility;
    el.style.position = prev.position;
    el.style.left = prev.left;
    el.style.top = prev.top;
    el.style.zIndex = prev.zIndex;
    el.style.width = prev.width;
    el.style.maxWidth = prev.maxWidth;
    el.style.pointerEvents = prev.pointerEvents;
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
    throw new Error("보고서 본문을 찾지 못했습니다. 보고서 페이지에서 다시 시도해 주세요.");
  }

  // 이미지 로드 대기
  const imgs = Array.from(root.querySelectorAll("img"));
  await Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) {
            resolve();
            return;
          }
          img.onload = () => resolve();
          img.onerror = () => resolve();
          window.setTimeout(() => resolve(), 4000);
        })
    )
  );
  await wait(100);

  const canvases: HTMLCanvasElement[] = [await captureElement(root)];
  if (includeAppendix) {
    const appendix = document.getElementById("fc-appendix");
    if (appendix && appendix.innerText.trim().length > 20) {
      const prevDisplay = appendix.style.display;
      appendix.style.display = "block";
      try {
        canvases.push(await captureElement(appendix));
      } finally {
        appendix.style.display = prevDisplay;
      }
    }
  }

  return canvasToPdfBlob(canvases);
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
