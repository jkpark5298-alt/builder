import type { InfographicData, VideoRecord } from "./types";
import { REPORT_TYPE_LABELS } from "./types";

export function buildInfographic(video: VideoRecord): InfographicData {
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

  const title = escapeXml(video.title.slice(0, 48));
  const channel = escapeXml(video.channel);
  const typeLabel = escapeXml(REPORT_TYPE_LABELS[video.reportType]);
  const baseY = 200;
  const rowH = 48;
  const rows = (sectionHints.length ? sectionHints : highlights.map((h) => ({
    heading: h.label,
    short: h.short,
  })))
    .map((h, i) => {
      const y = baseY + i * rowH;
      return `
      <rect x="48" y="${y}" width="704" height="40" rx="8" fill="#ffffff" stroke="#d0d9e2"/>
      <rect x="48" y="${y}" width="8" height="40" rx="2" fill="#c45c26"/>
      <text x="72" y="${y + 16}" font-size="12" fill="#567088">${escapeXml(h.heading)}</text>
      <text x="72" y="${y + 34}" font-size="13" fill="#1a2430">${escapeXml(h.short)}</text>`;
    })
    .join("");

  const height = Math.max(280, baseY + (sectionHints.length || highlights.length) * rowH + 40);

  const svgMarkup = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="${height}" viewBox="0 0 800 ${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f4f6f8"/>
      <stop offset="100%" stop-color="#e8ecf0"/>
    </linearGradient>
  </defs>
  <rect width="800" height="100%" fill="url(#bg)"/>
  <rect x="0" y="0" width="800" height="8" fill="#c45c26"/>
  <text x="48" y="48" font-family="Georgia, serif" font-size="26" fill="#1a2430">Report Infographic</text>
  <text x="48" y="76" font-family="system-ui,sans-serif" font-size="15" fill="#425870">${title}</text>
  <text x="48" y="98" font-family="system-ui,sans-serif" font-size="12" fill="#7890a8">${channel} · ${typeLabel}</text>

  <g font-family="system-ui,sans-serif">
    <rect x="48" y="120" width="160" height="52" rx="10" fill="#1a2430"/>
    <text x="64" y="142" font-size="11" fill="#a8b8c8">요약 포인트</text>
    <text x="64" y="162" font-size="20" fill="#fff">${highlights.length}</text>

    <rect x="224" y="120" width="160" height="52" rx="10" fill="#354858"/>
    <text x="240" y="142" font-size="11" fill="#a8b8c8">검증 항목</text>
    <text x="240" y="162" font-size="20" fill="#fff">${claims + info}</text>

    <rect x="400" y="120" width="160" height="52" rx="10" fill="#425870"/>
    <text x="416" y="142" font-size="11" fill="#a8b8c8">가이드</text>
    <text x="416" y="162" font-size="20" fill="#fff">${verified}</text>

    <rect x="576" y="120" width="176" height="52" rx="10" fill="#c45c26"/>
    <text x="592" y="142" font-size="11" fill="#f5e6dc">보고서 유형</text>
    <text x="592" y="162" font-size="18" fill="#fff">${escapeXml(video.reportType)}</text>
  </g>
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
