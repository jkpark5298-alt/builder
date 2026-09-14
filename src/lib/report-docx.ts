import {
  Document,
  ExternalHyperlink,
  ImageRun,
  Packer,
  Paragraph,
  ShadingType,
  TextRun,
  type IRunOptions,
  type ParagraphChild,
} from "docx";
import { reportBodyPlain } from "./report";
import {
  READER_PDF_FONT_PX,
  READER_PDF_LINE_HEIGHT,
  readerDocFromReport,
  sanitizeReaderHtml,
} from "./reader-view";
import type { TypedReport } from "./types";

/**
 * Match PDF reader-capture specs:
 * - body 19px, line-height 1.85, A4 margins, image width
 * - Do not use Word built-in Title/Heading (breaks layout on iPhone)
 */
const PX_TO_HALF_PT = (72 / 96) * 2;
const BODY_SIZE = Math.round(READER_PDF_FONT_PX * PX_TO_HALF_PT);
const TITLE_SIZE = Math.round(READER_PDF_FONT_PX * 1.55 * PX_TO_HALF_PT);
const H2_SIZE = Math.round(READER_PDF_FONT_PX * 1.15 * PX_TO_HALF_PT);
const META_SIZE = Math.round(READER_PDF_FONT_PX * 0.85 * PX_TO_HALF_PT);
const LINE = Math.round(READER_PDF_LINE_HEIGHT * 240);
const PAGE_MARGIN_TWIP = Math.round(52 * (72 / 96) * 20);
const BLOCK_AFTER = 280;
const TITLE_AFTER = 160;
const META_AFTER = 400;
const DOC_IMAGE_MAX_WIDTH = 690;

function docxFont(): string {
  if (typeof navigator === "undefined") return "Malgun Gothic";
  return /Windows/i.test(navigator.userAgent || "")
    ? "Malgun Gothic"
    : "Apple SD Gothic Neo";
}

type RunStyle = {
  bold?: boolean;
  italics?: boolean;
  underline?: boolean;
  color?: string;
  fill?: string;
};

type EmbeddedImage = {
  data: Uint8Array;
  type: "jpg" | "png";
  width: number;
  height: number;
};

function hexColor(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const m = raw.trim().match(/^#?([0-9a-f]{6})$/i);
  if (m) return m[1].toUpperCase();
  const rgb = raw.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgb) {
    const h = (n: string) => Number(n).toString(16).padStart(2, "0");
    return `${h(rgb[1])}${h(rgb[2])}${h(rgb[3])}`.toUpperCase();
  }
  return undefined;
}

function styleFromElement(el: HTMLElement, base: RunStyle): RunStyle {
  const next = { ...base };
  const tag = el.tagName;
  if (tag === "STRONG" || tag === "B") next.bold = true;
  if (tag === "EM" || tag === "I") next.italics = true;
  if (tag === "U") next.underline = true;
  if (tag === "MARK") {
    next.fill =
      hexColor(el.getAttribute("data-color")) ||
      hexColor(el.style.backgroundColor) ||
      "FFF59D";
  }
  const color = hexColor(el.style.color);
  if (color) next.color = color;
  const bg = hexColor(el.style.backgroundColor);
  if (bg) next.fill = bg;
  return next;
}

function runOpts(text: string, style: RunStyle, size = BODY_SIZE): IRunOptions {
  return {
    text,
    font: docxFont(),
    size,
    bold: style.bold,
    italics: style.italics,
    color: style.color || "1A1A1A",
    ...(style.underline ? { underline: {} } : {}),
    ...(style.fill
      ? { shading: { type: ShadingType.CLEAR, fill: style.fill } }
      : {}),
  };
}

function htmlToChildren(html: string): ParagraphChild[] {
  const cleaned = sanitizeReaderHtml(html);
  if (!cleaned.trim()) {
    const plain = reportBodyPlain(html, true).trim();
    return plain ? [new TextRun(runOpts(plain, {}))] : [];
  }
  if (typeof DOMParser === "undefined") {
    const plain = reportBodyPlain(cleaned, true).trim();
    return plain ? [new TextRun(runOpts(plain, {}))] : [];
  }

  const doc = new DOMParser().parseFromString(
    `<div id="docx-root">${cleaned}</div>`,
    "text/html"
  );
  const root = doc.getElementById("docx-root");
  if (!root) {
    const plain = reportBodyPlain(cleaned, true).trim();
    return plain ? [new TextRun(runOpts(plain, {}))] : [];
  }

  const out: ParagraphChild[] = [];
  const walk = (node: Node, style: RunStyle) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent || "";
      if (t) out.push(new TextRun(runOpts(t, style)));
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.tagName === "BR") {
      out.push(new TextRun({ break: 1 }));
      return;
    }
    if (node.tagName === "A") {
      const href = node.getAttribute("href")?.trim() || "";
      const label = (node.textContent || href).trim();
      if (href && /^https?:\/\//i.test(href) && label) {
        out.push(
          new ExternalHyperlink({
            children: [
              new TextRun({
                text: label,
                font: docxFont(),
                size: BODY_SIZE,
                color: "0563C1",
                underline: {},
              }),
            ],
            link: href,
          })
        );
        return;
      }
    }
    const next = styleFromElement(node, style);
    for (const child of Array.from(node.childNodes)) walk(child, next);
  };

  for (const child of Array.from(root.childNodes)) walk(child, {});
  if (!out.length) {
    const plain = reportBodyPlain(cleaned, true).trim();
    if (plain) out.push(new TextRun(runOpts(plain, {})));
  }
  return out;
}

