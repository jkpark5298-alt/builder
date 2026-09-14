import { reportBodyPlain, exportableReportSections } from "./report";
import {
  orderedSlotUrls,
  sectionSlotCapacity,
} from "./report-images";
import { parseBodySImageSlots } from "./report-body-s-slots";
import {
  bodyUsesInlineRichImages,
  splitPreparedBodyParts,
} from "./report-inline-images";
import { organizeUrlArticleText } from "./url-article-report";
import type { TypedReport } from "./types";

export type ReaderBlock =
  | { type: "h"; text: string; html?: string }
  | { type: "p"; text: string; html?: string }
  | { type: "img"; src: string; alt?: string };

export type ReaderDoc = {
  title: string;
  source?: string;
  url?: string;
  blocks: ReaderBlock[];
};

/** 읽기 도구·PDF 공통 본문 타이포 (기본 19px) */
export const READER_PDF_FONT_PX = 19;
export const READER_PDF_LINE_HEIGHT = 1.85;
export const READER_PDF_FONT_FAMILY =
  'ui-serif, "Iowan Old Style", "Apple SD Gothic Neo", "Noto Serif KR", "Nanum Myeongjo", Georgia, serif';

const READER_ALLOWED_TAGS = new Set([
  "P",
  "BR",
  "STRONG",
  "B",
  "EM",
  "I",
  "U",
  "S",
  "STRIKE",
  "MARK",
  "SPAN",
  "A",
  "UL",
  "OL",
  "LI",
]);

const READER_STYLE_PROPS = new Set([
  "color",
  "background-color",
  "background",
  "font-size",
  "font-weight",
  "text-decoration",
]);

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sanitizeStyle(style: string): string {
  const parts: string[] = [];
  for (const raw of style.split(";")) {
    const idx = raw.indexOf(":");
    if (idx < 0) continue;
    const prop = raw.slice(0, idx).trim().toLowerCase();
    const val = raw.slice(idx + 1).trim();
    if (!READER_STYLE_PROPS.has(prop) || !val) continue;
    if (/expression|url\s*\(|javascript:/i.test(val)) continue;
    parts.push(`${prop}: ${val}`);
  }
  return parts.join("; ");
}

/**
 * 읽기 도구·PDF용 — 형광(mark)·글자색·굵게 등만 남기고 위험 태그 제거
 */
export function sanitizeReaderHtml(html: string): string {
  const raw = (html || "").trim();
  if (!raw) return "";
  if (typeof DOMParser === "undefined") {
    return escapeHtml(reportBodyPlain(raw, true));
  }

  const doc = new DOMParser().parseFromString(
    `<div id="reader-sanitize-root">${raw}</div>`,
    "text/html"
  );
  const root = doc.getElementById("reader-sanitize-root");
  if (!root) return escapeHtml(reportBodyPlain(raw, true));

  const walk = (node: Node) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const children = Array.from(el.childNodes);
    for (const child of children) walk(child);

    if (!READER_ALLOWED_TAGS.has(el.tagName)) {
      const frag = doc.createDocumentFragment();
      while (el.firstChild) frag.appendChild(el.firstChild);
      el.replaceWith(frag);
      return;
    }

    const keepAttrs: Array<{ name: string; value: string }> = [];
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name === "style") {
        const st = sanitizeStyle(attr.value);
        if (st) keepAttrs.push({ name: "style", value: st });
        continue;
      }
      if (el.tagName === "MARK" && name === "data-color") {
        keepAttrs.push({ name: "data-color", value: attr.value });
        continue;
      }
      if (el.tagName === "A" && name === "href") {
        const href = attr.value.trim();
        if (/^https?:\/\//i.test(href) || href.startsWith("/")) {
          keepAttrs.push({ name: "href", value: href });
          keepAttrs.push({ name: "target", value: "_blank" });
          keepAttrs.push({ name: "rel", value: "noopener noreferrer" });
        }
        continue;
      }
    }
    for (const attr of Array.from(el.attributes)) {
      el.removeAttribute(attr.name);
    }
    for (const a of keepAttrs) el.setAttribute(a.name, a.value);

    if (el.tagName === "MARK") {
      const color = el.getAttribute("data-color");
      if (color && !/background/i.test(el.getAttribute("style") || "")) {
        el.style.backgroundColor = color;
      }
    }
  };

  // 루트 div 자체는 건드리지 않음 (unwrap 하면 innerHTML 이 비게 됨)
  for (const child of Array.from(root.childNodes)) walk(child);

  const out = root.innerHTML.trim();
  if (!out) {
    const plain = reportBodyPlain(raw, true).trim();
    return plain ? escapeHtml(plain) : "";
  }
  return out;
}

function paras(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .flatMap((chunk) => chunk.split(/\n/))
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((s) => !/^[Ss]\d{0,2}\.?$/.test(s));
}

function pushParas(blocks: ReaderBlock[], text: string) {
  for (const p of paras(text)) blocks.push({ type: "p", text: p });
}

