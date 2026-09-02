/** API/저장소 효율용 목표 크기 (base64 전 바이너리 기준) */
export const DEFAULT_MAX_BYTES = 120_000;
export const DEFAULT_MAX_WIDTH = 640;

/** data URL → JPEG 압축 (텍스트→이미지 PNG 등) */
export async function compressDataUrl(
  dataUrl: string,
  maxBytes = DEFAULT_MAX_BYTES,
  maxWidth = DEFAULT_MAX_WIDTH
): Promise<string> {
  if (!dataUrl.startsWith("data:image/")) return dataUrl;
  // 이미 충분히 작은 JPEG면 그대로 (HEIC 제외)
  if (
    dataUrl.length <= maxBytes * 1.37 &&
    /^data:image\/jpe?g/i.test(dataUrl)
  ) {
    return dataUrl;
  }

  const img = await loadImage(dataUrl);
  const scale = Math.min(1, maxWidth / Math.max(img.width, 1));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  let quality = 0.72;
  let out = canvas.toDataURL("image/jpeg", quality);
  while (out.length > maxBytes * 1.37 && quality > 0.32) {
    quality -= 0.07;
    out = canvas.toDataURL("image/jpeg", quality);
  }
  // 여전히 크면 한 번 더 축소
  if (out.length > maxBytes * 1.37 && maxWidth > 360) {
    return compressDataUrl(out, maxBytes, Math.round(maxWidth * 0.72));
  }
  return out;
}

export async function compressDataUrls(
  urls: string[],
  maxBytes = DEFAULT_MAX_BYTES,
  maxWidth = DEFAULT_MAX_WIDTH
): Promise<string[]> {
  const out: string[] = [];
  for (const u of urls) {
    if (!u) continue;
    out.push(await compressDataUrl(u, maxBytes, maxWidth));
  }
  return out;
}

/** 클라이언트 이미지 압축 — API/DB 한도 내로 */
export async function compressImageFile(
  file: File,
  maxBytes = DEFAULT_MAX_BYTES,
  maxWidth = DEFAULT_MAX_WIDTH
): Promise<string> {
  const dataUrl = await readFileAsDataUrl(file);
  return compressDataUrl(dataUrl, maxBytes, maxWidth);
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

/** iOS·모바일: 사용자 탭 후 클립보드에서 이미지 읽기 */
export async function readImagesFromClipboard(): Promise<File[]> {
  if (!navigator.clipboard?.read) {
    return [];
  }
  const items = await navigator.clipboard.read();
  const files: File[] = [];
  for (const item of items) {
    for (const type of item.types) {
      if (!type.startsWith("image/")) continue;
      const blob = await item.getType(type);
      const ext = type.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "png";
      files.push(
        new File([blob], `clipboard.${ext}`, {
          type: blob.type || type,
        })
      );
    }
  }
  return files;
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

export type CropRect = { sx: number; sy: number; sw: number; sh: number };

const CROP_UPLOAD_MAX_BYTES = 4_000_000;

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

/** 원본을 디코딩한 뒤 object URL로 로드 (캔버스 CORS 회피) */
export async function loadImageForEdit(src: string): Promise<{
  img: HTMLImageElement;
  revoke: () => void;
}> {
  if (src.startsWith("data:")) {
    return { img: await loadImage(src), revoke: () => undefined };
  }
  const res = await fetch(src);
  if (!res.ok) throw new Error("이미지를 읽지 못했습니다.");
  const blob = await res.blob();
  const obj = URL.createObjectURL(blob);
  try {
    const img = await loadImage(obj);
    return {
      img,
      revoke: () => URL.revokeObjectURL(obj),
    };
  } catch (e) {
    URL.revokeObjectURL(obj);
    throw e;
  }
}

/**
 * 원본 픽셀 그대로 잘라낸다. 축소·JPEG 재압축 없음.
 * PNG가 업로드 한도를 넘을 때만 같은 크기의 JPEG(0.95)로 저장한다.
 */
export async function cropImageLossless(
  src: string,
  region: CropRect
): Promise<string> {
  const { img, revoke } = await loadImageForEdit(src);
  try {
    const sx = Math.max(0, Math.floor(region.sx));
    const sy = Math.max(0, Math.floor(region.sy));
    const sw = Math.max(1, Math.min(img.naturalWidth - sx, Math.round(region.sw)));
    const sh = Math.max(1, Math.min(img.naturalHeight - sy, Math.round(region.sh)));
    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("이미지를 잘라내지 못했습니다.");
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    const png = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png")
    );
    if (png && png.size <= CROP_UPLOAD_MAX_BYTES) {
      return blobToDataUrl(png);
    }
    const jpg = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.95)
    );
    if (!jpg) throw new Error("이미지를 잘라내지 못했습니다.");
    return blobToDataUrl(jpg);
  } finally {
    revoke();
  }
}
