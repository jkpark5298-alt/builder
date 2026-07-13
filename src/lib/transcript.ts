import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import { YoutubeTranscript } from "youtube-transcript";
import type { YoutubeMeta } from "./youtube";
import { buildCreatorSourceText } from "./youtube";

const execFileAsync = promisify(execFile);

export type TranscriptSource =
  | "youtube"
  | "youtube_auto"
  | "speech_text"
  | "creator_meta"
  | "none";

export interface TranscriptResult {
  text: string;
  source: TranscriptSource;
  /** 사용자에게 보여줄 안내 (스크립트 없을 때 등) */
  notice?: string;
}

/** 자막/자동자막/음성→텍스트 순으로 확보 */
export async function fetchTranscript(
  videoId: string,
  meta?: YoutubeMeta
): Promise<TranscriptResult> {
  // 1) 수동/공식 자막 (youtube-transcript)
  const manual = await tryYoutubeTranscriptLib(videoId);
  if (manual) return { text: manual, source: "youtube" };

  // 2) 유튜브 자동생성 자막 (timedtext / captionTracks)
  const auto = await tryTimedTextAndCaptionTracks(videoId);
  if (auto) {
    return {
      text: auto,
      source: "youtube_auto",
      notice: "공식 자막은 없어 유튜브 자동생성 자막을 텍스트로 변환해 요약합니다.",
    };
  }

  // 3) yt-dlp 자동자막 (설치되어 있으면) — 음성을 자막 텍스트로 확보
  const ytdlp = await tryYtDlpAutoSubs(videoId);
  if (ytdlp) {
    return {
      text: ytdlp,
      source: "speech_text",
      notice:
        "영상 음성 기반 자동자막(yt-dlp)을 텍스트로 변환해 요약합니다.",
    };
  }

  // 4) 제작자 설명·챕터만
  if (meta && (meta.description || meta.chapters.length)) {
    return {
      text: buildCreatorSourceText(meta),
      source: "creator_meta",
      notice:
        "스크립트(자막)를 가져오지 못했습니다. 제목·설명·챕터만으로 요약합니다. 정확한 요약을 위해 자막/스크립트 붙여넣기를 권장합니다.",
    };
  }

  return {
    text: "",
    source: "none",
    notice:
      "스크립트(자막)가 없습니다. 요약 전에 자막 텍스트를 붙여넣거나, 유튜브에서 자막을 켠 뒤 다시 시도해 주세요.",
  };
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

/** 요약 시작 전: 스크립트 존재 여부 확인 (목록 감지 우선 — 본문 다운로드 실패해도 있으면 있다고 표시) */
export async function probeTranscriptAvailability(videoId: string): Promise<{
  available: boolean;
  source: TranscriptSource | "unknown";
  message: string;
}> {
  // 1) 자막 트랙 목록 먼저 (Vercel 등에서 본문 차단돼도 목록은 되는 경우가 많음)
  const listed = await listCaptionTracks(videoId);
  if (listed.length > 0) {
    const hasManual = listed.some((t) => t.kind !== "asr");
    return {
      available: true,
      source: hasManual ? "youtube" : "youtube_auto",
      message: hasManual
        ? "자막 트랙을 확인했습니다. 스크립트 기준으로 요약합니다."
        : "자동생성 자막 트랙을 확인했습니다. 텍스트로 변환해 요약합니다.",
    };
  }

  // 2) 목록이 없어도 텍스트 API로 한 번 더
  const manual = await tryYoutubeTranscriptLib(videoId);
  if (manual) {
    return {
      available: true,
      source: "youtube",
      message: "자막(스크립트)을 확인했습니다. 스크립트 기준으로 요약합니다.",
    };
  }

  const auto = await tryTimedTextAndCaptionTracks(videoId);
  if (auto) {
    return {
      available: true,
      source: "youtube_auto",
      message:
        "공식 자막은 없지만 자동생성 자막을 텍스트로 변환할 수 있습니다. 이것으로 요약을 진행합니다.",
    };
  }

  const hasYtDlp = await isYtDlpAvailable();
  if (hasYtDlp) {
    return {
      available: true,
      source: "speech_text",
      message:
        "자막 API로는 없지만, 음성→자동자막(yt-dlp)으로 텍스트 변환을 시도합니다. 시간이 더 걸릴 수 있습니다.",
    };
  }

  return {
    available: false,
    source: "none",
    message:
      "지금 서버에서 자막을 확인하지 못했습니다. (유튜브에 자막이 있어도 차단될 수 있습니다) 스크립트를 붙여넣거나, 설명·챕터만으로 계속할 수 있습니다.",
  };
}

/** 자막 트랙 목록만 조회 (본문 불필요) */
async function listCaptionTracks(
  videoId: string
): Promise<Array<{ baseUrl: string; lang?: string; kind?: string }>> {
  const fromPlayer = await getTracksFromInnertube(videoId);
  if (fromPlayer.length) return fromPlayer;

  try {
    const html = await fetchWatchHtml(videoId);
    const player = extractJsonObject(html, "ytInitialPlayerResponse");
    const tracks = findCaptionTracks(player);
    if (tracks.length) return tracks;
  } catch {
    /* ignore */
  }

  const fromList = await getTracksFromTimedTextList(videoId);
  return fromList;
}

async function getTracksFromInnertube(
  videoId: string
): Promise<Array<{ baseUrl: string; lang?: string; kind?: string }>> {
  const clients = [
    {
      clientName: "ANDROID",
      clientVersion: "20.10.38",
      userAgent:
        "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip",
    },
    {
      clientName: "IOS",
      clientVersion: "20.10.4",
      userAgent:
        "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 17_4 like Mac OS X)",
    },
    {
      clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
      clientVersion: "2.0",
      userAgent: UA,
    },
    {
      clientName: "WEB",
      clientVersion: "2.20250320.01.00",
      userAgent: UA,
    },
  ];

  for (const client of clients) {
    try {
      const res = await fetch(
        "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": client.userAgent,
            "Accept-Language": "ko-KR,ko;q=0.9",
            Origin: "https://www.youtube.com",
            Referer: `https://www.youtube.com/watch?v=${videoId}`,
          },
          body: JSON.stringify({
            context: {
              client: {
                clientName: client.clientName,
                clientVersion: client.clientVersion,
                hl: "ko",
                gl: "KR",
              },
            },
            videoId,
            contentCheckOk: true,
            racyCheckOk: true,
          }),
          next: { revalidate: 0 },
        }
      );
      if (!res.ok) continue;
      const data = (await res.json()) as Record<string, unknown>;
      const tracks = findCaptionTracks(data);
      if (tracks.length) return tracks;
    } catch {
      /* next client */
    }
  }
  return [];
}