/** 서식(HTML) 유지한 채 블록으로 나눔 */
function pushRichBlocks(blocks: ReaderBlock[], html: string) {
  const cleaned = sanitizeReaderHtml(html);
  if (!cleaned.trim()) {
    pushParas(blocks, reportBodyPlain(html, true));
    return;
  }

  if (typeof DOMParser === "undefined") {
    pushParas(blocks, reportBodyPlain(cleaned, true));
    return;
  }

  const doc = new DOMParser().parseFromString(
    `<div id="reader-rich-root">${cleaned}</div>`,
    "text/html"
  );
  const root = doc.getElementById("reader-rich-root");
  if (!root) {
    pushParas(blocks, reportBodyPlain(cleaned, true));
    return;
  }

  const nodes = Array.from(root.childNodes);
  if (!nodes.length) {
    const text = (root.textContent || "").replace(/\s+/g, " ").trim();
    if (text) blocks.push({ type: "p", text, html: cleaned });
    return;
  }

  let inlineBuf = "";
  const flushInline = () => {
    const chunk = inlineBuf.trim();
    inlineBuf = "";
    if (!chunk) return;
    const text = reportBodyPlain(chunk, true).replace(/\s+/g, " ").trim();
    if (!text) return;
    blocks.push({ type: "p", text, html: sanitizeReaderHtml(chunk) });
  };

  for (const node of nodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent || "";
      if (t.trim()) inlineBuf += t;
      continue;
    }
    if (!(node instanceof HTMLElement)) continue;
    const tag = node.tagName;
    if (tag === "FIGURE" || tag === "IMG") {
      flushInline();
      continue;
    }
    if (/^H[1-6]$/.test(tag)) {
      flushInline();
      const text = (node.textContent || "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      blocks.push({
        type: "h",
        text,
        html: sanitizeReaderHtml(node.innerHTML),
      });
      continue;
    }
    if (tag === "P" || tag === "LI" || tag === "DIV") {
      flushInline();
      const text = (node.textContent || "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      blocks.push({
        type: "p",
        text,
        html: sanitizeReaderHtml(node.innerHTML),
      });
      continue;
    }
    if (tag === "UL" || tag === "OL") {
      flushInline();
      for (const li of Array.from(node.children)) {
        if (!(li instanceof HTMLElement) || li.tagName !== "LI") continue;
        const text = (li.textContent || "").replace(/\s+/g, " ").trim();
        if (!text) continue;
        blocks.push({
          type: "p",
          text,
          html: sanitizeReaderHtml(li.innerHTML),
        });
      }
      continue;
    }
    // strong/mark 등이 루트에 바로 온 경우
    inlineBuf += (node as HTMLElement).outerHTML;
  }
  flushInline();
}

/** URL 원문 + 사진 → 읽기 도구 문서 (`[이미지 N]` 자리에 사진) */
export function readerDocFromArticle(opts: {
  title: string;
  source?: string;
  url?: string;
  text: string;
  images?: string[];
}): ReaderDoc {
  const images = (opts.images ?? []).map((u) => u.trim()).filter(Boolean);
  const text = organizeUrlArticleText(opts.text, { keepImageMarkers: true });
  const blocks: ReaderBlock[] = [];
  const used = new Set<string>();
  const pieces = text.split(/\[이미지\s*(\d+)\]/g);
  for (let i = 0; i < pieces.length; i++) {
    const part = pieces[i] || "";
    if (i % 2 === 1) {
      const src = images[Number(part) - 1];
      if (src && !used.has(src)) {
        used.add(src);
        blocks.push({ type: "img", src, alt: `본문 이미지 ${part}` });
      }
      continue;
    }
    pushParas(blocks, part);
  }
  for (const src of images) {
    if (used.has(src)) continue;
    used.add(src);
    blocks.push({ type: "img", src, alt: "본문 이미지" });
  }
  return {
    title: opts.title.trim() || "본문",
    source: opts.source?.trim() || undefined,
    url: opts.url?.trim() || undefined,
    blocks,
  };
}

