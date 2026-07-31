/** 사용자 #태그 정규화·표시 (시스템 VideoRecord.tags 와 분리) */

/** "#조선, 임진왜란 #광해군" → ["조선", "임진왜란", "광해군"] */
export function parseTagInput(raw: string): string[] {
  if (!raw?.trim()) return [];
  const parts = raw
    .split(/[,，\s]+/)
    .map((p) => normalizeTag(p))
    .filter(Boolean);
  return Array.from(new Set(parts));
}

/** 단일 태그 정규화: 앞뒤 #·공백 제거 */
export function normalizeTag(raw: string): string {
  return raw
    .trim()
    .replace(/^#+/, "")
    .replace(/#$/, "")
    .trim();
}

export function normalizeTagList(tags: string[] | undefined | null): string[] {
  if (!tags?.length) return [];
  return Array.from(
    new Set(tags.map(normalizeTag).filter(Boolean))
  );
}

/** 화면 표시용 "#조선" */
export function formatTag(tag: string): string {
  const t = normalizeTag(tag);
  return t ? `#${t}` : "";
}

export function formatTagList(tags: string[] | undefined | null): string {
  return normalizeTagList(tags)
    .map(formatTag)
    .filter(Boolean)
    .join(" ");
}

/** 제목 → 주제 themeTag (공백 제거) */
export function themeTagFromTitle(title: string): string {
  return normalizeTag(title.replace(/\s+/g, ""));
}

/** entry가 선택한 태그 중 하나라도 가지면 true. 선택 태그 없으면 전부 */
export function entryMatchesComposeTags(
  userTags: string[] | undefined,
  selected: string[]
): boolean {
  const selectedNorm = normalizeTagList(selected);
  if (!selectedNorm.length) return true;
  const entry = new Set(normalizeTagList(userTags));
  return selectedNorm.some((t) => entry.has(t));
}

/** 주제에 연결된 항목 중 태그로 자동 선별 (작성일 오름차순) */
export function selectEntriesByTags<
  T extends { userTags?: string[]; createdAt: string },
>(entries: T[], selectedTags: string[]): T[] {
  return entries
    .filter((e) => entryMatchesComposeTags(e.userTags, selectedTags))
    .sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
}

/** 항목들의 사용자 태그 목록 (빈도순) */
export function collectEntryTags(
  entries: Array<{ userTags?: string[] }>
): string[] {
  const counts = new Map<string, number>();
  for (const e of entries) {
    for (const t of normalizeTagList(e.userTags)) {
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"))
    .map(([t]) => t);
}