async function getTracksFromTimedTextList(
  videoId: string
): Promise<Array<{ baseUrl: string; lang?: string; kind?: string }>> {
  try {
    const res = await fetch(
      `https://www.youtube.com/api/timedtext?type=list&v=${videoId}`,
      {
        headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9" },
        next: { revalidate: 0 },
      }
    );
    if (!res.ok) return [];
    const xml = await res.text();
    const tracks: Array<{ baseUrl: string; lang?: string; kind?: string }> = [];
    const re = /<track\b([^>]+)>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml))) {
      const attrs = m[1];
      const lang = /lang_code="([^"]+)"/i.exec(attrs)?.[1];
      if (!lang) continue;
      const kind = /kind="([^"]*)"/i.exec(attrs)?.[1] || "";
      const baseUrl =
        kind === "asr"
          ? `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}&kind=asr&fmt=json3`
          : `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}&fmt=json3`;
      tracks.push({ baseUrl, lang, kind: kind || undefined });
    }
    return tracks;
  } catch {
    return [];
  }
}

async function tryYoutubeTranscriptLib(videoId: string): Promise<string | null> {
  for (const lang of ["ko", "en", undefined] as const) {
    try {
      const parts = lang
        ? await YoutubeTranscript.fetchTranscript(videoId, { lang })
        : await YoutubeTranscript.fetchTranscript(videoId);
      const text = parts.map((p) => p.text).join(" ").replace(/\s+/g, " ").trim();
      if (text.length > 40) return text;
    } catch {
      /* next */
    }
  }
  return null;
}

async function tryTimedTextAndCaptionTracks(
  videoId: string
): Promise<string | null> {
  // Innertube → watch HTML → timedtext list 순
  let tracks = await getTracksFromInnertube(videoId);
  if (!tracks.length) {
    try {
      const html = await fetchWatchHtml(videoId);
      const player = extractJsonObject(html, "ytInitialPlayerResponse");
      tracks = findCaptionTracks(player);
    } catch {
      /* ignore */
    }
  }
  if (!tracks.length) {
    tracks = await getTracksFromTimedTextList(videoId);
  }

  const ordered = [...tracks].sort((a, b) => scoreTrack(b) - scoreTrack(a));
  for (const track of ordered.slice(0, 10)) {
    const text = await fetchCaptionTrackText(track.baseUrl);
    if (text && text.length > 40) return text;
  }

  // Direct timedtext endpoints (언어·형식 확장)
  const langs = ["ko", "ko-KR", "en", "en-US", "ja", "zh-Hans", "zh-Hant"];
  for (const lang of langs) {
    for (const kind of ["", "asr"]) {
      const url =
        kind === "asr"
          ? `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}&kind=asr&fmt=json3`
          : `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}&fmt=json3`;
      try {
        const text = await fetchCaptionTrackText(url);
        if (text && text.length > 40) return text;
      } catch {
        /* next */
      }
    }
  }
  return null;
}

