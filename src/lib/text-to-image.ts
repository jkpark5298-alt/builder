/** 텍스트를 PNG 데이터 URL로 렌더 (워드 텍스트 상자 → 그림) */

export type TextImageStyle = {
  fontSize?: number;
  textColor?: string;
  backgroundColor?: string;
  maxWidth?: number;
  padding?: number;
  lineHeight?: number;
  align?: CanvasTextAlign;
};

const FONT =
  '"Malgun Gothic", "Apple SD Gothic Neo", "NanumGothic", "Noto Sans KR", sans-serif';

function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const paragraphs = text.replace(/\r\n/g, "\n").split("\n");
  const lines: string[] = [];
  for (const para of paragraphs) {
    if (!para) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const ch of para) {
      const test = current + ch;
      if (ctx.measureText(test).width > maxWidth && current) {
        lines.push(current);
        current = ch;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
  }
  return lines.length ? lines : [""];
}

export function renderTextToImageDataUrl(
  text: string,
  style: TextImageStyle = {}
): string {
  const fontSize = style.fontSize ?? 28;
  const padding = style.padding ?? 36;
  const lineHeight = style.lineHeight ?? 1.45;
  const maxWidth = style.maxWidth ?? 720;
  const textColor = style.textColor ?? "#1a2430";
  const backgroundColor = style.backgroundColor ?? "#ffffff";
  const align = style.align ?? "left";

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 오류");

  ctx.font = `${fontSize}px ${FONT}`;
  const contentWidth = maxWidth - padding * 2;
  const lines = wrapLines(ctx, text.trim(), contentWidth);
  const linePx = Math.round(fontSize * lineHeight);
  const height = Math.max(
    padding * 2 + linePx,
    padding * 2 + lines.length * linePx
  );

  canvas.width = maxWidth;
  canvas.height = height;

  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 살짝 카드 느낌 테두리
  ctx.strokeStyle = "#e5e7eb";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);

  ctx.font = `${fontSize}px ${FONT}`;
  ctx.fillStyle = textColor;
  ctx.textBaseline = "top";
  ctx.textAlign = align;

  let x = padding;
  if (align === "center") x = canvas.width / 2;
  if (align === "right") x = canvas.width - padding;

  let y = padding;
  for (const line of lines) {
    ctx.fillText(line || " ", x, y);
    y += linePx;
  }

  return canvas.toDataURL("image/png");
}

function loadImageEl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("이미지를 불러오지 못했습니다."));
    img.src = src;
  });
}

/** 텍스트 + (아래) 이미지 1장 이상 → 한 장의 PNG 데이터 URL */
export async function renderTextWithImagesToDataUrl(
  text: string,
  imageDataUrls: string[],
  style: TextImageStyle = {}
): Promise<string> {
  const trimmed = text.trim();
  const urls = imageDataUrls.filter(Boolean);
  if (!urls.length) return renderTextToImageDataUrl(trimmed, style);

  const fontSize = style.fontSize ?? 28;
  const padding = style.padding ?? 36;
  const lineHeight = style.lineHeight ?? 1.45;
  const maxWidth = style.maxWidth ?? 720;
  const textColor = style.textColor ?? "#1a2430";
  const backgroundColor = style.backgroundColor ?? "#ffffff";
  const align = style.align ?? "left";
  const gap = 20;

  const imgs = await Promise.all(urls.map(loadImageEl));

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 오류");

  ctx.font = `${fontSize}px ${FONT}`;
  const contentWidth = maxWidth - padding * 2;
  const lines = trimmed ? wrapLines(ctx, trimmed, contentWidth) : [];
  const linePx = Math.round(fontSize * lineHeight);
  const textBlock = lines.length * linePx;

  const sizes = imgs.map((img) => {
    const scale = Math.min(1, contentWidth / Math.max(img.width, 1));
    return {
      w: Math.round(img.width * scale),
      h: Math.round(img.height * scale),
    };
  });
  const imagesBlock =
    sizes.reduce((sum, s) => sum + s.h, 0) + gap * (imgs.length - 1);

  canvas.width = maxWidth;
  canvas.height =
    padding * 2 + textBlock + (textBlock ? gap : 0) + imagesBlock;

  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "#e5e7eb";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);

  ctx.font = `${fontSize}px ${FONT}`;
  ctx.fillStyle = textColor;
  ctx.textBaseline = "top";
  ctx.textAlign = align;

  let x = padding;
  if (align === "center") x = canvas.width / 2;
  if (align === "right") x = canvas.width - padding;

  let y = padding;
  for (const line of lines) {
    ctx.fillText(line || " ", x, y);
    y += linePx;
  }
  if (textBlock) y += gap;

  for (let i = 0; i < imgs.length; i++) {
    const { w, h } = sizes[i];
    const imgX = Math.round((canvas.width - w) / 2);
    ctx.drawImage(imgs[i], imgX, y, w, h);
    y += h + gap;
  }

  return canvas.toDataURL("image/png");
}