function bodyParagraph(children: ParagraphChild[]): Paragraph {
  return new Paragraph({
    spacing: { after: BLOCK_AFTER, line: LINE },
    children: children.length ? children : [new TextRun(runOpts("", {}))],
  });
}

function titleParagraph(text: string): Paragraph {
  return new Paragraph({
    spacing: { after: TITLE_AFTER, line: Math.round(1.35 * 240) },
    children: [
      new TextRun({
        text,
        font: docxFont(),
        size: TITLE_SIZE,
        bold: true,
        color: "1A1A1A",
      }),
    ],
  });
}

function sectionHeadingParagraph(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 120, after: 80, line: Math.round(1.4 * 240) },
    children: [
      new TextRun({
        text,
        font: docxFont(),
        size: H2_SIZE,
        bold: true,
        color: "1A1A1A",
      }),
    ],
  });
}

function appendHtmlAsParagraphs(children: Paragraph[], html: string) {
  if (typeof DOMParser !== "undefined") {
    const parsed = new DOMParser().parseFromString(
      `<div id="p-root">${sanitizeReaderHtml(html)}</div>`,
      "text/html"
    );
    const root = parsed.getElementById("p-root");
    const kids = root ? Array.from(root.childNodes) : [];
    const blockEls = kids.filter(
      (n) =>
        n instanceof HTMLElement &&
        (n.tagName === "P" ||
          n.tagName === "UL" ||
          n.tagName === "OL" ||
          n.tagName === "H1" ||
          n.tagName === "H2" ||
          n.tagName === "H3")
    );
    if (blockEls.length) {
      for (const el of blockEls) {
        if (!(el instanceof HTMLElement)) continue;
        if (el.tagName === "UL" || el.tagName === "OL") {
          for (const li of Array.from(el.querySelectorAll(":scope > li"))) {
            const runs = htmlToChildren((li as HTMLElement).innerHTML);
            children.push(
              new Paragraph({
                spacing: { after: 80, line: LINE },
                indent: { left: 360 },
                children: [new TextRun(runOpts("? ", {})), ...runs],
              })
            );
          }
          continue;
        }
        const runs = htmlToChildren(el.innerHTML);
        if (runs.length) children.push(bodyParagraph(runs));
      }
      return;
    }
  }
  const runs = htmlToChildren(html);
  if (runs.length) children.push(bodyParagraph(runs));
}

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = src;
  });
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const m = dataUrl.match(/^data:[^;]+;base64,(.+)$/);
  if (!m) return new Uint8Array();
  const bin = atob(m[1]);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function prepareImageForDocx(src: string): Promise<EmbeddedImage | null> {
  const url = (src || "").trim();
  if (!url) return null;
  try {
    let objectUrl: string | null = null;
    let revoke: () => void = () => {};
    try {
      if (url.startsWith("data:image/")) {
        objectUrl = url;
      } else {
        const res = await fetch(url);
        if (!res.ok) return null;
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        revoke = () => URL.revokeObjectURL(objectUrl!);
      }

      const img = await loadHtmlImage(objectUrl);
      const nw = Math.max(1, img.naturalWidth || img.width);
      const nh = Math.max(1, img.naturalHeight || img.height);
      const scale = Math.min(1, DOC_IMAGE_MAX_WIDTH / nw);
      const width = Math.max(1, Math.round(nw * scale));
      const height = Math.max(1, Math.round(nh * scale));

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      const preferPng =
        /png|gif|webp|svg/i.test(url) || url.startsWith("data:image/png");
      const dataUrl = preferPng
        ? canvas.toDataURL("image/png")
        : canvas.toDataURL("image/jpeg", 0.9);
      const data = dataUrlToBytes(dataUrl);
      if (!data.length) return null;
      return {
        data,
        type: dataUrl.startsWith("data:image/png") ? "png" : "jpg",
        width,
        height,
      };
    } finally {
      revoke();
    }
  } catch {
    return null;
  }
}

