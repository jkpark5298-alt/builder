import type { InfographicData, VideoRecord } from "./types";
import { REPORT_TYPE_LABELS } from "./types";
import { isFailedVerdict, verdictBadge } from "./text-format";
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

function ytFrameUrls(videoId: string): string[] {
  return [
    ...youtubeThumbCandidates(videoId),
    `https://i.ytimg.com/vi/${videoId}/hq1.jpg`,
    `https://i.ytimg.com/vi/${videoId}/hq2.jpg`,
    `https://i.ytimg.com/vi/${videoId}/hq3.jpg`,
    `https://i.ytimg.com/vi/${videoId}/1.jpg`,
    `https://i.ytimg.com/vi/${videoId}/2.jpg`,
    `https://i.ytimg.com/vi/${videoId}/3.jpg`,
  ];
}

async function resolveDistinctImages(
  video: VideoRecord,
  count: number
): Promise<string[]> {
  const urls: string[] = [];
  const seen = new Set<string>();

  const push = async (url?: string) => {
    if (!url || seen.has(url)) return;
    const data = await fetchImageDataUrl(url);
    if (!data || seen.has(data.slice(0, 80))) return;
    seen.add(url);
    seen.add(data.slice(0, 80));
    urls.push(data);
  };

  await push(video.thumbnailUrl);
  for (const u of ytFrameUrls(video.videoId)) {
    if (urls.length >= count) break;
    await push(u);
  }

  for (const item of video.items.filter((i) => i.needsFactCheck)) {
    if (urls.length >= count) break;
    await push(item.imageUrl);
  }

  for (const fc of video.factChecks) {
    if (urls.length >= count) break;
    await push(fc.answerImageUrl);
  }

  while (urls.length < count && urls.length > 0) {
    urls.push(urls[urls.length % Math.max(1, urls.length - 1)] ?? urls[0]);
  }

  return urls.slice(0, count);
}

