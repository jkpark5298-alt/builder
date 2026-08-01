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

export function normalizeReportImageRefs(report: TypedReport): TypedReport {
  let room = normalizeRoomItems(report.imageRoom);
  let changed = room.length !== (report.imageRoom?.length ?? 0);

  const sections = report.sections.map((sec) => {
    // S 슬롯 순서 보존: images[i] 빈 칸("") 유지
    const orderedSlotImages = (sec.images ?? []).map((u) => (u || "").trim());
    const hasSlotOrder = orderedSlotImages.length > 0;
    const legacyUrls = normalizeImageUrls(
      sec.imageUrl,
      hasSlotOrder ? orderedSlotImages.filter(Boolean) : sec.images
    );
    if (!legacyUrls.length && !(sec.imageRefs?.length ?? 0)) return sec;
    const next = upsertRoomUrls(room, legacyUrls);
    room = next.room;
    const byUrl = new Map(next.room.map((item) => [item.url, item.id]));
    const imageRefs = hasSlotOrder
      ? orderedSlotImages
          .map((u) => (u ? byUrl.get(u) : undefined))
          .filter(Boolean) as string[]
      : Array.from(new Set([...(sec.imageRefs ?? []), ...next.refs]));
    if (
      !legacyUrls.length &&
      imageRefs.join("|") === (sec.imageRefs ?? []).join("|") &&
      !sec.imageUrl &&
      !(sec.images?.length ?? 0)
    ) {
      return sec;
    }
    changed = true;
    return {
      ...sec,
      imageUrl: undefined,
      // 슬롯 정렬용 images 유지 (빈 문자열 포함)
      images: hasSlotOrder ? orderedSlotImages : undefined,
      imageRefs: imageRefs.length ? imageRefs : undefined,
    };
  });

  if (!changed) return report;
  return {
    ...report,
    imageRoom: room,
    sections,
  };
}

