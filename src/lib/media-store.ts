import { hasDatabase } from "./db";
import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { put } from "@vercel/blob";
import type {
  AnswerPart,
  FactCheckResult,
  InfographicData,
  SummaryItem,
  TypedReport,
  VideoRecord,
} from "./types";
import { reportImagePrefix } from "./media-paths";

function readEnv(name: string): string | undefined {
  const v = process.env[name];
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length ? t : undefined;
}

function onVercel(): boolean {
  return Boolean(readEnv("VERCEL") || readEnv("AWS_LAMBDA_FUNCTION_NAME"));
}

function mediaDir(): string {
  if (onVercel()) {
    return path.join("/tmp", "youtube-factcheck", "media");
  }
  return path.join(process.cwd(), "data", "media");
}

function blobToken(): string | undefined {
  return readEnv("BLOB_READ_WRITE_TOKEN");
}

function extFromContentType(ct: string): string {
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("gif")) return "gif";
  if (ct.includes("svg")) return "svg";
  return "jpg";
}

function contentHash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex").slice(0, 20);
}

function parseDataUrl(dataUrl: string): { contentType: string; buffer: Buffer } | null {
  const m = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/i.exec(dataUrl);
  if (!m) return null;
  const contentType = (m[1] || "application/octet-stream").trim();
  const isBase64 = Boolean(m[2]);
  const data = m[3] || "";
  try {
    const buffer = isBase64
      ? Buffer.from(data, "base64")
      : Buffer.from(decodeURIComponent(data), "utf8");
    if (!buffer.length) return null;
    return { contentType, buffer };
  } catch {
    return null;
  }
}

/** data URL / 원격이 아닌 짧은 HTTP(S) URL은 그대로 둠 */
export function isPersistedMediaUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  if (url.startsWith("data:")) return false;
  return /^https?:\/\//i.test(url) || url.startsWith("/api/media/");
}

function isBlobFailureRecoverable(msg: string): boolean {
  return /suspended|unauthorized|forbidden|401|403|404|not found|quota|limit|network|fetch failed|ECONN|ETIMEDOUT/i.test(
    msg
  );
}

/**
 * data URL → Blob URL (1차). Blob 이상/미연결 시 Neon(또는 로컬)으로 폴백.
 * 동일 바이너리는 content hash로 재사용해 중복 저장을 줄인다.
 */
export async function persistMediaDataUrl(
  dataUrl: string,
  opts?: { prefix?: string; filenameHint?: string }
): Promise<string> {
  if (!dataUrl) return dataUrl;
  if (isPersistedMediaUrl(dataUrl)) return dataUrl;
  if (!dataUrl.startsWith("data:")) return dataUrl;

  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return dataUrl;
  return persistMediaBuffer(parsed.buffer, parsed.contentType, opts);
}

/** multipart 업로드용 — Buffer 직접 저장 */
export async function persistMediaBuffer(
  buffer: Buffer,
  contentType: string,
  opts?: { prefix?: string; filenameHint?: string }
): Promise<string> {
  const prefix = (opts?.prefix || "media").replace(/[^a-zA-Z0-9/_-]/g, "");
  const ext = extFromContentType(contentType || "image/jpeg");
  const hash = contentHash(buffer);
  const key = `${prefix}/${hash}.${ext}`;
  const neonHint = `${prefix.replace(/\//g, "_")}_${hash}`;

  const forceNeon = readEnv("NEON_MEDIA_FORCE") === "1";
  const token = blobToken();

  const saveToNeon = async () => {
    const { putNeonMedia } = await import("./neon-media");
    return putNeonMedia(buffer, contentType || "image/jpeg", neonHint);
  };

  const formatMediaError = (msg: string) => {
    if (/project size limit|512\s*MB|could not extend file/i.test(msg)) {
      return (
        "Neon DB 용량(512MB)이 가득 찼습니다. " +
        "Vercel Blob 스토어를 연결하거나 미사용 이미지를 정리해 주세요."
      );
    }
    if (/suspended/i.test(msg)) {
      return "Vercel Blob 스토어가 정지(suspended) 상태입니다.";
    }
    return msg;
  };

  if (token && !forceNeon) {
    try {
      const blob = await put(key, buffer, {
        access: "public",
        contentType: contentType || "image/jpeg",
        token,
        addRandomSuffix: false,
        allowOverwrite: true,
      });
      return blob.url;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[media-store] Blob upload failed → Neon fallback:", msg);
      if (!isBlobFailureRecoverable(msg) && !hasDatabase()) {
        throw new Error(`이미지 저장 실패 (Blob: ${formatMediaError(msg)})`);
      }
      try {
        return await saveToNeon();
      } catch (neonErr) {
        const nmsg =
          neonErr instanceof Error ? neonErr.message : String(neonErr);
        throw new Error(
          `이미지 저장 실패 (Blob: ${formatMediaError(msg)} / Neon: ${formatMediaError(nmsg)})`
        );
      }
    }
  }

  if (onVercel() || hasDatabase()) {
    try {
      return await saveToNeon();
    } catch (neonErr) {
      const nmsg = neonErr instanceof Error ? neonErr.message : String(neonErr);
      if (token) {
        try {
          const blob = await put(key, buffer, {
            access: "public",
            contentType: contentType || "image/jpeg",
            token,
            addRandomSuffix: false,
            allowOverwrite: true,
          });
          return blob.url;
        } catch (blobErr) {
          const bmsg =
            blobErr instanceof Error ? blobErr.message : String(blobErr);
          throw new Error(
            `이미지 저장 실패 (Neon: ${formatMediaError(nmsg)} / Blob: ${formatMediaError(bmsg)})`
          );
        }
      }
      throw new Error(`이미지 저장 실패 (Neon: ${formatMediaError(nmsg)})`);
    }
  }

  const dir = mediaDir();
  fs.mkdirSync(dir, { recursive: true });
  const safeName = key.replace(/\//g, "__");
  const filePath = path.join(dir, safeName);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, buffer);
  }
  return `/api/media/${encodeURIComponent(safeName)}`;
}

