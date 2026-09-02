import { persistMediaBuffer } from "./media-store";
import { unwrapSoftLineBreaks } from "./paste";

export const ARTICLE_FETCH_MAX_HTML_BYTES = 2 * 1024 * 1024;
export const ARTICLE_FETCH_MAX_IMAGES = 16;
/** 페이지에서 받은 바이트를 재압축하지 않고 저장. 이보다 크면 건너뜀 */
export const ARTICLE_FETCH_IMAGE_MAX_BYTES = 4_000_000;
const HTML_TIMEOUT_MS = 20_000;
const IMAGE_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 5;

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export type FetchedArticle = {
  url: string;
  title: string;
  siteName?: string;
  text: string;
  images: string[];
  thumbnailUrl?: string;
  imageCount: number;
  skippedImages: number;
};

function isPrivateIPv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a > 255 || b > 255 || Number(m[3]) > 255 || Number(m[4]) > 255) {
    return true;
  }
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

export function assertPublicHttpUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new Error("유효한 URL이 아닙니다. https:// 로 시작하는 주소를 넣어 주세요.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("http 또는 https 주소만 가져올 수 있습니다.");
  }
  const host = parsed.hostname.replace(/\.$/, "").toLowerCase();
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".lan") ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host === "[::1]" ||
    host.startsWith("127.")
  ) {
    throw new Error("내부 주소는 가져올 수 없습니다.");
  }
  if (isPrivateIPv4(host)) {
    throw new Error("사설 IP 주소는 가져올 수 없습니다.");
  }
  if (host.includes(":")) {
    const ip6 = host.replace(/^\[|\]$/g, "");
    if (
      ip6 === "::1" ||
      ip6.startsWith("fc") ||
      ip6.startsWith("fd") ||
      ip6.startsWith("fe80")
    ) {
      throw new Error("사설 IP 주소는 가져올 수 없습니다.");
    }
  }
  return parsed;
}

function decodeEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const n = parseInt(h, 16);
      return Number.isFinite(n) ? String.fromCodePoint(n) : "";
    })
    .replace(/&#(\d+);/g, (_, d) => {
      const n = parseInt(d, 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : "";
    });
}

function attr(tag: string, name: string): string {
  const re = new RegExp(
    `${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i"
  );
  const m = re.exec(tag);
  return decodeEntities((m?.[1] ?? m?.[2] ?? m?.[3] ?? "").trim());
}

function pickSrcset(srcset: string): string {
  let best = "";
  let bestW = -1;
  for (const part of srcset.split(",")) {
    const bits = part.trim().split(/\s+/);
    const url = bits[0] || "";
    if (!url) continue;
    const w = parseInt(bits[1] || "0", 10) || 0;
    if (w >= bestW) {
      best = url;
      bestW = w;
    }
  }
  return best;
}

function absoluteUrl(base: URL, raw: string): string | null {
  const s = raw.trim();
  if (!s || s.startsWith("data:") || s.startsWith("javascript:")) return null;
  try {
    return new URL(s, base).href;
  } catch {
    return null;
  }
}

function metaContent(html: string, key: string): string {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)\\s*=\\s*["']${key}["'][^>]*>`,
    "i"
  );
  const tag = html.match(re)?.[0];
  if (!tag) return "";
  return attr(tag, "content");
}

function detectCharset(header: string | null, htmlHead: string): string {
  const fromHeader = /charset\s*=\s*["']?([^\s;"']+)/i.exec(header || "")?.[1];
  const fromMeta =
    /<meta[^>]+charset\s*=\s*["']?([^"'>\s]+)/i.exec(htmlHead)?.[1] ||
    /<meta[^>]+content\s*=\s*["'][^"']*charset=([^"'>\s;]+)/i.exec(htmlHead)?.[1];
  const raw = (fromHeader || fromMeta || "utf-8").trim().toLowerCase();
  if (raw === "euc-kr" || raw === "ks_c_5601-1987" || raw === "euckr") {
    return "euc-kr";
  }
  if (raw === "utf-8" || raw === "utf8") return "utf-8";
  return raw;
}

function looksMojibake(text: string): boolean {
  const bad = (text.match(/\uFFFD/g) || []).length;
  if (bad > 12) return true;
  return text.length > 400 && bad / text.length > 0.015;
}

function stripNoise(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, " ")
    .replace(/<form\b[\s\S]*?<\/form>/gi, " ")
    .replace(/<(nav|footer|header|aside|button)\b[\s\S]*?<\/\1>/gi, " ");
}

function extractByTag(html: string, tag: string): string {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  return html.match(re)?.[1] ?? "";
}

function extractByAttr(html: string, attrName: string, value: string): string {
  const re = new RegExp(
    `<([a-z][a-z0-9]*)\\b[^>]*${attrName}\\s*=\\s*["']([^"']*)["'][^>]*>([\\s\\S]*?)<\\/\\1>`,
    "gi"
  );
  let best = "";
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const attrVal = m[2] || "";
    const body = m[3] || "";
    if (attrName === "class") {
      const tokens = attrVal.split(/\s+/);
      if (!tokens.includes(value)) continue;
    } else if (attrVal !== value) {
      continue;
    }
    if (body.length > best.length) best = body;
  }
  return best;
}

