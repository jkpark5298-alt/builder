/** 단일 URL + 배열을 하나의 목록으로 (중복·빈값 제거). 첫 장(single)을 우선 */
export function normalizeImageUrls(
  single?: string | null,
  list?: string[] | null
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const url of [single ?? "", ...(list ?? [])]) {
    const u = url?.trim();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

/**
 * 저장용: 첫 장은 imageUrl, 나머지는 imageUrls.
 * imageUrls에는 첫 장을 넣지 않는다 (중복 base64 방지).
 */
export function splitPrimaryImage(urls: string[]): {
  imageUrl?: string;
  imageUrls?: string[];
} {
  const clean = normalizeImageUrls(undefined, urls);
  if (!clean.length) return {};
  const [first, ...rest] = clean;
  return {
    imageUrl: first,
    imageUrls: rest.length ? rest : undefined,
  };
}
