import fs from "fs";
import path from "path";
import { databaseUrl, ensureSchema, hasDatabase, sql } from "./db";
import { getVideo, readAllVideos, upsertVideo } from "./store";
import { APP_FILE_TAG, isAppFileItem, type AppFileListItem } from "./archive-app-file";
import type { InputMode } from "./types";

export type AppFileCatalogEntry = {
  id: string;
  title: string;
  inputMode: InputMode;
  importedAt: string;
};

export type { AppFileListItem };

function readEnv(name: string): string | undefined {
  const v = (process.env as Record<string, string | undefined>)[name];
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length ? t : undefined;
}

function onVercel(): boolean {
  return Boolean(readEnv("VERCEL") || readEnv("AWS_LAMBDA_FUNCTION_NAME"));
}

function catalogFile(): string {
  const dir = onVercel()
    ? path.join("/tmp", "youtube-factcheck", "data")
    : path.join(process.cwd(), "data");
  return path.join(dir, "app-files.json");
}

function readLocalCatalog(): AppFileCatalogEntry[] {
  const file = catalogFile();
  try {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, JSON.stringify({ items: [] }, null, 2), "utf-8");
      return [];
    }
    const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as {
      items?: AppFileCatalogEntry[];
    };
    return Array.isArray(raw.items) ? raw.items : [];
  } catch {
    return [];
  }
}

function writeLocalCatalog(items: AppFileCatalogEntry[]) {
  const file = catalogFile();
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ items }, null, 2), "utf-8");
}

async function readDbCatalog(): Promise<AppFileCatalogEntry[]> {
  await ensureSchema();
  const db = sql();
  await db`
    CREATE TABLE IF NOT EXISTS app_file_index (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      input_mode TEXT NOT NULL,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  const rows = (await db`
    SELECT id, title, input_mode, imported_at
    FROM app_file_index
    ORDER BY imported_at DESC
  `) as Array<{
    id: string;
    title: string;
    input_mode: string;
    imported_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    inputMode: r.input_mode === "youtube" ? "youtube" : "report",
    importedAt: r.imported_at,
  }));
}

async function writeDbEntry(entry: AppFileCatalogEntry) {
  await ensureSchema();
  const db = sql();
  await db`
    CREATE TABLE IF NOT EXISTS app_file_index (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      input_mode TEXT NOT NULL,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await db`
    INSERT INTO app_file_index (id, title, input_mode, imported_at)
    VALUES (${entry.id}, ${entry.title}, ${entry.inputMode}, ${entry.importedAt}::timestamptz)
    ON CONFLICT (id)
    DO UPDATE SET title = EXCLUDED.title, input_mode = EXCLUDED.input_mode
  `;
}

export async function recordAppFileImport(entry: AppFileCatalogEntry) {
  if (hasDatabase()) {
    try {
      await writeDbEntry(entry);
      return;
    } catch (e) {
      if (onVercel() || databaseUrl()) {
        console.warn("[app-file-catalog] db write failed", e);
        if (onVercel()) throw e;
      }
    }
  }
  const items = readLocalCatalog().filter((x) => x.id !== entry.id);
  items.unshift(entry);
  writeLocalCatalog(items);
}

export async function markAppFileSaved(id: string) {
  const video = await getVideo(id);
  if (!video) {
    throw new Error("항목을 찾을 수 없습니다.");
  }
  const tags = Array.from(new Set([...(video.tags ?? []), APP_FILE_TAG]));
  const saved =
    tags.length === (video.tags ?? []).length
      ? video
      : await upsertVideo({
          ...video,
          tags,
          updatedAt: new Date().toISOString(),
        });
  await recordAppFileImport({
    id: saved.id,
    title: saved.title,
    inputMode: saved.inputMode === "youtube" ? "youtube" : "report",
    importedAt: new Date().toISOString(),
  });
  return saved;
}

async function readCatalog(): Promise<AppFileCatalogEntry[]> {
  if (hasDatabase()) {
    try {
      return await readDbCatalog();
    } catch (e) {
      if (onVercel()) throw e;
      console.warn("[app-file-catalog] db read failed → local", e);
    }
  }
  return readLocalCatalog();
}

export async function listAppFileItems(
  scope?: "youtube" | "report"
): Promise<AppFileListItem[]> {
  const catalog = await readCatalog();
  const videos = await readAllVideos();
  const byId = new Map(videos.map((v) => [v.id, v]));

  const merged = [...catalog];
  for (const video of videos) {
    if (!isAppFileItem(video)) continue;
    if (merged.some((x) => x.id === video.id)) continue;
    merged.push({
      id: video.id,
      title: video.title,
      inputMode: video.inputMode === "youtube" ? "youtube" : "report",
      importedAt: video.createdAt,
    });
    await recordAppFileImport(merged[merged.length - 1]!);
  }

  const scoped = scope
    ? merged.filter((x) =>
        scope === "youtube" ? x.inputMode === "youtube" : x.inputMode !== "youtube"
      )
    : merged;

  scoped.sort(
    (a, b) => new Date(b.importedAt).getTime() - new Date(a.importedAt).getTime()
  );

  return scoped.map((entry) => {
    const live = byId.get(entry.id);
    const exists = Boolean(live);
    const title = (live?.title || entry.title || "제목 없음").trim();
    const href = exists ? `/videos/${entry.id}` : null;
    return { ...entry, title, exists, href };
  });
}
