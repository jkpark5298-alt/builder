/** 압축된 data URL → 서버 미디어 저장소 URL */
export async function uploadDataUrl(
  dataUrl: string,
  prefix = "uploads"
): Promise<string> {
  if (!dataUrl) return dataUrl;
  if (
    dataUrl.startsWith("http://") ||
    dataUrl.startsWith("https://") ||
    dataUrl.startsWith("/api/media/")
  ) {
    return dataUrl;
  }
  if (!dataUrl.startsWith("data:image/")) {
    return dataUrl;
  }

  const res = await fetch("/api/media/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataUrl, prefix }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    url?: string;
    error?: string;
  };
  if (!res.ok || !data.url) {
    throw new Error(data.error || `이미지 업로드 실패 (HTTP ${res.status})`);
  }
  return data.url;
}

export async function uploadDataUrls(
  urls: string[],
  prefix = "uploads"
): Promise<string[]> {
  const out: string[] = [];
  for (const u of urls) {
    if (!u?.trim()) continue;
    out.push(await uploadDataUrl(u.trim(), prefix));
  }
  return out;
}