export async function buildInfographic(
  video: VideoRecord
): Promise<InfographicData> {
  const fcMap = new Map(video.factChecks.map((f) => [f.itemId, f]));
  const fcItems = video.items.filter((i) => i.needsFactCheck).slice(0, 5);

  const cards = fcItems.map((item) => {
    const fc = fcMap.get(item.id);
    const verdict = fc?.verdict ?? "pending";
    const badge = verdictBadge(verdict);
    const fail = isFailedVerdict(verdict);
    const answer = fc?.explanation?.trim() ?? "";
    const isPrompt = !answer || /^다음 주장을/.test(answer);
    return {
      item,
      statement: item.statement,
      summary: isPrompt
        ? item.statement.slice(0, 72)
        : answer.slice(0, 100) + (answer.length > 100 ? "…" : ""),
      verdict,
      mark: fail ? "✗" : badge.mark,
      fail,
      imageHint: item.imageUrl ?? fc?.answerImageUrl,
    };
  });

  const images = await resolveDistinctImages(video, Math.max(3, cards.length));
  cards.forEach((c, i) => {
    (c as { img?: string }).img = images[i] ?? images[0];
  });

  const sectionHints =
    video.report?.sections.map((s) => ({
      heading: s.heading,
      short:
        s.body.slice(0, 80) + (s.body.length > 80 ? "…" : "") ||
        s.entries?.[0]?.text.slice(0, 80) ||
        "",
    })) ?? [];

  const highlights = cards.map((c) => ({
    label: c.fail ? "검증 ✗" : "검증",
    short: c.statement.slice(0, 60) + (c.statement.length > 60 ? "…" : ""),
  }));

  const title = escapeXml(video.title.slice(0, 52));
  const channel = escapeXml(video.channel);
  const typeLabel = escapeXml(REPORT_TYPE_LABELS[video.reportType]);
  const hero = images[0];

  const cardW = 148;
  const cardH = 200;
  const gap = 12;
  const cardsY = 248;
  const cardRow = cards
    .map((c, i) => {
      const x = 48 + i * (cardW + gap);
      const img = (c as { img?: string }).img ?? hero;
      const fill = c.fail ? "#fde8e8" : "#eef6ef";
      const stroke = c.fail ? "#e05555" : "#3d8b5a";
      return `
    <g>
      <rect x="${x}" y="${cardsY}" width="${cardW}" height="${cardH}" rx="10" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>
      ${
        img
          ? `<clipPath id="clip${i}"><rect x="${x + 4}" y="${cardsY + 4}" width="${cardW - 8}" height="78" rx="6"/></clipPath>
      <image href="${img}" xlink:href="${img}" x="${x + 4}" y="${cardsY + 4}" width="${cardW - 8}" height="78" preserveAspectRatio="xMidYMid slice" clip-path="url(#clip${i})"/>`
          : `<rect x="${x + 4}" y="${cardsY + 4}" width="${cardW - 8}" height="78" rx="6" fill="#dce3ea"/>`
      }
      <text x="${x + 10}" y="${cardsY + 98}" font-size="18" font-weight="bold" fill="${c.fail ? "#c03030" : "#2d6a3e"}">${escapeXml(c.mark)}</text>
      <text x="${x + 32}" y="${cardsY + 98}" font-size="10" fill="#567088">${escapeXml(c.statement.slice(0, 14))}${c.statement.length > 14 ? "…" : ""}</text>
      <text x="${x + 10}" y="${cardsY + 118}" font-size="9" fill="#1a2430">${escapeXml(c.summary.slice(0, 48))}${c.summary.length > 48 ? "…" : ""}</text>
    </g>`;
    })
    .join("");

  const rowsY = cardsY + cardH + 36;
  const rowH = 44;
  const rowSource = (sectionHints.length ? sectionHints : highlights.map((h) => ({
    heading: h.label,
    short: h.short,
  })));
  const rows = rowSource.map((h, i) => {
    const y = rowsY + i * rowH;
    return `
      <rect x="48" y="${y}" width="704" height="36" rx="8" fill="#ffffff" stroke="#d0d9e2"/>
      <rect x="48" y="${y}" width="6" height="36" rx="2" fill="#c45c26"/>
      <text x="64" y="${y + 14}" font-size="11" fill="#567088">${escapeXml(h.heading)}</text>
      <text x="64" y="${y + 28}" font-size="10" fill="#1a2430">${escapeXml(h.short)}</text>`;
  });

  const verified = video.factChecks.filter(
    (f) => f.explanation.trim() && !/^다음 주장을/.test(f.explanation)
  ).length;
  const failed = video.factChecks.filter((f) =>
    isFailedVerdict(f.verdict)
  ).length;

  const height = Math.max(420, rowsY + rows.length * rowH + 48);

  const svgMarkup = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="800" height="${height}" viewBox="0 0 800 ${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f4f6f8"/>
      <stop offset="100%" stop-color="#e8ecf0"/>
    </linearGradient>
    ${
      hero
        ? `<clipPath id="heroClip"><rect x="48" y="36" width="280" height="158" rx="12"/></clipPath>`
        : ""
    }
  </defs>
  <rect width="800" height="100%" fill="url(#bg)"/>
  <rect x="0" y="0" width="800" height="8" fill="#c45c26"/>
  ${
    hero
      ? `<image href="${hero}" xlink:href="${hero}" x="48" y="36" width="280" height="158" preserveAspectRatio="xMidYMid slice" clip-path="url(#heroClip)"/>
  <rect x="48" y="36" width="280" height="158" rx="12" fill="none" stroke="#d0d9e2"/>`
      : ""
  }
  <text x="${hero ? 348 : 48}" y="56" font-family="Malgun Gothic, Apple SD Gothic Neo, NanumGothic, sans-serif" font-size="22" fill="#1a2430">팩트체크 인포그래픽</text>
  <text x="${hero ? 348 : 48}" y="84" font-family="Malgun Gothic, Apple SD Gothic Neo, NanumGothic, sans-serif" font-size="13" fill="#425870">${title}</text>
  <text x="${hero ? 348 : 48}" y="106" font-family="Malgun Gothic, Apple SD Gothic Neo, NanumGothic, sans-serif" font-size="11" fill="#7890a8">${channel} · ${typeLabel}</text>

  <g font-family="Malgun Gothic, Apple SD Gothic Neo, NanumGothic, sans-serif">
    <rect x="48" y="206" width="120" height="44" rx="8" fill="#1a2430"/>
    <text x="60" y="224" font-size="10" fill="#a8b8c8">검증 완료</text>
    <text x="60" y="242" font-size="16" fill="#fff">${verified}</text>

    <rect x="178" y="206" width="120" height="44" rx="8" fill="#c03030"/>
    <text x="190" y="224" font-size="10" fill="#fde8e8">사실과 다름 ✗</text>
    <text x="190" y="242" font-size="16" fill="#fff">${failed}</text>

    <rect x="308" y="206" width="120" height="44" rx="8" fill="#354858"/>
    <text x="320" y="224" font-size="10" fill="#a8b8c8">대상</text>
    <text x="320" y="242" font-size="16" fill="#fff">${fcItems.length}</text>
  </g>

  <text x="48" y="${cardsY - 8}" font-size="12" fill="#567088">팩트체크 항목 · 보고서 요약</text>
  ${cardRow}
  ${rows.join("")}
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
