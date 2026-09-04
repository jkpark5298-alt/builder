import { reportBodyPlain } from "./report";
import {
  orderedSlotUrls,
  sectionSlotCapacity,
} from "./report-images";
import { parseBodySImageSlots } from "./report-body-s-slots";
import { organizeUrlArticleText } from "./url-article-report";
import type { TypedReport } from "./types";

export type ReaderBlock =
  | { type: "h"; text: string }
  | { type: "p"; text: string }
  | { type: "img"; src: string; alt?: string };

export type ReaderDoc = {
  title: string;
  source?: string;
  url?: string;
  blocks: ReaderBlock[];
};

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

/** 보고서 섹션·S칸 사진 → 읽기 도구 문서 */
export function readerDocFromReport(
  report: TypedReport,
  extraImages?: string[]
): ReaderDoc {
  const blocks: ReaderBlock[] = [];
  const used = new Set<string>();
  const many = report.sections.length > 1;
  for (const sec of report.sections) {
    const heading = (sec.heading || "").trim();
    if (many && heading && heading !== "본문") {
      blocks.push({ type: "h", text: heading });
    }
    const parsed = parseBodySImageSlots(sec.body || "");
    const urls = orderedSlotUrls(
      sec,
      report.imageRoom,
      sectionSlotCapacity(sec, parsed.slotCount)
    );
    let imgI = 0;
    if (!parsed.segments.length) {
      pushParas(blocks, reportBodyPlain(sec.body || "", Boolean(sec.rich)));
    }
    for (const seg of parsed.segments) {
      pushParas(blocks, reportBodyPlain(seg.html || "", true));
      if (seg.hasSlot) {
        const src = (urls[imgI] || "").trim();
        imgI += 1;
        if (src && !used.has(src)) {
          used.add(src);
          blocks.push({ type: "img", src, alt: heading || "본문 이미지" });
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
  return {
    title: report.meta.title?.trim() || "보고서",
    source: report.meta.channel?.trim() || undefined,
    url: report.meta.url?.trim() || undefined,
    blocks,
  };
}
