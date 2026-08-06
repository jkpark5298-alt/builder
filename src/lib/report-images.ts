import type { ReportSectionBlock, TypedReport } from "./types";
import { normalizeImageUrls } from "./image-urls";

export type RoomImageItem = {
  id: string;
  url: string;
  tag?: string;
  note?: string;
};

function nextRoomImageId(n: number): string {
  return `img_${n.toString(36)}`;
}

export function normalizeRoomItems(raw: TypedReport["imageRoom"]): RoomImageItem[] {
  const out: RoomImageItem[] = [];
  const seenUrls = new Set<string>();
  const seenIds = new Set<string>();
  let seq = 1;
  for (const entry of raw ?? []) {
    const base =
      typeof entry === "string"
        ? { url: entry }
        : { id: entry.id, url: entry.url, tag: entry.tag, note: entry.note };
    const url = base.url?.trim();
    if (!url || seenUrls.has(url)) continue;
    let id = base.id?.trim();
    if (!id || seenIds.has(id)) {
      do {
        id = nextRoomImageId(seq++);
      } while (seenIds.has(id));
    }
    seenIds.add(id);
    seenUrls.add(url);
    out.push({ id, url, tag: base.tag, note: base.note });
  }
  return out;
}

export function upsertRoomUrls(
  raw: TypedReport["imageRoom"],
  urls: string[]
): { room: RoomImageItem[]; refs: string[] } {
  const room = normalizeRoomItems(raw);
  const byUrl = new Map(room.map((item) => [item.url, item]));
  let seq = room.length + 1;
  const refs: string[] = [];

  for (const url of normalizeImageUrls(undefined, urls)) {
    let item = byUrl.get(url);
    if (!item) {
      let id = nextRoomImageId(seq++);
      while (room.some((existing) => existing.id === id)) {
        id = nextRoomImageId(seq++);
      }
      item = { id, url };
      room.push(item);
      byUrl.set(url, item);
    }
    refs.push(item.id);
  }

  return {
    room,
    refs: Array.from(new Set(refs)),
  };
}

export function resolveRoomUrls(
  raw: TypedReport["imageRoom"],
  refs?: string[]
): string[] {
  const room = normalizeRoomItems(raw);
  const byId = new Map(room.map((item) => [item.id, item.url]));
  const refUrls = (refs ?? []).map((ref) => byId.get(ref)).filter(Boolean) as string[];
  return Array.from(new Set(refUrls));
}

export function collectSectionImages(
  sec: ReportSectionBlock,
  room?: TypedReport["imageRoom"]
): string[] {
  return Array.from(
    new Set([
      ...normalizeImageUrls(sec.imageUrl, sec.images),
      ...resolveRoomUrls(room, sec.imageRefs),
    ])
  );
}

/** S 칸 개수 (본문 마커 · refs · 레거시 images 중 최대) */
export function sectionSlotCapacity(
  sec: ReportSectionBlock,
  bodySlotCount: number
): number {
  return Math.max(
    bodySlotCount,
    sec.imageRefs?.length ?? 0,
    sec.images?.length ?? 0
  );
}

/**
 * 슬롯 URL 해석: imageRefs→room 우선, 빈 칸은 레거시 images[]로 보완.
 */
export function orderedSlotUrls(
  sec: ReportSectionBlock,
  room: TypedReport["imageRoom"] | undefined,
  slotCount: number
): string[] {
  const out: string[] = Array.from({ length: slotCount }, () => "");
  const items = normalizeRoomItems(room);
  const byId = new Map(items.map((it) => [it.id, it.url]));
  const refs = sec.imageRefs ?? [];
  const stored = sec.images ?? [];
  const hasRefs = refs.some((r) => Boolean(r?.trim()));

  if (hasRefs || refs.length > 0) {
    for (let i = 0; i < slotCount; i++) {
      const id = (refs[i] || "").trim();
      out[i] = (id && byId.get(id)) || "";
    }
    for (let i = 0; i < slotCount; i++) {
      if (!out[i] && (stored[i] || "").trim()) {
        out[i] = (stored[i] || "").trim();
      }
    }
    return out;
  }

  for (let i = 0; i < slotCount; i++) {
    out[i] = (stored[i] || "").trim();
  }
  if (sec.imageUrl?.trim() && !out[0]) {
    out[0] = sec.imageUrl.trim();
  }
  return out;
}

/**
 * 슬롯 URL → 룸 upsert + 섹션은 imageRefs만 저장 (refs-only).
 */