function imageParagraph(embedded: EmbeddedImage, alt?: string): Paragraph {
  return new Paragraph({
    spacing: { before: 80, after: BLOCK_AFTER },
    children: [
      new ImageRun({
        type: embedded.type,
        data: embedded.data,
        transformation: {
          width: embedded.width,
          height: embedded.height,
        },
        altText: {
          title: alt || "image",
          description: alt || "image",
          name: alt || "image",
        },
      }),
    ],
  });
}

function imageFallbackParagraph(src: string, alt?: string): Paragraph {
  const label = (alt || "image").trim() || "image";
  return new Paragraph({
    spacing: { after: BLOCK_AFTER },
    children: [
      new ExternalHyperlink({
        children: [
          new TextRun({
            text: `[${label}]`,
            font: docxFont(),
            size: BODY_SIZE,
            color: "0563C1",
            underline: {},
          }),
        ],
        link: src,
      }),
    ],
  });
}

/** Build .docx matching PDF reader layout for edit-then-export-PDF. */
export async function buildReportDocxBlob(
  report: TypedReport,
  extraImages?: string[]
): Promise<Blob> {
  const doc = readerDocFromReport(report, extraImages);
  const children: Paragraph[] = [];
  const imageCache = new Map<string, EmbeddedImage | null>();

  async function embedOrLink(src: string, alt?: string) {
    let prepared = imageCache.get(src);
    if (prepared === undefined) {
      prepared = await prepareImageForDocx(src);
      imageCache.set(src, prepared);
    }
    if (prepared) children.push(imageParagraph(prepared, alt));
    else children.push(imageFallbackParagraph(src, alt));
  }

  children.push(titleParagraph(doc.title));

  const metaLine = [doc.source, doc.url].filter(Boolean).join(" · ");
  if (metaLine) {
    children.push(
      new Paragraph({
        spacing: { after: META_AFTER, line: Math.round(1.5 * 240) },
        children: [
          new TextRun({
            text: metaLine,
            font: docxFont(),
            size: META_SIZE,
            color: "5C5C5C",
          }),
        ],
      })
    );
  }

  for (const b of doc.blocks) {
    if (b.type === "h") {
      const text = (b.text || reportBodyPlain(b.html || "", true)).trim();
      if (text) children.push(sectionHeadingParagraph(text));
      continue;
    }
    if (b.type === "img") {
      await embedOrLink(b.src, b.alt);
      continue;
    }

    if (b.html?.trim()) {
      appendHtmlAsParagraphs(children, b.html);
      continue;
    }

    const text = (b.text || "").trim();
    if (text) {
      children.push(bodyParagraph([new TextRun(runOpts(text, {}))]));
    }
  }

  const document = new Document({
    creator: "INF Builder",
    title: doc.title,
    styles: {
      default: {
        document: {
          run: {
            font: docxFont(),
            size: BODY_SIZE,
            color: "1A1A1A",
          },
          paragraph: { spacing: { line: LINE, after: BLOCK_AFTER } },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: {
              top: PAGE_MARGIN_TWIP,
              right: PAGE_MARGIN_TWIP,
              bottom: PAGE_MARGIN_TWIP,
              left: PAGE_MARGIN_TWIP,
            },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBlob(document);
}

export async function downloadReportDocx(opts: {
  report: TypedReport;
  fileName: string;
  extraImages?: string[];
}): Promise<void> {
  const blob = await buildReportDocxBlob(opts.report, opts.extraImages);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = opts.fileName.endsWith(".docx")
    ? opts.fileName
    : `${opts.fileName}.docx`;
  a.click();
  URL.revokeObjectURL(url);
}

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export async function shareOrDownloadReportDocx(opts: {
  report: TypedReport;
  fileName: string;
  title?: string;
  extraImages?: string[];
  preferShare?: boolean;
  shareText?: string;
}): Promise<"shared" | "downloaded"> {
  const fileName = opts.fileName.endsWith(".docx")
    ? opts.fileName
    : `${opts.fileName}.docx`;
  const blob = await buildReportDocxBlob(opts.report, opts.extraImages);
  const file = new File([blob], fileName, { type: DOCX_MIME });

  if (
    opts.preferShare &&
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    (!navigator.canShare || navigator.canShare({ files: [file] }))
  ) {
    try {
      await navigator.share({
        files: [file],
        title: opts.title || "report",
        text:
          opts.shareText ||
          "1) Open in Pages 2) Edit 3) Share as PDF",
      });
      return "shared";
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") throw e;
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
  return "downloaded";
}
