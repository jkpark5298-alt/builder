/** 정보 보관소 입력: 첫 줄 임시 제목 · 저장 시각 표시 */

export function archiveDateLabel(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
}

/** 본문 첫 비어 있지 않은 줄. URL이면 날짜 라벨. 최대 40자. */
export function tempTitleFromPlain(plain: string, now = new Date()): string {
  const line =
    plain
      .split(/\n/)
      .map((part) => part.trim())
      .find((part) => part && part !== "[이미지]" && !/^\[S\d*\]$/.test(part)) ||
    "";
  if (!line || /^https?:\/\//i.test(line)) {
    return `임시 ${now.getFullYear()}.${now.getMonth() + 1}.${now.getDate()}`;
  }
  return line.length > 40 ? line.slice(0, 40) : line;
}

export function plainForArchive(plain: string): string {
  return plain
    .replace(/\r\n/g, "\n")
    .replace(/\[이미지\]/g, "")
    .replace(/\[S\d*\]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
