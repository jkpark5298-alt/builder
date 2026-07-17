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

export type NumberedPart = {
  number: number;
  text: string;
  imageUrls: string[];
};

/**
 * 번호 묶음 → 한 장의 PNG.
 * 각 번호의 텍스트 바로 아래에 같은 번호의 이미지가 붙습니다.
 */
export async function renderNumberedPartsToDataUrl(
  parts: NumberedPart[],
  style: TextImageStyle = {}
): Promise<string> {
  const usable = parts.filter(
    (p) => p.text.trim() || (p.imageUrls?.length ?? 0) > 0
  );
  if (!usable.length) return renderTextToImageDataUrl("", style);

  const fontSize = style.fontSize ?? 28;
  const padding = style.padding ?? 36;
  const lineHeight = style.lineHeight ?? 1.45;
  const maxWidth = style.maxWidth ?? 720;
  const textColor = style.textColor ?? "#1a2430";
  const backgroundColor = style.backgroundColor ?? "#ffffff";
  const align = style.align ?? "left";
  const gap = 16;
  const partGap = 30;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 오류");

  ctx.font = `${fontSize}px ${FONT}`;
  const contentWidth = maxWidth - padding * 2;
  const linePx = Math.round(fontSize * lineHeight);
  const showNumbers =
    usable.length > 1 || usable.some((p) => /^\d+[.)]/.test(p.text.trim()));

  type Block = {
    lines: string[];
    imgs: Array<{ el: HTMLImageElement; w: number; h: number }>;
  };
  const blocks: Block[] = [];

  for (const part of usable) {
    const label =
      showNumbers && part.text.trim() && !/^\d+[.)]\s/.test(part.text.trim())
        ? `${part.number}. ${part.text.trim()}`
        : part.text.trim();
    const lines = label ? wrapLines(ctx, label, contentWidth) : [];
    const els = await Promise.all(
      (part.imageUrls ?? []).filter(Boolean).map(loadImageEl)
    );
    const imgs = els.map((el) => {
      const scale = Math.min(1, contentWidth / Math.max(el.width, 1));
      return {
        el,
        w: Math.round(el.width * scale),
        h: Math.round(el.height * scale),
      };
    });
    blocks.push({ lines, imgs });
  }

  let total = padding * 2;
  blocks.forEach((b, i) => {
    total += b.lines.length * linePx;
    if (b.lines.length && b.imgs.length) total += gap;
    total += b.imgs.reduce((s, im) => s + im.h, 0) + gap * Math.max(0, b.imgs.length - 1);
    if (i < blocks.length - 1) total += partGap;
  });

  canvas.width = maxWidth;
  canvas.height = total;

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
  blocks.forEach((b, i) => {
    for (const line of b.lines) {
      ctx.fillText(line || " ", x, y);
      y += linePx;
    }
    if (b.lines.length && b.imgs.length) y += gap;
    b.imgs.forEach((im, j) => {
      const imgX = Math.round((canvas.width - im.w) / 2);
      ctx.drawImage(im.el, imgX, y, im.w, im.h);
      y += im.h + (j < b.imgs.length - 1 ? gap : 0);
    });
    if (i < blocks.length - 1) {
      y += Math.round(partGap / 2);
      ctx.strokeStyle = "#eef0f3";
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(canvas.width - padding, y);
      ctx.stroke();
      y += Math.round(partGap / 2);
    }
  });

  return canvas.toDataURL("image/png");
}
