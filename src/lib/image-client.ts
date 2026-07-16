/** 클라이언트 이미지 압축 — Blob 저장 한도 내로 */
export async function compressImageFile(
  file: File,
  maxBytes = 1_800_000,
  maxWidth = 1280
): Promise<string> {
  const dataUrl = await readFileAsDataUrl(file);
  if (file.size <= maxBytes && !file.type.includes("heic")) {
    return dataUrl;
  }

  const img = await loadImage(dataUrl);
  const scale = Math.min(1, maxWidth / Math.max(img.width, 1));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, w, h);

  let quality = 0.88;
  let out = canvas.toDataURL("image/jpeg", quality);
  while (out.length > maxBytes * 1.37 && quality > 0.45) {
    quality -= 0.08;
    out = canvas.toDataURL("image/jpeg", quality);
  }
  return out;
}

export async function compressImageFiles(files: File[]): Promise<string[]> {
  const out: string[] = [];
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    out.push(await compressImageFile(file));
  }
  return out;
}

/** 클립보드·드래그에서 이미지 파일 추출 */
export function extractImageFilesFromDataTransfer(
  data: DataTransfer
): File[] {
  const fromItems: File[] = [];
  for (let i = 0; i < data.items.length; i++) {
    const item = data.items[i];
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const f = item.getAsFile();
      if (f) fromItems.push(f);
    }
  }
  if (fromItems.length) return fromItems;
  return Array.from(data.files).filter((f) => f.type.startsWith("image/"));
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = src;
  });
}
