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