export function bindSectionSlotUrls(
  sec: ReportSectionBlock,
  room: TypedReport["imageRoom"] | undefined,
  orderedUrls: string[],
  patch?: Partial<ReportSectionBlock>
): { room: RoomImageItem[]; section: ReportSectionBlock } {
  const ordered = orderedUrls.map((u) => (u || "").trim());
  const filled = ordered.filter(Boolean);
  const { room: nextRoom } = upsertRoomUrls(room, filled);
  const byUrl = new Map(
    normalizeRoomItems(nextRoom).map((it) => [it.url, it.id])
  );
  const imageRefs = ordered.map((u) => (u ? byUrl.get(u) || "" : ""));
  return {
    room: nextRoom,
    section: {
      ...sec,
      ...patch,
      imageUrl: undefined,
      images: undefined,
      imageRefs: imageRefs.some(Boolean) ? imageRefs : undefined,
    },
  };
}

/** 레거시 images[] → imageRefs 이관 후 images 제거 */
export function normalizeReportImageRefs(report: TypedReport): TypedReport {
  let room = normalizeRoomItems(report.imageRoom);
  let changed = room.length !== (report.imageRoom?.length ?? 0);

  const sections = report.sections.map((sec) => {
    const orderedSlotImages = (sec.images ?? []).map((u) => (u || "").trim());
    const hasSlotOrder = orderedSlotImages.length > 0;
    const legacyUrls = normalizeImageUrls(
      sec.imageUrl,
      hasSlotOrder ? orderedSlotImages.filter(Boolean) : sec.images
    );

    // 이미 refs-only 이고 레거시 없음
    if (
      !legacyUrls.length &&
      !sec.imageUrl &&
      !(sec.images?.length ?? 0) &&
      (sec.imageRefs?.length ?? 0) > 0
    ) {
      return sec;
    }

    if (!legacyUrls.length && !(sec.imageRefs?.length ?? 0)) return sec;

    const next = upsertRoomUrls(room, legacyUrls);
    room = next.room;
    const byUrl = new Map(next.room.map((item) => [item.url, item.id]));

    let imageRefs: string[];
    if (hasSlotOrder) {
      imageRefs = orderedSlotImages.map((u) => (u ? byUrl.get(u) || "" : ""));
    } else if ((sec.imageRefs?.length ?? 0) > 0) {
      imageRefs = [...(sec.imageRefs ?? [])];
      for (const id of next.refs) {
        if (!imageRefs.includes(id)) imageRefs.push(id);
      }
    } else {
      imageRefs = next.refs;
    }

    const nextRefs = imageRefs.some(Boolean) ? imageRefs : undefined;
    if (
      !sec.imageUrl &&
      !(sec.images?.length ?? 0) &&
      (sec.imageRefs ?? []).join("|") === (nextRefs ?? []).join("|")
    ) {
      return sec;
    }
    changed = true;
    return {
      ...sec,
      imageUrl: undefined,
      images: undefined,
      imageRefs: nextRefs,
    };
  });

  if (!changed) return report;
  return {
    ...report,
    imageRoom: room,
    sections,
  };
}

/** 본문 슬롯·레거시 필드에서 참조 중인 룸 id / URL */
export function collectReferencedRoomKeys(report: TypedReport): {
  ids: Set<string>;
  urls: Set<string>;
} {
  const ids = new Set<string>();
  const urls = new Set<string>();
  const room = normalizeRoomItems(report.imageRoom);
  const byId = new Map(room.map((it) => [it.id, it.url]));
  for (const sec of report.sections) {
    if (sec.imageUrl?.trim()) urls.add(sec.imageUrl.trim());
    for (const u of sec.images ?? []) {
      if (u?.trim()) urls.add(u.trim());
    }
    for (const ref of sec.imageRefs ?? []) {
      if (ref?.trim()) {
        ids.add(ref.trim());
        const url = byId.get(ref.trim());
        if (url) urls.add(url);
      }
    }
  }
  return { ids, urls };
}

/**
 * 본문에서 쓰이지 않는 룸 항목만 제거 (파일 GC는 별도 release).
 */
export function pruneUnreferencedRoomItems(report: TypedReport): {
  report: TypedReport;
  removed: number;
  removedUrls: string[];
} {
  const room = normalizeRoomItems(report.imageRoom);
  const { ids, urls } = collectReferencedRoomKeys(report);
  const kept: RoomImageItem[] = [];
  const removedUrls: string[] = [];
  for (const it of room) {
    if (ids.has(it.id) || urls.has(it.url)) kept.push(it);
    else removedUrls.push(it.url);
  }
  const removed = removedUrls.length;
  if (!removed) return { report, removed: 0, removedUrls: [] };
  return {
    report: { ...report, imageRoom: kept },
    removed,
    removedUrls,
  };
}

export function countUnreferencedRoomItems(report: TypedReport): number {
  return pruneUnreferencedRoomItems(report).removed;
}
