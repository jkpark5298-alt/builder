import type { InfographicData, VideoRecord } from "./types";
import { REPORT_TYPE_LABELS } from "./types";
import { youtubeThumbCandidates } from "./youtube";

const imageCache = new Map<string, string | null>();

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
    // YouTube maxres 미제공 시 회색 자리표시자(~1–2KB)가 옴
    if (buf.length < 4_000) {
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

async function resolveYoutubeThumb(videoId: string, preferred?: string) {
  const urls = [
    ...(preferred ? [preferred] : []),
    ...youtubeThumbCandidates(videoId),
  ];
  for (const url of urls) {
    const data = await fetchImageDataUrl(url);
    if (data) return data;
  }
  return null;
}

export async function buildInfographic(
  video: VideoRecord
): Promise<InfographicData> {
  const claims = video.items.filter((i) => i.type === "claim").length;
  const opinions = video.items.filter((i) => i.type === "opinion").length;
  const info = video.items.filter((i) => i.type === "info").length;
  const verified = video.factChecks.filter((f) =>
    f.explanation.trim()
  ).length;

  const highlights = (video.summaryBullets?.length
    ? video.summaryBullets
    : video.items.map((i) => i.statement)
  )
    .slice(0, 5)
    .map((text) => ({
      label: "요약",
      short: text.slice(0, 80) + (text.length > 80 ? "…" : ""),
    }));

  const sectionHints = (video.report?.sections ?? []).map((s) => ({
    heading: s.heading,
    short: s.body.slice(0, 70) + (s.body.length > 70 ? "…" : ""),
  }));

  const heroThumb = await resolveYoutubeThumb(
    video.videoId,
    video.thumbnailUrl
  );

  const factItems = video.items.filter((i) => i.needsFactCheck).slice(0, 4);
  const itemImages = await Promise.all(
    factItems.map(async (item) => {
      if (item.imageUrl?.startsWith("data:") || item.imageUrl?.startsWith("http")) {
        const data = await fetchImageDataUrl(item.imageUrl);
        if (data) return { item, dataUrl: data };
      }
      return {
        item,
        dataUrl: heroThumb,
      };
    })
  );

  const title = escapeXml(video.title.slice(0, 56));
  const channel = escapeXml(video.channel);
  const typeLabel = escapeXml(REPORT_TYPE_LABELS[video.reportType]);

  const hasHero = Boolean(heroThumb);
  const heroBlock = hasHero
    ? `
  <defs>
    <clipPath id="heroClip">
      <rect x="48" y="36" width="340" height="191" rx="14"/>
    </clipPath>
  </defs>
  <image href="${heroThumb}" xlink:href="${heroThumb}" x="48" y="36" width="340" height="191" preserveAspectRatio="xMidYMid slice" clip-path="url(#heroClip)"/>
  <rect x="48" y="36" width="340" height="191" rx="14" fill="none" stroke="#d0d9e2"/>
  <text x="412" y="64" font-family="Malgun Gothic, Apple SD Gothic Neo, NanumGothic, sans-serif" font-size="22" fill="#1a2430">인포그래픽 보고서</text>
  <text x="412" y="94" font-family="Malgun Gothic, Apple SD Gothic Neo, NanumGothic, sans-serif" font-size="14" fill="#425870">${title}</text>
  <text x="412" y="118" font-family="Malgun Gothic, Apple SD Gothic Neo, NanumGothic, sans-serif" font-size="12" fill="#7890a8">${channel} · ${typeLabel}</text>
  <a href="${escapeXml(video.youtubeUrl)}">
    <text x="412" y="148" font-family="Malgun Gothic, Apple SD Gothic Neo, NanumGothic, sans-serif" font-size="11" fill="#c45c26">유튜브에서 보기 →</text>
  </a>`
    : `
  <text x="48" y="48" font-family="Malgun Gothic, Apple SD Gothic Neo, NanumGothic, sans-serif" font-size="26" fill="#1a2430">인포그래픽 보고서</text>
  <text x="48" y="76" font-family="Malgun Gothic, Apple SD Gothic Neo, NanumGothic, sans-serif" font-size="15" fill="#425870">${title}</text>
  <text x="48" y="98" font-family="Malgun Gothic, Apple SD Gothic Neo, NanumGothic, sans-serif" font-size="12" fill="#7890a8">${channel} · ${typeLabel}</text>`;

  const statsY = hasHero ? 250 : 120;
  const imageRowY = statsY + 72;
  const hasItemImages = itemImages.some((x) => x.dataUrl);
  const cards = hasItemImages
    ? itemImages
        .map(({ item, dataUrl }, i) => {
          const x = 48 + (i % 4) * 184;
          const label = escapeXml(
            item.statement.slice(0, 28) +
              (item.statement.length > 28 ? "…" : "")
          );
          const img = dataUrl
            ? `<image href="${dataUrl}" xlink:href="${dataUrl}" x="${x}" y="${imageRowY}" width="168" height="94" preserveAspectRatio="xMidYMid slice"/>`
            : `<rect x="${x}" y="${imageRowY}" width="168" height="94" fill="#dce3ea"/>`;
          return `
      <g>
        ${img}
        <rect x="${x}" y="${imageRowY}" width="168" height="94" fill="none" stroke="#c8d2dc" rx="8"/>
        <rect x="${x}" y="${imageRowY + 94}" width="168" height="40" rx="0" fill="#fff"/>
        <text x="${x + 8}" y="${imageRowY + 118}" font-size="11" fill="#1a2430">${label}</text>
      </g>`;
        })
        .join("")
    : "";

  const rowsBase = hasItemImages ? imageRowY + 150 : statsY + 72;
  const rowH = 48;
  const rowSource = sectionHints.length
    ? sectionHints
    : highlights.map((h) => ({ heading: h.label, short: h.short }));
  const rows = rowSource
    .map((h, i) => {
      const y = rowsBase + i * rowH;
      return `
      <rect x="48" y="${y}" width="704" height="40" rx="8" fill="#ffffff" stroke="#d0d9e2"/>
      <rect x="48" y="${y}" width="8" height="40" rx="2" fill="#c45c26"/>
      <text x="72" y="${y + 16}" font-size="12" fill="#567088">${escapeXml(h.heading)}</text>
      <text x="72" y="${y + 34}" font-size="13" fill="#1a2430">${escapeXml(h.short)}</text>`;
    })
    .join("");

  const height = Math.max(
    320,
    rowsBase + rowSource.length * rowH + 48
  );

  const svgMarkup = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="800" height="${height}" viewBox="0 0 800 ${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f4f6f8"/>
      <stop offset="100%" stop-color="#e8ecf0"/>
    </linearGradient>
  </defs>
  <rect width="800" height="100%" fill="url(#bg)"/>
  <rect x="0" y="0" width="800" height="8" fill="#c45c26"/>
  ${heroBlock}

  <g font-family="Malgun Gothic, Apple SD Gothic Neo, NanumGothic, sans-serif">
    <rect x="48" y="${statsY}" width="160" height="52" rx="10" fill="#1a2430"/>
    <text x="64" y="${statsY + 22}" font-size="11" fill="#a8b8c8">요약 포인트</text>
    <text x="64" y="${statsY + 42}" font-size="20" fill="#fff">${highlights.length}</text>

    <rect x="224" y="${statsY}" width="160" height="52" rx="10" fill="#354858"/>
    <text x="240" y="${statsY + 22}" font-size="11" fill="#a8b8c8">검증 항목</text>
    <text x="240" y="${statsY + 42}" font-size="20" fill="#fff">${claims + info}</text>

    <rect x="400" y="${statsY}" width="160" height="52" rx="10" fill="#425870"/>
    <text x="416" y="${statsY + 22}" font-size="11" fill="#a8b8c8">가이드</text>
    <text x="416" y="${statsY + 42}" font-size="20" fill="#fff">${verified}</text>

    <rect x="576" y="${statsY}" width="176" height="52" rx="10" fill="#c45c26"/>
    <text x="592" y="${statsY + 22}" font-size="11" fill="#f5e6dc">보고서 유형</text>
    <text x="592" y="${statsY + 42}" font-size="18" fill="#fff">${escapeXml(video.reportType)}</text>
  </g>
  ${
    hasItemImages
      ? `<text x="48" y="${imageRowY - 12}" font-family="Malgun Gothic, Apple SD Gothic Neo, NanumGothic, sans-serif" font-size="13" fill="#567088">팩트체크 장면 · 유튜브 이미지</text>`
      : ""
  }
  ${cards}
  ${rows}
</svg>`;

  return {
    title: video.title,
    channel: video.channel,
    reportType: video.reportType,
    stats: { claims, opinions, info, verified },
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
