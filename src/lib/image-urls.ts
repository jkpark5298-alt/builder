/** 단일 URL + 배열을 하나의 목록으로 (중복·빈값 제거) */
export function normalizeImageUrls(
  single?: string | null,
  list?: string[] | null
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const url of [...(list ?? []), single ?? ""]) {
    const u = url?.trim();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

/** 저장용: 첫 장은 imageUrl, 나머지는 imageUrls */
export function splitPrimaryImage(urls: string[]): {
  imageUrl?: string;
  imageUrls?: string[];
} {
  const clean = urls.filter(Boolean);
  if (!clean.length) return {};
  const [first, ...rest] = clean;
  return {
    imageUrl: first,
    imageUrls: rest.length ? rest : undefined,
  };
}
