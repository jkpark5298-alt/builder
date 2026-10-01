/**
 * Best-effort Instagram/public page metadata + media preview.
 * Instagram blocks many direct fetches — we also try public mirrors
 * (same idea many “인스타 미디어 받기” Shortcuts use).
 */

import { isAllowedMetaPageUrl } from "@/lib/allowed-image-url";

export type PublicMeta = {
  title?: string;
  description?: string;
  imageUrl?: string;
  imageUrls?: string[];
  warning?: string;
};

function decodeHtml(input: string) {
  let text = input;
  for (let i = 0; i < 3; i += 1) {
    const prev = text;
    text = text
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&apos;/gi, "'")
      .replace(/&#39;/g, "'")
      .replace(/&#x([0-9a-fA-F]+);/g, (match, hex: string) => {
        const code = Number.parseInt(hex, 16);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      })
      .replace(/&#(\d+);/g, (match, dec: string) => {
        const code = Number.parseInt(dec, 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      });
    if (text === prev) break;
  }
  return text.trim();
}

/**
 * Instagram og:description often prefixes engagement meta, e.g.
 * `1,631 likes, 12 comments - art_sadam on August 8, 2026: "캡션..."`
 */
export function cleanInstagramCaption(input: string) {
  let text = String(input || "").trim();

  // 271 likes, 41 comments - user - August 11, 2026: "캡션"
  // 1,631 likes, 12 comments - user on August 8, 2026: "캡션"
  text = text.replace(
    /^\d[\d,.\s]*\s+likes?,\s*\d[\d,.\s]*\s+comments?\s*[-–—]\s*/i,
    "",
  );
  text = text.replace(
    /^[^\s:"“]+(?:\s+[^\s:"“]+)*\s+(?:-|on)\s+[A-Za-z]+\s+\d{1,2},\s*\d{4}:\s*/i,
    "",
  );
  text = text.replace(
    /^\d[\d,.\s]*\s+likes?,\s*\d[\d,.\s]*\s+comments?[^\n"]*/i,
    "",
  );
  text = text.replace(/^\s*[-–—:]\s*/, "");

  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("“") && text.endsWith("”"))
  ) {
    text = text.slice(1, -1).trim();
  } else if (text.startsWith('"') || text.startsWith("“")) {
    text = text.slice(1).trim();
  }

  return text.trim();
}

function getMeta(html: string, property: string) {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`,
    "i",
  );
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`,
    "i",
  );
  return html.match(re)?.[1] || html.match(re2)?.[1];
}

function collectImageCandidates(html: string): string[] {
  const found: string[] = [];
  const push = (value?: string) => {
    if (!value) return;
    const url = decodeHtml(value).replace(/&amp;/g, "&").trim();
    if (!url.startsWith("http")) return;
    if (found.includes(url)) return;
    found.push(url);
  };

  push(getMeta(html, "og:image"));
  push(getMeta(html, "og:image:secure_url"));
  push(getMeta(html, "twitter:image"));

  for (const match of html.matchAll(
    /https:\/\/(?:scontent|instagram|[^"'\\\s<>]*fbcdn\.net)[^"'\\\s<>]+(?:\.jpg|\.jpeg|\.png|\.webp)/gi,
  )) {
    push(match[0].replace(/\\u0026/g, "&").replace(/\\\//g, "/"));
    if (found.length >= 8) break;
  }

  return found;
}

function isInstagramUrl(url: string) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return (
      host === "instagram.com" ||
      host === "instagr.am" ||
      host.endsWith(".instagram.com")
    );
  } catch {
    return false;
  }
}

function unescapeJsonString(raw: string) {
  try {
    return JSON.parse(`"${raw.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`) as string;
  } catch {
    return raw
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\")
      .replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex: string) =>
        String.fromCodePoint(Number.parseInt(hex, 16)),
      );
  }
}

function extractCaptionFromInlineJson(html: string): string | undefined {
  const patterns = [
    /"edge_media_to_caption"\s*:\s*\{"edges"\s*:\s*\[\{"node"\s*:\s*\{"text"\s*:\s*"((?:\\.|[^"\\])*)"/,
    /"caption"\s*:\s*\{"text"\s*:\s*"((?:\\.|[^"\\])*)"/,
    /"accessibility_caption"\s*:\s*"((?:\\.|[^"\\])*)"/,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match?.[1]) continue;
    const text = cleanInstagramCaption(unescapeJsonString(match[1]));
    if (text) return text;
  }
  return undefined;
}

