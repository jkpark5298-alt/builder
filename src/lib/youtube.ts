export interface YoutubeChapter {
  startSec: number;
  timestamp: string;
  title: string;
}

export interface YoutubeMeta {
  title: string;
  channel: string;
  description: string;
  chapters: YoutubeChapter[];
}

export function extractVideoId(url: string): string | null {
  try {
    const trimmed = url.trim();
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
      /^([a-zA-Z0-9_-]{11})$/,
    ];
    for (const re of patterns) {
      const m = trimmed.match(re);
      if (m?.[1]) return m[1];
    }
    const u = new URL(trimmed);
    if (u.hostname.includes("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function thumbnailUrl(videoId: string) {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

const META_FETCH_MS = 12_000;

function fetchSignal(ms: number = META_FETCH_MS): AbortSignal {
  return AbortSignal.timeout(ms);
}

export async function fetchOEmbed(url: string): Promise<{
  title: string;
  channel: string;
} | null> {
  try {
    const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const res = await fetch(endpoint, {
      next: { revalidate: 0 },
      signal: fetchSignal(),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { title?: string; author_name?: string };
    return {
      title: data.title ?? "제목 없음",
      channel: data.author_name ?? "채널 미상",
    };
  } catch {
    return null;
  }
}

/** Fetch title/channel/description/chapters from watch page + oEmbed. */
export async function fetchYoutubeMeta(
  youtubeUrl: string,
  videoId: string
): Promise<YoutubeMeta> {
  const oembed = await fetchOEmbed(youtubeUrl);
  let title = oembed?.title ?? `YouTube ${videoId}`;
  let channel = oembed?.channel ?? "알 수 없음";
  let description = "";
  let chapters: YoutubeChapter[] = [];

  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=ko`, {
      headers: {
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      },
      next: { revalidate: 0 },
      signal: fetchSignal(),
    });
    if (res.ok) {
      const html = await res.text();
      const player = extractJsonObject(html, "ytInitialPlayerResponse");
      const initial = extractJsonObject(html, "ytInitialData");

      const videoDetails = player?.videoDetails as
        | {
            title?: string;
            author?: string;
            shortDescription?: string;
          }
        | undefined;

      if (videoDetails?.title) title = videoDetails.title;
      if (videoDetails?.author) channel = videoDetails.author;
      if (videoDetails?.shortDescription) {
        description = videoDetails.shortDescription;
      }

      if (!description) {
        description = findDescriptionFallback(html) ?? "";
      }

      chapters = extractChaptersFromPlayer(player);
      if (!chapters.length) {
        chapters = parseChaptersFromDescription(description);
      }
      if (!chapters.length && initial) {
        chapters = extractChaptersFromInitialData(initial);
      }
    }
  } catch {
    /* keep oembed */
  }

  if (!chapters.length && description) {
    chapters = parseChaptersFromDescription(description);
  }

  return { title, channel, description, chapters };
}

export function parseChaptersFromDescription(description: string): YoutubeChapter[] {
  const lines = description.split(/\r?\n/);
  const chapters: YoutubeChapter[] = [];
  const re =
    /^\s*((?:\d{1,2}:)?\d{1,2}:\d{2})\s*[-–—.]?\s*(.+?)\s*$/;

  for (const line of lines) {
    const m = line.match(re);
    if (!m) continue;
    const timestamp = m[1];
    const title = m[2].replace(/\s+/g, " ").trim();
    if (!title || title.length < 2) continue;
    // skip pure URLs
    if (/^https?:\/\//i.test(title)) continue;
    chapters.push({
      timestamp,
      startSec: timestampToSeconds(timestamp),
      title,
    });
  }

  // de-dupe by timestamp
  const seen = new Set<string>();
  return chapters.filter((c) => {
    if (seen.has(c.timestamp)) return false;
    seen.add(c.timestamp);
    return true;
  });
}

function timestampToSeconds(ts: string): number {
  const parts = ts.split(":").map((p) => parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] ?? 0;
}

function extractJsonObject(
  html: string,
  marker: string
): Record<string, unknown> | null {
  const idx = html.indexOf(marker);
  if (idx < 0) return null;
  const eq = html.indexOf("=", idx);
  if (eq < 0) return null;
  let i = eq + 1;
  while (i < html.length && /\s/.test(html[i])) i++;
  if (html[i] !== "{") return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let j = i; j < html.length; j++) {
    const ch = html[j];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(i, j + 1)) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function findDescriptionFallback(html: string): string | null {
  const m = html.match(/"shortDescription":"((?:\\.|[^"\\])*)"/);
  if (!m?.[1]) return null;
  try {
    return JSON.parse(`"${m[1]}"`) as string;
  } catch {
    return m[1]
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
}

function extractChaptersFromPlayer(
  player: Record<string, unknown> | null
): YoutubeChapter[] {
  if (!player) return [];
  try {
    const markers =
      (
        player as {
          playerOverlays?: {
            playerOverlayRenderer?: {
              decoratedPlayerBarRenderer?: {
                decoratedPlayerBarRenderer?: {
                  playerBar?: {
                    multiMarkersPlayerBarRenderer?: {
                      markersMap?: Array<{
                        value?: {
                          chapters?: Array<{
                            chapterRenderer?: {
                              title?: { simpleText?: string };
                              timeRangeStartMillis?: string | number;
                            };
                          }>;
                        };
                      }>;
                    };
                  };
                };
              };
            };
          };
        }
      ).playerOverlays?.playerOverlayRenderer?.decoratedPlayerBarRenderer
        ?.decoratedPlayerBarRenderer?.playerBar?.multiMarkersPlayerBarRenderer
        ?.markersMap ?? [];

    for (const entry of markers) {
      const chapters = entry.value?.chapters ?? [];
      const parsed: YoutubeChapter[] = [];
      for (const ch of chapters) {
        const r = ch.chapterRenderer;
        if (!r?.title?.simpleText) continue;
        const ms = Number(r.timeRangeStartMillis ?? 0);
        const startSec = Math.floor(ms / 1000);
        parsed.push({
          startSec,
          timestamp: secondsToTimestamp(startSec),
          title: r.title.simpleText,
        });
      }
      if (parsed.length) return parsed;
    }
  } catch {
    /* ignore */
  }
  return [];
}

function extractChaptersFromInitialData(
  data: Record<string, unknown>
): YoutubeChapter[] {
  // rare path — description body often already parsed
  const raw = JSON.stringify(data);
  const re =
    /"title":\{"simpleText":"([^"]+)"\}[^]{0,200}?"timeRangeStartMillis":"?(\d+)"?/g;
  const out: YoutubeChapter[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const startSec = Math.floor(parseInt(m[2], 10) / 1000);
    out.push({
      title: m[1],
      startSec,
      timestamp: secondsToTimestamp(startSec),
    });
    if (out.length > 40) break;
  }
  return out;
}

function secondsToTimestamp(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Text used for summarization when captions are missing. */
export function buildCreatorSourceText(meta: YoutubeMeta): string {
  const parts: string[] = [];
  parts.push(`제목: ${meta.title}`);
  parts.push(`채널/제작: ${meta.channel}`);
  if (meta.description.trim()) {
    parts.push("제작자 설명:");
    parts.push(meta.description.trim());
  }
  if (meta.chapters.length) {
    parts.push("챕터(목차):");
    for (const c of meta.chapters) {
      parts.push(`${c.timestamp} ${c.title}`);
    }
  }
  return parts.join("\n");
}
