import type { InfographicData, VideoRecord } from "./types";
import { REPORT_TYPE_LABELS } from "./types";
import { normalizeImageUrls } from "./image-urls";
import { isFailedVerdict, verdictBadge, normalizeAiAnswer } from "./text-format";

const imageCache = new Map<string, string | null>();
const FONT =
  "Malgun Gothic, Apple SD Gothic Neo, NanumGothic, sans-serif";

function isYoutubeThumb(url?: string | null): boolean {
  if (!url) return false;
  return /i\.ytimg\.com|ytimg\.com\/vi\//i.test(url);
}

/** HTML → 줄바꿈 유지 plain text */
function htmlToPlain(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function fetchImageDataUrl(url: string): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith("data:")) return url;

  // /api/media — 로컬 파일 → Neon (Vercel Blob 중단 시 Neon만 존재)
  if (url.startsWith("/api/media/")) {
    try {
      const key = url.slice("/api/media/".length);
      const { readLocalMedia } = await import("./media-store");
      const local = readLocalMedia(key);
      if (local && local.buffer.length >= 100) {
        return `data:${local.contentType};base64,${local.buffer.toString("base64")}`;
      }
      const { getNeonMedia } = await import("./neon-media");
      const neon = await getNeonMedia(key);
      if (neon && neon.buffer.length >= 100) {
        return `data:${neon.contentType};base64,${neon.buffer.toString("base64")}`;
      }
      return null;
    } catch {
      return null;
    }
  }

  if (imageCache.has(url)) return imageCache.get(url) ?? null;

  try {
    const absolute = url.startsWith("http") ? url : undefined;
    if (!absolute) return null;
    const res = await fetch(absolute, {
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: "image/*" },
    });
    if (!res.ok) {
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100) return null;
    const ct = res.headers.get("content-type") || "image/jpeg";
    const dataUrl = `data:${ct};base64,${buf.toString("base64")}`;
    imageCache.set(url, dataUrl);
    return dataUrl;
  } catch {
    return null;
  }
}

function charWidth(ch: string, fontSize: number): number {
  if (/[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF\u3000-\u9FFF]/.test(ch)) {
    return fontSize * 1.02;
  }
  if (/[０-９Ａ-Ｚａ-ｚ]/.test(ch)) return fontSize * 1.02;
  return fontSize * 0.55;
}

/** 한글·영문 혼합 줄바꿈 — 잘림 없이 전체 줄 반환 */
function wrapSvgText(text: string, maxWidthPx: number, fontSize: number): string[] {
  const paragraphs = text.replace(/\r\n/g, "\n").split("\n");
  const lines: string[] = [];

  for (const para of paragraphs) {
    const clean = para.replace(/[ \t]+/g, " ").trim();
    if (!clean) {
      if (lines.length && lines[lines.length - 1] !== "") lines.push("");
      continue;
    }

    let current = "";
    let currentW = 0;
    for (const ch of clean) {
      const w = charWidth(ch, fontSize);
      if (current && currentW + w > maxWidthPx) {
        lines.push(current);
        current = ch === " " ? "" : ch;
        currentW = current ? w : 0;
      } else {
        current += ch;
        currentW += w;
      }
    }
    if (current) lines.push(current);
  }

  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function textBlockHeight(lines: string[], lineH: number, blankH = lineH * 0.55): number {
  if (!lines.length) return 0;
  return lines.reduce((h, line) => h + (line === "" ? blankH : lineH), 0);
}

function renderLines(
  lines: string[],
  x: number,
  startY: number,
  lineH: number,
  attrs: string,
  blankH = lineH * 0.55
): { svg: string; height: number } {
  let y = startY;
  const parts: string[] = [];
  for (const line of lines) {
    if (line === "") {
      y += blankH;
      continue;
    }
    parts.push(
      `<text x="${x}" y="${y}" ${attrs}>${escapeXml(line)}</text>`
    );
    y += lineH;
  }
  return { svg: parts.join("\n"), height: y - startY };
}

function concisePlain(text: string, maxChars = 160): string {
  const plain = htmlToPlain(text).replace(/\s+/g, " ").trim();
  if (!plain) return "";
  if (plain.length <= maxChars) return plain;
  const cut = plain.slice(0, maxChars);
  const stops = [".", "。", "!", "?", "…"];
  let best = -1;
  for (const s of stops) {
    const i = cut.lastIndexOf(s);
    if (i > best) best = i;
  }
  // 한국어 문장 종결 대략 매칭
  let daLast = -1;
  const re = /다[.。]?(?=\s|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cut))) daLast = m.index + m[0].length - 1;
  if (daLast > best) best = daLast;
  if (best > maxChars * 0.4) return cut.slice(0, best + 1).trim();
  return cut.replace(/\s+\S*$/, "").trim() + "…";
}

