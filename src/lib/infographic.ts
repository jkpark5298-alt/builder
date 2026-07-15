import type { InfographicData, VideoRecord } from "./types";
import { REPORT_TYPE_LABELS } from "./types";
import { isFailedVerdict, verdictBadge, normalizeAiAnswer } from "./text-format";

const imageCache = new Map<string, string | null>();

function isYoutubeThumb(url?: string | null): boolean {
  if (!url) return false;
  return /i\.ytimg\.com|ytimg\.com\/vi\//i.test(url);
}

function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchImageDataUrl(url: string): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith("data:")) return url;
  if (imageCache.has(url)) return imageCache.get(url) ?? null;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: "image/*" },
    });
    if (!res.ok) {
      imageCache.set(url, null);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 3_000) {
      imageCache.set(url, null);
      return null;
    }
    const ct = res.headers.get("content-type") || "image/jpeg";
    const dataUrl = `data:${ct};base64,${buf.toString("base64")}`;
    imageCache.set(url, dataUrl);
    return dataUrl;
  } catch {
    imageCache.set(url, null);
    return null;
  }
}

/** 한글·영문 혼합 줄바꿈 (대략 픽셀 폭 기준) */
function wrapSvgText(
  text: string,
  maxWidthPx: number,
  maxLines: number,
  fontSize: number
): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const avg = fontSize * 0.92; // 한글 기준
  const maxChars = Math.max(8, Math.floor(maxWidthPx / avg));
  const lines: string[] = [];
  let rest = clean;
  while (rest && lines.length < maxLines) {
    if (rest.length <= maxChars) {
      lines.push(rest);
      break;
    }
    let cut = rest.lastIndexOf(" ", maxChars);
    if (cut < maxChars * 0.35) cut = maxChars;
    lines.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest && lines.length === maxLines) {
    const last = lines[maxLines - 1];
    lines[maxLines - 1] =
      last.length > 2 ? `${last.slice(0, -1)}…` : `${last}…`;
  }
  return lines;
}