function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|section|article|figcaption)>/gi, "\n\n")
    .replace(/<li\b[^>]*>/gi, "• ");
  const text = decodeEntities(withBreaks.replace(/<[^>]+>/g, " "));
  return unwrapSoftLineBreaks(
    text
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

function pickArticleHtml(html: string): string {
  const cleaned = stripNoise(html);
  const candidates = [
    extractByAttr(cleaned, "itemprop", "articleBody"),
    extractByTag(cleaned, "article"),
    extractByAttr(cleaned, "id", "article-view-content-div"),
    extractByAttr(cleaned, "id", "newsEndContents"),
    extractByAttr(cleaned, "id", "dic_area"),
    extractByAttr(cleaned, "class", "article-body"),
    extractByAttr(cleaned, "class", "article_body"),
    extractByAttr(cleaned, "class", "article_view"),
    extractByAttr(cleaned, "class", "news_body"),
    extractByAttr(cleaned, "class", "entry-content"),
    extractByAttr(cleaned, "class", "post-content"),
    extractByTag(cleaned, "main"),
  ].filter((c) => c.trim().length > 80);

  if (!candidates.length) {
    return extractByTag(cleaned, "body") || cleaned;
  }
  return candidates.reduce((best, cur) =>
    cur.length > best.length ? cur : best
  );
}

function skipImageUrl(url: string): boolean {
  const u = url.toLowerCase();
  if (
    /pixel|spacer|tracking|doubleclick|facebook\.com\/tr|analytics|sprite|favicon|1x1|advert|adservice|scorecard/.test(
      u
    )
  ) {
    return true;
  }
  const path = u.split("?")[0] || u;
  if (/\.(svg|ico)(\?|$)/.test(path)) return true;
  if (/\/(?:icon|logo|badge|button)s?\//.test(path)) return true;
  return false;
}

function collectImageUrls(html: string, base: URL): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const tags = html.match(/<img\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const w = parseInt(attr(tag, "width") || "0", 10);
    const h = parseInt(attr(tag, "height") || "0", 10);
    if ((w > 0 && w < 40) || (h > 0 && h < 40)) continue;
    const raw =
      pickSrcset(attr(tag, "srcset") || attr(tag, "data-srcset")) ||
      attr(tag, "data-original") ||
      attr(tag, "data-full") ||
      attr(tag, "data-large") ||
      attr(tag, "src") ||
      attr(tag, "data-src") ||
      attr(tag, "data-lazy-src") ||
      attr(tag, "data-url");
    const abs = raw ? absoluteUrl(base, raw) : null;
    if (!abs || seen.has(abs) || skipImageUrl(abs)) continue;
    seen.add(abs);
    out.push(abs);
  }
  return out;
}

function insertImageMarkers(articleHtml: string, kept: Set<string>, base: URL): string {
  let i = 0;
  const marked = articleHtml.replace(/<img\b[^>]*>/gi, (tag) => {
    const raw =
      attr(tag, "src") ||
      pickSrcset(attr(tag, "srcset")) ||
      attr(tag, "data-src") ||
      attr(tag, "data-original") ||
      attr(tag, "data-lazy-src");
    const abs = raw ? absoluteUrl(base, raw) : null;
    if (!abs || !kept.has(abs)) return "";
    i += 1;
    return `\n\n[이미지 ${i}]\n\n`;
  });
  return htmlToText(marked);
}

async function fetchWithRedirects(start: URL): Promise<{
  url: URL;
  buffer: Buffer;
  contentType: string;
}> {
  let current = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    assertPublicHttpUrl(current.href);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HTML_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(current.href, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
          "User-Agent": BROWSER_UA,
        },
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        throw new Error("페이지를 가져오는 시간이 초과됐습니다. 다시 시도해 주세요.");
      }
      throw new Error("페이지에 연결할 수 없습니다. 주소를 확인해 주세요.");
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error(`페이지를 열 수 없습니다 (${res.status}).`);
      current = new URL(loc, current);
      continue;
    }
    if (!res.ok) {
      throw new Error(`페이지를 열 수 없습니다 (${res.status}).`);
    }
    const contentType = res.headers.get("content-type") || "";
    if (
      contentType &&
      !/text\/html|application\/xhtml|text\/plain|application\/xml/i.test(
        contentType
      )
    ) {
      throw new Error("HTML 페이지가 아닙니다. 기사·웹 글 주소를 넣어 주세요.");
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > ARTICLE_FETCH_MAX_HTML_BYTES) {
      throw new Error("페이지가 너무 큽니다. 다른 주소를 사용해 주세요.");
    }
    const finalUrl = new URL(res.url || current.href);
    assertPublicHttpUrl(finalUrl.href);
    return { url: finalUrl, buffer: buf, contentType };
  }
  throw new Error("리다이렉트가 너무 많습니다.");
}