/** Mirror hosts used by many Instagram download Shortcuts. */
function buildMirrorUrls(sourceUrl: string): string[] {
  try {
    const parsed = new URL(sourceUrl);
    const path = parsed.pathname.replace(/\/+$/, "") + "/";
    return [
      sourceUrl,
      `https://www.ddinstagram.com${path}${parsed.search}`,
      `https://ddinstagram.com${path}${parsed.search}`,
      `https://www.kkinstagram.com${path}${parsed.search}`,
      `https://kkinstagram.com${path}${parsed.search}`,
      `https://www.imginn.com${path}${parsed.search}`,
      // Embed page sometimes exposes media more reliably
      sourceUrl.includes("/embed")
        ? sourceUrl
        : `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}/embed/captioned/`,
    ].filter((value, index, arr) => arr.indexOf(value) === index);
  } catch {
    return [sourceUrl];
  }
}

async function fetchHtml(url: string, timeoutMs = 4000): Promise<string | null> {
  if (!isAllowedMetaPageUrl(url)) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      },
      redirect: "follow",
      cache: "no-store",
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function parseMetaFromHtml(html: string): PublicMeta {
  const title = getMeta(html, "og:title") || getMeta(html, "twitter:title");
  const rawDescription =
    getMeta(html, "og:description") ||
    getMeta(html, "twitter:description") ||
    extractCaptionFromInlineJson(html);
  const imageUrls = collectImageCandidates(html);
  const description = rawDescription
    ? cleanInstagramCaption(
        rawDescription.startsWith('"') || rawDescription.includes("&")
          ? decodeHtml(rawDescription)
          : rawDescription,
      )
    : undefined;

  return {
    title: title ? decodeHtml(title) : undefined,
    description,
    imageUrl: imageUrls[0],
    imageUrls,
  };
}

export async function fetchPublicMeta(url: string): Promise<PublicMeta> {
  const candidates = isInstagramUrl(url)
    ? buildMirrorUrls(url)
    : isAllowedMetaPageUrl(url)
      ? [url]
      : [];
  if (candidates.length === 0) {
    return {
      warning:
        "Instagram 주소만 미리보기할 수 있습니다. URL을 확인하거나 단축어로 전체 추가를 쓰세요.",
    };
  }

  const best: PublicMeta = {};
  let openedAny = false;
  let pending = candidates.length;

  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    const enough =
      () => Boolean(best.description && (best.imageUrl || best.imageUrls?.length));

    for (const candidate of candidates) {
      void (async () => {
        try {
          const html = await fetchHtml(candidate);
          if (!html) return;
          openedAny = true;
          const parsed = parseMetaFromHtml(html);
          if (!best.title && parsed.title) best.title = parsed.title;
          if (!best.description && parsed.description) {
            best.description = parsed.description;
          }
          const images = [
            ...(best.imageUrls || []),
            ...(parsed.imageUrls || []),
          ].filter((value, index, arr) => arr.indexOf(value) === index);
          if (images.length > 0) {
            best.imageUrls = images;
            best.imageUrl = images[0];
          }
          if (enough()) finish();
        } finally {
          pending -= 1;
          if (pending <= 0) finish();
        }
      })();
    }
  });

  if (best.description && !best.imageUrl) {
    best.warning =
      "캡션은 가져왔지만 이미지는 막혀 있습니다. ‘인스타 미디어 받기’ 후 다운로드에서 원본을 올리세요.";
  }

  if (!best.description && !best.imageUrl) {
    return {
      warning: openedAny
        ? "공개 메타데이터를 읽지 못했습니다. Instagram은 자동 수집이 제한되는 경우가 많습니다. 캡션·이미지를 직접 넣거나, 아이폰 단축어 ‘인스타 미디어 받기’로 받은 사진을 업로드해 주세요."
        : "페이지를 열지 못했습니다. 네트워크를 확인하거나 단축어로 전체 추가를 쓰세요.",
    };
  }

  return best;
}