export async function buildInfographic(
  video: VideoRecord
): Promise<InfographicData> {
  const fcMap = new Map(video.factChecks.map((f) => [f.itemId, f]));
  const fcItems = video.items.filter((i) => i.needsFactCheck);

  const hero =
    (await fetchImageDataUrl(video.thumbnailUrl)) ||
    (await fetchImageDataUrl(
      `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`
    ));

  type Card = {
    statement: string;
    summary: string;
    mark: string;
    label: string;
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
    const summary = concisePlain(
      isPrompt ? item.statement : normalizeAiAnswer(answer),
      140
    );

    let related: string | null = null;
    const partImgs = (fc?.answerParts ?? []).flatMap((p) => p.imageUrls ?? []);
    const answerImages = [
      ...normalizeImageUrls(fc?.answerImageUrl, fc?.answerImageUrls),
      ...partImgs,
    ].filter((u) => !isYoutubeThumb(u));
    const itemImages = normalizeImageUrls(
      item.imageUrl,
      item.imageUrls
    ).filter((u) => !isYoutubeThumb(u));
    const pick = answerImages[0] ?? itemImages[0];
    if (pick) {
      related = await fetchImageDataUrl(pick);
    }

    cards.push({
      statement: concisePlain(item.statement, 90),
      summary,
      mark: fail ? "✗" : badge.mark,
      label: badge.label,
      fail,
      img: related,
    });
  }

  type SectionHint = {
    heading: string;
    short: string;
    kind: "intro" | "conclusion" | "body";
    images: string[];
  };

  const sectionHints: SectionHint[] = [];
  for (const s of video.report?.sections ?? []) {
    if (s.heading === "추가 검증") continue;
    const short = concisePlain(s.body || "", 170);
    if (!short) continue;
    const kind: SectionHint["kind"] =
      s.heading === "도입"
        ? "intro"
        : s.heading === "결론"
          ? "conclusion"
          : "body";
    const fromSec = [s.imageUrl, ...(s.images ?? [])].filter(
      (u): u is string => Boolean(u) && !isYoutubeThumb(u)
    );
    const fromEntries = (s.entries ?? []).flatMap((e) => {
      const fc = e.itemId ? fcMap.get(e.itemId) : undefined;
      return [
        ...normalizeImageUrls(e.answerImageUrl, e.answerImageUrls),
        ...(e.answerParts ?? []).flatMap((p) => p.imageUrls ?? []),
        ...normalizeImageUrls(fc?.answerImageUrl, fc?.answerImageUrls),
        ...(fc?.answerParts ?? []).flatMap((p) => p.imageUrls ?? []),
      ].filter((u) => !isYoutubeThumb(u));
    });
    const images = Array.from(new Set([...fromSec, ...fromEntries]));
    sectionHints.push({ heading: s.heading, short, kind, images });
  }

  const intro = sectionHints.filter((s) => s.kind === "intro");
  const bodySecs = sectionHints.filter((s) => s.kind === "body");
  const conclusions = sectionHints.filter((s) => s.kind === "conclusion");

  // 도입↔내용 사이에 넣을 관련 이미지 (소주제·FC 이미지)
  const bridgeImages: string[] = [];
  const seenBridge = new Set<string>();
  for (const s of [...bodySecs, ...conclusions, ...intro]) {
    for (const u of s.images) {
      if (seenBridge.has(u)) continue;
      seenBridge.add(u);
      bridgeImages.push(u);
      if (bridgeImages.length >= 6) break;
    }
    if (bridgeImages.length >= 6) break;
  }
  const bridgeDataUrls = (
    await Promise.all(bridgeImages.map((u) => fetchImageDataUrl(u)))
  ).filter((u): u is string => Boolean(u));

  const highlights = cards.map((c) => ({
    label: c.fail ? "검증 ✗" : "검증",
    short:
      c.statement.slice(0, 60) + (c.statement.length > 60 ? "…" : ""),
  }));

  const titleLines = wrapSvgText(video.title, 700, 14);
  const channel = escapeXml(video.channel);
  const typeLabel = escapeXml(REPORT_TYPE_LABELS[video.reportType]);

  const verified = video.factChecks.filter(
    (f) => f.explanation.trim() && !/^다음 주장을/.test(f.explanation)
  ).length;
  const failed = video.factChecks.filter((f) =>
    isFailedVerdict(f.verdict)
  ).length;

  const W = 800;
  const padX = 40;
  const contentW = W - padX * 2;
  const heroH = hero ? 188 : 0;
  const titleBlockH = 52 + Math.max(1, Math.min(titleLines.length, 3)) * 18;
  const heroTop = 20 + titleBlockH;
  const statsY = hero ? heroTop + heroH + 20 : 20 + titleBlockH;

  let y = statsY + 64;
  const blocks: string[] = [];

  const sectionHeader = (label: string, step: string) => {
    const top = y;
    blocks.push(`
    <g>
      <circle cx="${padX + 12}" cy="${top + 2}" r="12" fill="#c45c26"/>
      <text x="${padX + 12}" y="${top + 6}" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">${step}</text>
      <text x="${padX + 32}" y="${top + 6}" font-size="15" font-weight="700" fill="#1a2430">${escapeXml(label)}</text>
      <line x1="${padX + 32}" y1="${top + 16}" x2="${padX + contentW}" y2="${top + 16}" stroke="#e2e8f0" stroke-width="1"/>
    </g>`);
    y += 34;
  };

  /** 간결 카드 — 사용자 참고 이미지 스타일(좌측 오렌지 바 + 배지) */
  const renderConciseCard = async (
    heading: string,
    short: string,
    imageUrls: string[] = []
  ) => {
    const lines = wrapSvgText(short, contentW - 44, 13);
    const bodyH = textBlockHeight(lines, 20, 10);
    const imgs = (
      await Promise.all(
        imageUrls.slice(0, 3).map((u) => fetchImageDataUrl(u))
      )
    ).filter((u): u is string => Boolean(u));
    const imgRowH = imgs.length ? 110 : 0;
    const padTop = 36;
    const padBot = 16;
    const gap = imgs.length ? 12 : 0;
    const hgt = padTop + bodyH + gap + imgRowH + padBot;
    const top = y;
    const body = renderLines(
      lines,
      padX + 22,
      top + padTop,
      20,
      `font-size="13" fill="#3a4a5c"`
    );

    let imgSvg = "";
    if (imgs.length) {
      const slotW = (contentW - 44 - (imgs.length - 1) * 10) / imgs.length;
      const iy = top + padTop + bodyH + gap;
      imgs.forEach((dataUrl, ii) => {
        const ix = padX + 22 + ii * (slotW + 10);
        const clip = `ic${y}_${ii}`;
        imgSvg += `
        <clipPath id="${clip}"><rect x="${ix}" y="${iy}" width="${slotW}" height="${imgRowH}" rx="10"/></clipPath>
        <image href="${dataUrl}" xlink:href="${dataUrl}" x="${ix}" y="${iy}" width="${slotW}" height="${imgRowH}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clip})"/>
        <rect x="${ix}" y="${iy}" width="${slotW}" height="${imgRowH}" rx="10" fill="none" stroke="#d0d9e2"/>`;
      });
    }

    blocks.push(`
      <g>
        <rect x="${padX}" y="${top}" width="${contentW}" height="${hgt}" rx="14" fill="#ffffff" stroke="#e5ebf0"/>
        <rect x="${padX}" y="${top}" width="6" height="${hgt}" rx="3" fill="#c45c26"/>
        <rect x="${padX + 18}" y="${top + 12}" width="${Math.max(48, heading.length * 14 + 20)}" height="22" rx="6" fill="#fff4ee"/>
        <text x="${padX + 28}" y="${top + 27}" font-size="12" font-weight="700" fill="#c45c26">${escapeXml(heading)}</text>
        ${body.svg}
        ${imgSvg}
      </g>`);
    y += hgt + 14;
  };

  // 1) 도입 → (관련 이미지 브릿지) → 내용(소주제·결론)
  if (intro.length || bodySecs.length || conclusions.length) {
    sectionHeader("보고서 요약", "1");

    for (const h of intro) {
      await renderConciseCard(h.heading, h.short);
    }

    // 도입과 내용 사이: 관련 이미지 갤러리 + 짧은 안내
    if (bridgeDataUrls.length) {
      const top = y;
      const cols = Math.min(3, bridgeDataUrls.length);
      const rows = Math.ceil(bridgeDataUrls.length / cols);
      const gap = 10;
      const slotW = (contentW - 32 - (cols - 1) * gap) / cols;
      const slotH = 100;
      const labelH = 28;
      const hgt = labelH + 12 + rows * slotH + (rows - 1) * gap + 16;
      let gallery = "";
      bridgeDataUrls.forEach((dataUrl, ii) => {
        const col = ii % cols;
        const row = Math.floor(ii / cols);
        const ix = padX + 16 + col * (slotW + gap);
        const iy = top + labelH + 8 + row * (slotH + gap);
        const clip = `br${ii}`;
        gallery += `
        <clipPath id="${clip}"><rect x="${ix}" y="${iy}" width="${slotW}" height="${slotH}" rx="10"/></clipPath>
        <image href="${dataUrl}" xlink:href="${dataUrl}" x="${ix}" y="${iy}" width="${slotW}" height="${slotH}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clip})"/>
        <rect x="${ix}" y="${iy}" width="${slotW}" height="${slotH}" rx="10" fill="none" stroke="#d0d9e2"/>`;
      });
      blocks.push(`
      <g>
        <rect x="${padX}" y="${top}" width="${contentW}" height="${hgt}" rx="14" fill="#ffffff" stroke="#e5ebf0"/>
        <rect x="${padX}" y="${top}" width="6" height="${hgt}" rx="3" fill="#c45c26"/>
        <text x="${padX + 22}" y="${top + 22}" font-size="12" font-weight="700" fill="#c45c26">관련 이미지</text>
        ${gallery}
      </g>`);
      y += hgt + 14;
    }

    for (const h of [...bodySecs, ...conclusions]) {
      await renderConciseCard(h.heading, h.short, h.images.slice(0, 2));
    }
    y += 6;
  }

  // 2) 팩트체크 항목 (간결 + 관련 이미지)
  sectionHeader("팩트체크 항목", intro.length || bodySecs.length || conclusions.length ? "2" : "1");

  cards.forEach((c, i) => {
    const hasImg = Boolean(c.img);
    const imgW = hasImg ? 160 : 0;
    const imgGap = hasImg ? 20 : 0;
    const textW = contentW - 52 - imgW - imgGap;
    const stmtLines = wrapSvgText(c.statement, textW, 13.5);
    const sumLines = wrapSvgText(c.summary, textW, 12);
    const stmtH = textBlockHeight(stmtLines, 20);
    const sumH = textBlockHeight(sumLines, 18, 10);
    const topPad = 16;
    const gap = 12;
    const padBot = 20;
    const labelRow = 26;
    const textBlock =
      topPad + labelRow + stmtH + gap + sumH + padBot;
    const imgH = hasImg ? 112 : 0;
    const blockH = Math.max(textBlock, hasImg ? imgH + 32 : 0, 96);
    const top = y;
    const idx = String(i + 1).padStart(2, "0");
    const accent = c.fail ? "#c03030" : "#2d6a3e";
    const soft = c.fail ? "#fde8e8" : "#e8f5ec";
    const labelW = Math.min(120, 16 + c.label.length * 11);
    const stmtY = top + topPad + labelRow + 2;

    let imgBlock = "";
    if (c.img) {
      const ix = padX + contentW - imgW - 14;
      imgBlock = `
      <clipPath id="rc${i}"><rect x="${ix}" y="${top + 14}" width="${imgW}" height="${imgH}" rx="10"/></clipPath>
      <image href="${c.img}" xlink:href="${c.img}" x="${ix}" y="${top + 14}" width="${imgW}" height="${imgH}" preserveAspectRatio="xMidYMid slice" clip-path="url(#rc${i})"/>
      <rect x="${ix}" y="${top + 14}" width="${imgW}" height="${imgH}" rx="10" fill="none" stroke="#d0d9e2"/>`;
    }

    const stmt = renderLines(
      stmtLines,
      padX + 44,
      stmtY,
      20,
      `font-size="13.5" font-weight="700" fill="#1a2430"`
    );
    const sum = renderLines(
      sumLines,
      padX + 44,
      stmtY + stmtH + gap,
      18,
      `font-size="12" fill="#4a5d70"`
    );

    blocks.push(`
    <g>
      <rect x="${padX}" y="${top}" width="${contentW}" height="${blockH}" rx="14" fill="#ffffff" stroke="${c.fail ? "#f0b4b4" : "#e2e8f0"}"/>
      <circle cx="${padX + 26}" cy="${top + topPad + 10}" r="11" fill="${soft}"/>
      <text x="${padX + 26}" y="${top + topPad + 14}" text-anchor="middle" font-size="12" font-weight="700" fill="${accent}">${escapeXml(c.mark)}</text>
      <text x="${padX + 44}" y="${top + topPad + 14}" font-size="11" font-weight="700" fill="#9aabbc">${idx}</text>
      <rect x="${padX + 68}" y="${top + topPad - 2}" width="${labelW}" height="22" rx="11" fill="${soft}"/>
      <text x="${padX + 68 + labelW / 2}" y="${top + topPad + 13}" text-anchor="middle" font-size="11" font-weight="600" fill="${accent}">${escapeXml(c.label)}</text>
      ${stmt.svg}
      ${sum.svg}
      ${imgBlock}
    </g>`);
    y += blockH + 14;
  });

  if (!cards.length) {
    blocks.push(
      `<text x="${padX}" y="${y}" font-size="13" fill="#7890a8">팩트체크 항목이 없습니다.</text>`
    );
    y += 28;
  }

  const height = Math.max(520, y + 48);
  const displayTitle = titleLines.slice(0, 3);
  const titleSvg = displayTitle
    .map(
      (line, li) =>
        `<text x="${padX}" y="${58 + li * 18}" font-size="14" fill="#425870">${escapeXml(line)}</text>`
    )
    .join("\n");
  const metaY = 58 + displayTitle.length * 18 + 4;

  const svgMarkup = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#f8f9fb"/>
      <stop offset="100%" stop-color="#eef2f6"/>
    </linearGradient>
    ${
      hero
        ? `<clipPath id="heroClip"><rect x="${padX}" y="${heroTop}" width="${contentW}" height="${heroH}" rx="16"/></clipPath>`
        : ""
    }
  </defs>
  <rect width="${W}" height="${height}" fill="url(#bg)"/>
  <rect x="0" y="0" width="${W}" height="5" fill="#c45c26"/>

  <g font-family="${FONT}">
    <text x="${padX}" y="36" font-size="22" font-weight="700" fill="#1a2430">팩트체크 인포그래픽</text>
    ${titleSvg}
    <text x="${padX}" y="${metaY}" font-size="11" fill="#7890a8">${channel} · ${typeLabel}</text>

    ${
      hero
        ? `<image href="${hero}" xlink:href="${hero}" x="${padX}" y="${heroTop}" width="${contentW}" height="${heroH}" preserveAspectRatio="xMidYMid slice" clip-path="url(#heroClip)"/>
    <rect x="${padX}" y="${heroTop}" width="${contentW}" height="${heroH}" rx="16" fill="none" stroke="#d0d9e2"/>`
        : ""
    }

    <rect x="${padX}" y="${statsY}" width="228" height="52" rx="12" fill="#1a2430"/>
    <text x="${padX + 18}" y="${statsY + 21}" font-size="11" fill="#a8b8c8">검증 완료</text>
    <text x="${padX + 18}" y="${statsY + 41}" font-size="20" font-weight="700" fill="#fff">${verified}</text>

    <rect x="${padX + 240}" y="${statsY}" width="228" height="52" rx="12" fill="#c03030"/>
    <text x="${padX + 258}" y="${statsY + 21}" font-size="11" fill="#fde8e8">사실과 다름 ✗</text>
    <text x="${padX + 258}" y="${statsY + 41}" font-size="20" font-weight="700" fill="#fff">${failed}</text>

    <rect x="${padX + 480}" y="${statsY}" width="${contentW - 480}" height="52" rx="12" fill="#354858"/>
    <text x="${padX + 498}" y="${statsY + 21}" font-size="11" fill="#a8b8c8">팩트체크 대상</text>
    <text x="${padX + 498}" y="${statsY + 41}" font-size="20" font-weight="700" fill="#fff">${fcItems.length}</text>

    ${blocks.join("\n")}
  </g>

  <rect x="0" y="${height - 5}" width="${W}" height="5" fill="#c45c26"/>
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
    sectionHints: sectionHints.map((s) => ({
      heading: s.heading,
      short: s.short,
    })),
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