export async function buildInfographic(
  video: VideoRecord
): Promise<InfographicData> {
  const fcMap = new Map(video.factChecks.map((f) => [f.itemId, f]));
  const fcItems = video.items.filter((i) => i.needsFactCheck).slice(0, 6);

  const hero =
    (await fetchImageDataUrl(video.thumbnailUrl)) ||
    (await fetchImageDataUrl(
      `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`
    ));

  type Card = {
    statement: string;
    summary: string;
    mark: string;
    fail: boolean;
    img: string | null;
  };

  const cards: Card[] = [];
  for (const item of fcItems) {
    const fc = fcMap.get(item.id);
    const verdict = fc?.verdict ?? "pending";
    const badge = verdictBadge(verdict);
    const fail = isFailedVerdict(verdict);
    const answer = fc?.explanation?.trim() ?? "";
    const isPrompt = !answer || /^다음 주장을/.test(answer);
    const summary = isPrompt
      ? item.statement
      : normalizeAiAnswer(answer).slice(0, 220);

    let related: string | null = null;
    if (fc?.answerImageUrl && !isYoutubeThumb(fc.answerImageUrl)) {
      related = await fetchImageDataUrl(fc.answerImageUrl);
    } else if (item.imageUrl && !isYoutubeThumb(item.imageUrl)) {
      related = await fetchImageDataUrl(item.imageUrl);
    }

    cards.push({
      statement: item.statement,
      summary,
      mark: fail ? "✗" : badge.mark,
      fail,
      img: related,
    });
  }

  const sectionHints =
    video.report?.sections
      .filter((s) => s.heading !== "팩트체크")
      .map((s) => ({
        heading: s.heading,
        short: stripTags(s.body).slice(0, 280) || "",
      }))
      .filter((s) => s.short) ?? [];

  // 팩트체크 하단 요약 (항상 표시)
  const fcBottom = cards.map((c) => ({
    heading: `FACT ${c.mark}`,
    short: c.statement,
    fail: c.fail,
  }));

  const highlights = cards.map((c) => ({
    label: c.fail ? "검증 ✗" : "검증",
    short: c.statement.slice(0, 60) + (c.statement.length > 60 ? "…" : ""),
  }));

  const title = escapeXml(video.title.slice(0, 48));
  const channel = escapeXml(video.channel);
  const typeLabel = escapeXml(REPORT_TYPE_LABELS[video.reportType]);

  const verified = video.factChecks.filter(
    (f) => f.explanation.trim() && !/^다음 주장을/.test(f.explanation)
  ).length;
  const failed = video.factChecks.filter((f) =>
    isFailedVerdict(f.verdict)
  ).length;

  const W = 800;
  const padX = 48;
  const contentW = W - padX * 2;

  const heroH = hero ? 200 : 0;
  const titleBlockH = 70;
  const heroTop = 24 + titleBlockH;
  const statsY = hero ? heroTop + heroH + 18 : 24 + titleBlockH;
  let y = statsY + 72;
  let contentBottom = y;

  const blocks: string[] = [];

  // —— 팩트체크 항목 카드 ——
  cards.forEach((c, i) => {
    const hasImg = Boolean(c.img);
    const textW = hasImg ? contentW - 200 : contentW - 36;
    const stmtLines = wrapSvgText(c.statement, textW, 3, 13);
    const sumLines = wrapSvgText(c.summary, textW, hasImg ? 4 : 5, 11);
    const textH =
      24 + stmtLines.length * 18 + 6 + sumLines.length * 15 + 16;
    const blockH = Math.max(hasImg ? 124 : 80, textH);
    const top = y;

    let imgBlock = "";
    if (c.img) {
      imgBlock = `
      <clipPath id="rc${i}"><rect x="${padX + contentW - 188}" y="${top + 12}" width="176" height="100" rx="8"/></clipPath>
      <image href="${c.img}" xlink:href="${c.img}" x="${padX + contentW - 188}" y="${top + 12}" width="176" height="100" preserveAspectRatio="xMidYMid slice" clip-path="url(#rc${i})"/>
      <rect x="${padX + contentW - 188}" y="${top + 12}" width="176" height="100" rx="8" fill="none" stroke="#d0d9e2"/>`;
    }

    const stmt = stmtLines
      .map(
        (line, li) =>
          `<text x="${padX + 28}" y="${top + 34 + li * 18}" font-size="13" font-weight="600" fill="#1a2430">${escapeXml(line)}</text>`
      )
      .join("");
    const sumStart = top + 34 + stmtLines.length * 18 + 8;
    const sum = sumLines
      .map(
        (line, li) =>
          `<text x="${padX + 28}" y="${sumStart + li * 15}" font-size="11" fill="#567088">${escapeXml(line)}</text>`
      )
      .join("");

    blocks.push(`
    <g>
      <rect x="${padX}" y="${top}" width="${contentW}" height="${blockH}" rx="12" fill="#ffffff" stroke="${c.fail ? "#e05555" : "#d0d9e2"}"/>
      <circle cx="${padX + 16}" cy="${top + 22}" r="10" fill="${c.fail ? "#fde8e8" : "#e8f5ec"}"/>
      <text x="${padX + 16}" y="${top + 26}" text-anchor="middle" font-size="12" font-weight="700" fill="${c.fail ? "#c03030" : "#2d6a3e"}">${escapeXml(c.mark)}</text>
      ${stmt}
      ${sum}
      ${imgBlock}
    </g>`);
    y += blockH + 12;
    contentBottom = y;
  });

  // —— 보고서 요약 (결론·요약 전체 표시) ——
  if (sectionHints.length) {
    y += 10;
    blocks.push(
      `<text x="${padX}" y="${y}" font-size="13" font-weight="600" fill="#567088">보고서 요약</text>`
    );
    y += 18;
    contentBottom = y;

    for (const h of sectionHints) {
      const lines = wrapSvgText(h.short, contentW - 36, 6, 11);
      const hgt = 22 + 8 + lines.length * 15 + 14;
      const top = y;
      const body = lines
        .map(
          (line, li) =>
            `<text x="${padX + 20}" y="${top + 36 + li * 15}" font-size="11" fill="#425870">${escapeXml(line)}</text>`
        )
        .join("");
      blocks.push(`
      <rect x="${padX}" y="${top}" width="${contentW}" height="${hgt}" rx="10" fill="#fff" stroke="#e2e8f0"/>
      <rect x="${padX}" y="${top}" width="5" height="${hgt}" rx="2" fill="#c45c26"/>
      <text x="${padX + 20}" y="${top + 18}" font-size="12" font-weight="600" fill="#c45c26">${escapeXml(h.heading)}</text>
      ${body}`);
      y += hgt + 12;
      contentBottom = y;
    }
  }

  // —— 팩트체크 한줄 요약 (하단) ——
  if (fcBottom.length) {
    y += 8;
    blocks.push(
      `<text x="${padX}" y="${y}" font-size="13" font-weight="600" fill="#567088">팩트체크 요약</text>`
    );
    y += 18;
    contentBottom = y;

    for (const row of fcBottom) {
      const lines = wrapSvgText(row.short, contentW - 48, 3, 12);
      const hgt = 18 + lines.length * 16 + 12;
      const top = y;
      const body = lines
        .map(
          (line, li) =>
            `<text x="${padX + 44}" y="${top + 22 + li * 16}" font-size="12" fill="#1a2430">${escapeXml(line)}</text>`
        )
        .join("");
      blocks.push(`
      <rect x="${padX}" y="${top}" width="${contentW}" height="${hgt}" rx="10" fill="${row.fail ? "#fff5f5" : "#f7faf8"}" stroke="${row.fail ? "#f0b4b4" : "#cfe3d4"}"/>
      <text x="${padX + 14}" y="${top + 22}" font-size="12" font-weight="700" fill="${row.fail ? "#c03030" : "#2d6a3e"}">${escapeXml(row.heading)}</text>
      ${body}`);
      y += hgt + 10;
      contentBottom = y;
    }
  }

  // 하단이 잘리지 않도록 여유 패딩
  const height = Math.max(480, contentBottom + 64);

  const svgMarkup = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#f7f8fa"/>
      <stop offset="100%" stop-color="#eef1f5"/>
    </linearGradient>
    ${
      hero
        ? `<clipPath id="heroClip"><rect x="${padX}" y="${heroTop}" width="${contentW}" height="${heroH}" rx="14"/></clipPath>`
        : ""
    }
  </defs>
  <rect width="${W}" height="${height}" fill="url(#bg)"/>
  <rect x="0" y="0" width="${W}" height="6" fill="#c45c26"/>

  <text x="${padX}" y="40" font-family="Malgun Gothic, Apple SD Gothic Neo, NanumGothic, sans-serif" font-size="22" font-weight="700" fill="#1a2430">팩트체크 인포그래픽</text>
  <text x="${padX}" y="62" font-family="Malgun Gothic, Apple SD Gothic Neo, NanumGothic, sans-serif" font-size="13" fill="#425870">${title}</text>
  <text x="${padX}" y="80" font-family="Malgun Gothic, Apple SD Gothic Neo, NanumGothic, sans-serif" font-size="11" fill="#7890a8">${channel} · ${typeLabel}</text>

  ${
    hero
      ? `<image href="${hero}" xlink:href="${hero}" x="${padX}" y="${heroTop}" width="${contentW}" height="${heroH}" preserveAspectRatio="xMidYMid slice" clip-path="url(#heroClip)"/>
  <rect x="${padX}" y="${heroTop}" width="${contentW}" height="${heroH}" rx="14" fill="none" stroke="#d0d9e2"/>`
      : ""
  }

  <g font-family="Malgun Gothic, Apple SD Gothic Neo, NanumGothic, sans-serif">
    <rect x="${padX}" y="${statsY}" width="220" height="48" rx="10" fill="#1a2430"/>
    <text x="${padX + 16}" y="${statsY + 20}" font-size="11" fill="#a8b8c8">검증 완료</text>
    <text x="${padX + 16}" y="${statsY + 38}" font-size="18" fill="#fff">${verified}</text>

    <rect x="284" y="${statsY}" width="220" height="48" rx="10" fill="#c03030"/>
    <text x="300" y="${statsY + 20}" font-size="11" fill="#fde8e8">사실과 다름 ✗</text>
    <text x="300" y="${statsY + 38}" font-size="18" fill="#fff">${failed}</text>

    <rect x="520" y="${statsY}" width="232" height="48" rx="10" fill="#354858"/>
    <text x="536" y="${statsY + 20}" font-size="11" fill="#a8b8c8">팩트체크 대상</text>
    <text x="536" y="${statsY + 38}" font-size="18" fill="#fff">${fcItems.length}</text>
  </g>

  <text x="${padX}" y="${statsY + 68}" font-size="12" fill="#7890a8" font-family="Malgun Gothic, Apple SD Gothic Neo, NanumGothic, sans-serif">팩트체크 항목${cards.some((c) => c.img) ? " · 관련 이미지(있을 때만)" : ""}</text>

  <g font-family="Malgun Gothic, Apple SD Gothic Neo, NanumGothic, sans-serif">
    ${blocks.join("\n")}
  </g>

  <rect x="0" y="${height - 8}" width="${W}" height="8" fill="#c45c26"/>
</svg>`;

  return {
    title: video.title,
    channel: video.channel,
    reportType: video.reportType,
    stats: {
      claims: video.items.filter((i) => i.type === "claim").length,
      opinions: video.items.filter((i) => i.type === "opinion").length,
      info: video.items.filter((i) => i.type === "info").length,
      verified,
    },
    highlights,
    sectionHints,
    svgMarkup,
  };
}

function escapeXml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