function scoreTrack(t: { lang?: string; kind?: string; name?: string }): number {
  let s = 0;
  const lang = (t.lang || "").toLowerCase();
  if (lang === "ko" || lang.startsWith("ko-")) s += 10;
  if (lang === "en" || lang.startsWith("en-")) s += 4;
  if (t.kind !== "asr") s += 5;
  if (t.kind === "asr") s += 2;
  return s;
}

function findCaptionTracks(
  player: Record<string, unknown> | null
): Array<{ baseUrl: string; lang?: string; kind?: string; name?: string }> {
  if (!player) return [];
  try {
    const caps = (
      player as {
        captions?: {
          playerCaptionsTracklistRenderer?: {
            captionTracks?: Array<{
              baseUrl?: string;
              languageCode?: string;
              kind?: string;
              name?: { simpleText?: string };
            }>;
          };
        };
      }
    ).captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!caps?.length) return [];
    return caps
      .filter((c) => c.baseUrl)
      .map((c) => ({
        baseUrl: c.baseUrl!,
        lang: c.languageCode,
        kind: c.kind,
        name: c.name?.simpleText,
      }));
  } catch {
    return [];
  }
}

async function fetchWatchHtml(videoId: string): Promise<string> {
  const res = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=ko`, {
    headers: {
      "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
      "User-Agent": UA,
    },
    next: { revalidate: 0 },
  });
  if (!res.ok) throw new Error("watch page fetch failed");
  return res.text();
}

async function fetchCaptionTrackText(baseUrl: string): Promise<string | null> {
  let url = baseUrl;
  // baseUrl에 이미 fmt가 있어도 json3 우선
  if (!/[?&]fmt=/.test(url)) {
    url += (url.includes("?") ? "&" : "?") + "fmt=json3";
  } else if (!/[?&]fmt=json3/.test(url)) {
    url = url.replace(/([?&]fmt=)[^&]*/i, "$1json3");
  }
  // 일부 트랙은 & 인코딩 필요
  url = url.replace(/\\u0026/g, "&").replace(/&amp;/g, "&");

  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept-Language": "ko-KR,ko;q=0.9",
      Referer: "https://www.youtube.com/",
    },
    next: { revalidate: 0 },
  });
  if (!res.ok) return null;
  const raw = await res.text();
  if (!raw || raw.length < 10) return null;

  // json3
  try {
    const json = JSON.parse(raw) as {
      events?: Array<{ segs?: Array<{ utf8?: string }> }>;
    };
    if (json.events) {
      const text = json.events
        .flatMap((e) => e.segs ?? [])
        .map((s) => s.utf8 ?? "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (text.length > 40) return text;
    }
  } catch {
    /* xml / vtt */
  }

  // srv1/xml
  if (raw.includes("<text")) {
    const text = raw
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
    if (text.length > 40) return text;
  }

  // vtt
  if (raw.includes("WEBVTT") || raw.includes("-->")) {
    const text = raw
      .split(/\r?\n/)
      .filter(
        (line) =>
          line.trim() &&
          !line.startsWith("WEBVTT") &&
          !line.includes("-->") &&
          !/^\d+$/.test(line.trim())
      )
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text.length > 40) return text;
  }

  return null;
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

async function isYtDlpAvailable(): Promise<boolean> {
  try {
    await execFileAsync("yt-dlp", ["--version"], { timeout: 8000 });
    return true;
  } catch {
    try {
      await execFileAsync("youtube-dl", ["--version"], { timeout: 8000 });
      return true;
    } catch {
      return false;
    }
  }
}

async function tryYtDlpAutoSubs(videoId: string): Promise<string | null> {
  const bin = (await isCommand("yt-dlp"))
    ? "yt-dlp"
    : (await isCommand("youtube-dl"))
      ? "youtube-dl"
      : null;
  if (!bin) return null;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ytfc-"));
  const outTemplate = path.join(tmp, "sub");
  try {
    await execFileAsync(
      bin,
      [
        "--skip-download",
        "--write-auto-sub",
        "--sub-lang",
        "ko,en",
        "--sub-format",
        "vtt/best",
        "-o",
        outTemplate,
        `https://www.youtube.com/watch?v=${videoId}`,
      ],
      { timeout: 120000, maxBuffer: 10 * 1024 * 1024 }
    );

    const files = fs.readdirSync(tmp).filter((f) => /\.(vtt|srt)$/i.test(f));
    for (const file of files) {
      const raw = fs.readFileSync(path.join(tmp, file), "utf-8");
      const text = raw
        .split(/\r?\n/)
        .filter(
          (line) =>
            line.trim() &&
            !line.startsWith("WEBVTT") &&
            !line.includes("-->") &&
            !/^\d+$/.test(line.trim()) &&
            !/^NOTE/.test(line)
        )
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (text.length > 40) return text;
    }
  } catch {
    return null;
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  return null;
}

async function isCommand(cmd: string): Promise<boolean> {
  try {
    await execFileAsync(cmd, ["--version"], { timeout: 8000 });
    return true;
  } catch {
    return false;
  }
}