export async function persistMediaUrls(
  urls: string[] | undefined | null,
  opts?: { prefix?: string; keepEmptySlots?: boolean }
): Promise<string[]> {
  if (!urls?.length) return [];
  const out: string[] = [];
  for (const url of urls) {
    if (!url?.trim()) {
      // 보고서 S 슬롯처럼 인덱스=칸 매핑을 유지해야 할 때 빈 칸 보존
      if (opts?.keepEmptySlots) out.push("");
      continue;
    }
    out.push(await persistMediaDataUrl(url.trim(), opts));
  }
  return out;
}

async function persistParts(
  parts: AnswerPart[] | undefined,
  prefix: string
): Promise<AnswerPart[] | undefined> {
  if (!parts?.length) return parts;
  const next: AnswerPart[] = [];
  for (const p of parts) {
    next.push({
      ...p,
      imageUrls: await persistMediaUrls(p.imageUrls, { prefix }),
    });
  }
  return next;
}

async function persistItem(
  item: SummaryItem,
  videoId: string
): Promise<SummaryItem> {
  const urls = await persistMediaUrls(
    [
      ...(item.imageUrl ? [item.imageUrl] : []),
      ...(item.imageUrls ?? []),
    ],
    { prefix: `videos/${videoId}/items` }
  );
  const [first, ...rest] = urls;
  return {
    ...item,
    imageUrl: first,
    imageUrls: rest.length ? rest : undefined,
  };
}

async function persistFactCheck(
  fc: FactCheckResult,
  videoId: string
): Promise<FactCheckResult> {
  const parts = await persistParts(
    fc.answerParts,
    `videos/${videoId}/answers`
  );
  const fromParts = (parts ?? []).flatMap((p) => p.imageUrls ?? []);
  const flat = fromParts.length
    ? fromParts
    : await persistMediaUrls(
        [
          ...(fc.answerImageUrl ? [fc.answerImageUrl] : []),
          ...(fc.answerImageUrls ?? []),
        ],
        { prefix: `videos/${videoId}/answers` }
      );
  const [first, ...rest] = flat;
  return {
    ...fc,
    answerParts: parts,
    answerImageUrl: first,
    answerImageUrls: rest.length ? rest : undefined,
  };
}