function decodeHtmlBuffer(buffer: Buffer, contentType: string): string {
  const head = buffer.subarray(0, Math.min(buffer.length, 4096)).toString("latin1");
  const charset = detectCharset(contentType, head);
  try {
    const text = new TextDecoder(charset, { fatal: false }).decode(buffer);
    if (charset !== "euc-kr" && looksMojibake(text)) {
      return new TextDecoder("euc-kr", { fatal: false }).decode(buffer);
    }
    return text;
  } catch {
    return buffer.toString("utf8");
  }
}

function guessExt(contentType: string, url: string): string {
  const ct = contentType.toLowerCase();
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("gif")) return "gif";
  if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";
  const path = url.split("?")[0] || "";
  const m = path.match(/\.(png|jpe?g|webp|gif)$/i);
  return m?.[1]?.toLowerCase() === "jpeg" ? "jpg" : (m?.[1] || "jpg").toLowerCase();
}

async function persistRemoteImage(
  imageUrl: string,
  prefix: string
): Promise<string | null> {
  try {
    assertPublicHttpUrl(imageUrl);
  } catch {
    return null;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
  try {
    const res = await fetch(imageUrl, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "image/avif,image/webp,image/*,*/*;q=0.8",
        "User-Agent": BROWSER_UA,
      },
    });
    if (!res.ok) return null;
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (ct && !ct.startsWith("image/")) return null;
    if (ct.includes("svg")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > ARTICLE_FETCH_IMAGE_MAX_BYTES) return null;
    if (buf.length < 80) return null;
    const contentType = ct.startsWith("image/")
      ? ct.split(";")[0]!.trim()
      : `image/${guessExt(ct, imageUrl) === "jpg" ? "jpeg" : guessExt(ct, imageUrl)}`;
    return persistMediaBuffer(buf, contentType, {
      prefix,
      filenameHint: `article.${guessExt(contentType, imageUrl)}`,
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function titleFromHtml(html: string): string {
  const og = metaContent(html, "og:title") || metaContent(html, "twitter:title");
  if (og) return decodeEntities(og).trim();
  const t = extractByTag(html, "title");
  return decodeEntities(t.replace(/\s+/g, " ")).trim();
}

/**
 * 공개 웹 페이지에서 본문 텍스트와 이미지를 가져와 저장소에 보관한다.
 */
export async function fetchArticleFromUrl(
  rawUrl: string,
  opts?: { persistPrefix?: string }
): Promise<FetchedArticle> {
  const start = assertPublicHttpUrl(rawUrl);
  const fetched = await fetchWithRedirects(start);
  const html = decodeHtmlBuffer(fetched.buffer, fetched.contentType);
  const articleHtml = pickArticleHtml(html);
  const title = titleFromHtml(html);
  const siteName =
    metaContent(html, "og:site_name") ||
    metaContent(html, "application-name") ||
    fetched.url.hostname.replace(/^www\./, "");

  const ogImage = metaContent(html, "og:image") || metaContent(html, "twitter:image");
  const ogAbs = ogImage ? absoluteUrl(fetched.url, ogImage) : null;

  const fromBody = collectImageUrls(articleHtml, fetched.url);
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const u of [ogAbs, ...fromBody]) {
    if (!u || seen.has(u) || skipImageUrl(u)) continue;
    seen.add(u);
    ordered.push(u);
    if (ordered.length >= ARTICLE_FETCH_MAX_IMAGES) break;
  }

  const prefix = opts?.persistPrefix || "videos/url-articles";
  const persisted: string[] = [];
  const originalToPersisted = new Map<string, string>();
  let skipped = 0;
  for (const u of ordered) {
    const saved = await persistRemoteImage(u, prefix);
    if (saved) {
      persisted.push(saved);
      originalToPersisted.set(u, saved);
    } else {
      skipped += 1;
    }
  }

  const keptOriginals = new Set(originalToPersisted.keys());
  let text = insertImageMarkers(articleHtml, keptOriginals, fetched.url);
  if (!text || text.length < 40) {
    text = htmlToText(articleHtml);
  }
  if (!text || text.length < 40) {
    throw new Error(
      "본문을 찾지 못했습니다. 로그인·구독이 필요한 페이지이거나 본문이 비어 있습니다."
    );
  }

  if (persisted.length && !/\[이미지\s+\d+\]/.test(text)) {
    const extra = persisted
      .map((_, i) => `[이미지 ${i + 1}]`)
      .join("\n");
    text = `${text}\n\n${extra}`;
  }

  const thumb = persisted[0];

  return {
    url: fetched.url.href,
    title: title.slice(0, 200),
    siteName: siteName?.slice(0, 80) || undefined,
    text,
    images: persisted,
    thumbnailUrl: thumb,
    imageCount: persisted.length,
    skippedImages: skipped,
  };
}