/** 보고서 섹션·S칸 사진 → 읽기 도구 문서 (형광·색·굵게 유지) */
export function readerDocFromReport(
  report: TypedReport,
  extraImages?: string[]
): ReaderDoc {
  const blocks: ReaderBlock[] = [];
  const used = new Set<string>();
  const sections = exportableReportSections(report.sections);
  const many = sections.length > 1;
  for (const sec of sections) {
    const headingRaw = (sec.heading || "").trim();
    const headingPlain = reportBodyPlain(headingRaw, true).trim();
    if (many && headingPlain && headingPlain !== "본문") {
      const headingHtml = sanitizeReaderHtml(
        /<[a-z]/i.test(headingRaw)
          ? headingRaw.replace(/^<p[^>]*>/i, "").replace(/<\/p>\s*$/i, "")
          : escapeHtml(headingPlain)
      );
      blocks.push({
        type: "h",
        text: headingPlain,
        html: headingHtml || undefined,
      });
    }
    const parsed = parseBodySImageSlots(sec.body || "");
    const urls = orderedSlotUrls(
      sec,
      report.imageRoom,
      sectionSlotCapacity(sec, parsed.slotCount)
    );
    let imgI = 0;
    if (bodyUsesInlineRichImages(sec.body || "")) {
      const parts = splitPreparedBodyParts(sec.body || "");
      for (const part of parts) {
        if (part.type === "html") {
          if (/<[a-z]/i.test(part.html)) {
            pushRichBlocks(blocks, part.html);
          } else {
            pushParas(blocks, reportBodyPlain(part.html, true));
          }
        } else if (part.src && !used.has(part.src)) {
          used.add(part.src);
          blocks.push({
            type: "img",
            src: part.src,
            alt: part.alt || headingPlain || "본문 이미지",
          });
        }
      }
    } else if (!parsed.segments.length) {
      const body = sec.body || "";
      if (sec.rich || /<[a-z]/i.test(body)) {
        pushRichBlocks(blocks, body);
      } else {
        pushParas(blocks, body);
      }
    } else {
      for (const seg of parsed.segments) {
        const segHtml = seg.html || "";
        if (/<[a-z]/i.test(segHtml)) {
          pushRichBlocks(blocks, segHtml);
        } else {
          pushParas(blocks, reportBodyPlain(segHtml, true));
        }
        if (seg.hasSlot) {
          const src = (urls[imgI] || "").trim();
          imgI += 1;
          if (src && !used.has(src)) {
            used.add(src);
            blocks.push({
              type: "img",
              src,
              alt: headingPlain || "본문 이미지",
            });
          }
        }
      }
    }
  }
  for (const src of extraImages ?? []) {
    const url = src.trim();
    if (!url || used.has(url)) continue;
    used.add(url);
    blocks.push({ type: "img", src: url, alt: "본문 이미지" });
  }

  // 본문이 비면 plain 으로라도 채움 (PDF 제목만 나오는 사고 방지)
  const hasText = blocks.some(
    (b) =>
      (b.type === "p" || b.type === "h") &&
      Boolean((b.text || "").trim() || (b.html || "").trim())
  );
  if (!hasText) {
    for (const sec of sections) {
      const h = reportBodyPlain(sec.heading || "", true).trim();
      if (h && h !== "본문") blocks.push({ type: "h", text: h });
      pushParas(blocks, reportBodyPlain(sec.body || "", Boolean(sec.rich)));
    }
  }

  return {
    title: report.meta.title?.trim() || "보고서",
    source: report.meta.channel?.trim() || undefined,
    url: report.meta.url?.trim() || undefined,
    blocks,
  };
}

/**
 * 읽기 도구와 같은 타이포·문단·이미지·서식의 PDF 캡처용 DOM
 */
export function buildReaderPdfCaptureElement(doc: ReaderDoc): HTMLElement {
  const root = document.createElement("article");
  root.className = "reader-pdf-doc reader-rich";
  root.style.cssText = [
    `font-family:${READER_PDF_FONT_FAMILY}`,
    `font-size:${READER_PDF_FONT_PX}px`,
    `line-height:${READER_PDF_LINE_HEIGHT}`,
    "color:#1a1a1a",
    "word-break:keep-all",
    "overflow-wrap:break-word",
  ].join(";");

  const h1 = document.createElement("h1");
  h1.textContent = doc.title;
  h1.style.cssText =
    "font-size:1.55em;line-height:1.35;font-weight:700;margin:0 0 0.75rem;font-family:inherit;";
  root.appendChild(h1);

  if (doc.source || doc.url) {
    const meta = document.createElement("p");
    meta.textContent = [doc.source, doc.url].filter(Boolean).join(" · ");
    meta.style.cssText =
      "font-size:0.85em;line-height:1.5;color:#5c5c5c;margin:0 0 1.75rem;";
    root.appendChild(meta);
  }

  const body = document.createElement("div");
  body.style.cssText = "display:flex;flex-direction:column;gap:1.25rem;";

  for (const b of doc.blocks) {
    if (b.type === "h") {
      const h2 = document.createElement("h2");
      if (b.html) h2.innerHTML = b.html;
      else h2.textContent = b.text;
      h2.style.cssText =
        "font-size:1.15em;line-height:1.4;font-weight:700;margin:0.35rem 0 0;font-family:inherit;";
      body.appendChild(h2);
      continue;
    }
    if (b.type === "img") {
      const fig = document.createElement("figure");
      fig.className = "reader-pdf-img";
      fig.style.cssText =
        "margin:0;padding:0;overflow:hidden;border-radius:12px;background:#f0f0f0;";
      const img = document.createElement("img");
      img.src = b.src;
      img.alt = b.alt || "";
      img.crossOrigin = "anonymous";
      img.style.cssText =
        "display:block;width:100%;height:auto;object-fit:contain;margin:0;";
      fig.appendChild(img);
      body.appendChild(fig);
      continue;
    }
    const p = document.createElement("p");
    if (b.html) p.innerHTML = b.html;
    else p.textContent = b.text;
    p.style.cssText = "margin:0;";
    body.appendChild(p);
  }

  root.appendChild(body);
  return root;
}
