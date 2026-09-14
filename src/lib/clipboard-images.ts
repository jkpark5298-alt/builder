export function imageFilesFromClipboard(data: DataTransfer | null): File[] {
  if (!data) return [];
  const out: File[] = [];
  const seen = new Set<string>();
  const push = (file: File | null) => {
    if (!file || file.size === 0) return;
    const ok =
      !file.type ||
      file.type.startsWith("image/") ||
      /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(file.name);
    if (!ok) return;
    const key = `${file.name}:${file.size}:${file.lastModified}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(file);
  };
  for (const file of Array.from(data.files || [])) push(file);
  if (out.length > 0) return out;
  for (const item of Array.from(data.items || [])) {
    if (!item.type.startsWith("image/")) continue;
    push(item.getAsFile());
  }
  return out;
}