async function persistReport(
  report: TypedReport,
  videoId: string
): Promise<TypedReport> {
  const imgPrefix = reportImagePrefix(videoId);
  const imageRoom = [];
  for (const entry of report.imageRoom ?? []) {
    if (typeof entry === "string") {
      imageRoom.push(
        await persistMediaDataUrl(entry, { prefix: imgPrefix })
      );
      continue;
    }
    imageRoom.push({
      ...entry,
      url: await persistMediaDataUrl(entry.url, {
        prefix: imgPrefix,
      }),
    });
  }
  const sections = [];
  for (const s of report.sections) {
    const images = await persistMediaUrls(s.images, {
      prefix: imgPrefix,
      keepEmptySlots: true,
    });
    const imageUrl = s.imageUrl
      ? await persistMediaDataUrl(s.imageUrl, {
          prefix: imgPrefix,
        })
      : undefined;
    const entries = [];
    for (const e of s.entries ?? []) {
      const parts = await persistParts(
        e.answerParts,
        imgPrefix
      );
      const flat = (parts ?? []).flatMap((p) => p.imageUrls ?? []);
      const answerUrls = flat.length
        ? flat
        : await persistMediaUrls(
            [
              ...(e.answerImageUrl ? [e.answerImageUrl] : []),
              ...(e.answerImageUrls ?? []),
            ],
            { prefix: imgPrefix }
          );
      const [a0, ...arest] = answerUrls;
      entries.push({
        ...e,
        imageUrl: e.imageUrl
          ? await persistMediaDataUrl(e.imageUrl, {
              prefix: imgPrefix,
            })
          : undefined,
        answerParts: parts,
        answerImageUrl: a0,
        answerImageUrls: arest.length ? arest : undefined,
      });
    }
    // HTML body 안의 data:image 도 교체
    let body = s.body;
    if (body && body.includes("data:image/")) {
      const matches = body.match(/data:image\/[a-zA-Z+]+;base64,[A-Za-z0-9+/=]+/g) ?? [];
      for (const dataUrl of matches) {
        const url = await persistMediaDataUrl(dataUrl, {
          prefix: imgPrefix,
        });
        body = body.split(dataUrl).join(url);
      }
    }
    sections.push({
      ...s,
      body,
      imageUrl,
      images: images.length ? images : undefined,
      entries: entries.length ? entries : undefined,
    });
  }

  const factChecks = [];
  for (const f of report.factChecks ?? []) {
    const parts = await persistParts(
      f.answerParts,
      `videos/${videoId}/report-fc`
    );
    const flat = (parts ?? []).flatMap((p) => p.imageUrls ?? []);
    const urls = flat.length
      ? flat
      : await persistMediaUrls(
          [
            ...(f.answerImageUrl ? [f.answerImageUrl] : []),
            ...(f.answerImageUrls ?? []),
          ],
          { prefix: `videos/${videoId}/report-fc` }
        );
    const [first, ...rest] = urls;
    factChecks.push({
      ...f,
      answerParts: parts,
      answerImageUrl: first,
      answerImageUrls: rest.length ? rest : undefined,
    });
  }

  return { ...report, imageRoom, sections, factChecks };
}

/** 인포그래픽 SVG를 외부 저장하고 svgUrl만 남김 */
export async function persistInfographic(
  info: InfographicData | null,
  videoId: string
): Promise<InfographicData | null> {
  if (!info) return null;
  if (info.svgUrl && !info.svgMarkup) return info;
  if (!info.svgMarkup) return info;

  try {
    const dataUrl = `data:image/svg+xml;base64,${Buffer.from(
      info.svgMarkup,
      "utf8"
    ).toString("base64")}`;
    const svgUrl = await persistMediaDataUrl(dataUrl, {
      prefix: `videos/${videoId}/infographic`,
      filenameHint: "infographic",
    });

    return {
      ...info,
      svgUrl,
      // DB JSON 폭증 방지 — 외부 URL로 대체
      svgMarkup: "",
    };
  } catch (e) {
    console.warn("[media-store] infographic persist failed", e);
    // 보고서 완료는 막지 않음 — GET ?rebuild=1 / 인포그래픽 만들기로 재시도
    const tooBig = info.svgMarkup.length > 400_000;
    return {
      ...info,
      svgUrl: info.svgUrl,
      svgMarkup: tooBig ? "" : info.svgMarkup,
    };
  }
}

/**
 * VideoRecord 안의 data URL 이미지를 전부 외부 URL로 치환.
 * upsert 직전에 호출해 compact가 이미지를 지우지 않게 함.
 */
export async function externalizeVideoMedia(
  video: VideoRecord
): Promise<VideoRecord> {
  const items: SummaryItem[] = [];
  for (const item of video.items) {
    items.push(await persistItem(item, video.id));
  }
  const factChecks: FactCheckResult[] = [];
  for (const fc of video.factChecks) {
    factChecks.push(await persistFactCheck(fc, video.id));
  }
  const report = video.report
    ? await persistReport(video.report, video.id)
    : null;
  const infographic = await persistInfographic(video.infographic, video.id);

  return {
    ...video,
    items,
    factChecks,
    report,
    infographic,
  };
}

/** 로컬 미디어 파일 읽기 (API 라우트용) */
export function readLocalMedia(encodedKey: string): {
  buffer: Buffer;
  contentType: string;
} | null {
  const key = decodeURIComponent(encodedKey);
  if (!key || key.includes("..") || path.isAbsolute(key)) return null;
  const root = path.resolve(mediaDir());
  const filePath = path.resolve(root, key);
  if (!filePath.startsWith(root + path.sep) && filePath !== root) return null;
  if (!fs.existsSync(filePath)) return null;
  const buffer = fs.readFileSync(filePath);
  const ext = path.extname(key).toLowerCase();
  const contentType =
    ext === ".png"
      ? "image/png"
      : ext === ".webp"
        ? "image/webp"
        : ext === ".gif"
          ? "image/gif"
          : ext === ".svg"
            ? "image/svg+xml"
            : "image/jpeg";
  return { buffer, contentType };
}
