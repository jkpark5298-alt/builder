/** SVG 인포그래픽 → PNG Blob (굿노트·공유용) */
export async function svgUrlToPngBlob(
  svgUrl: string,
  scale = 2
): Promise<Blob> {
  const res = await fetch(svgUrl, { cache: "no-store" });
  if (!res.ok) throw new Error("인포그래픽을 불러오지 못했습니다.");
  const svgText = await res.text();

  const parsed = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const svgEl = parsed.documentElement;
  const vb = svgEl.getAttribute("viewBox")?.split(/[\s,]+/).map(Number);
  const wAttr = Number(svgEl.getAttribute("width")) || vb?.[2] || 800;
  const hAttr = Number(svgEl.getAttribute("height")) || vb?.[3] || 600;
  const width = Math.round(wAttr);
  const height = Math.round(hAttr);

  const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);

  try {
    const img = await loadImage(objectUrl);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 오류");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const png = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("PNG 변환 실패"))),
        "image/png",
        0.95
      );
    });
    return png;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("이미지 로드 실패"));
    img.src = src;
  });
}

export async function shareInfographicToGoodNotes(opts: {
  videoId: string;
  title: string;
  svgUrl: string;
}): Promise<"shared" | "downloaded"> {
  const png = await svgUrlToPngBlob(opts.svgUrl);
  const fileName = `infographic-${opts.videoId}.png`;
  const file = new File([png], fileName, { type: "image/png" });

  // iOS/iPadOS: 공유 시트에서 Goodnotes 선택
  if (
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    (!navigator.canShare || navigator.canShare({ files: [file] }))
  ) {
    try {
      await navigator.share({
        files: [file],
        title: opts.title,
        text: "Goodnotes에서 열어 필기하세요",
      });
      return "shared";
    } catch (e) {
      // 사용자가 취소한 경우
      if (e instanceof Error && e.name === "AbortError") throw e;
    }
  }

  // 폴백: PNG 저장 후 Goodnotes에서 불러오기
  const url = URL.createObjectURL(png);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
  return "downloaded";
}
