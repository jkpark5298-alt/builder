/** 압축된 data URL / File → 서버 미디어 저장소 URL (multipart 우선) */
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

  // multipart: data URL → Blob (JSON base64보다 요청 작음)
  try {
    const resBlob = await fetch(dataUrl);
    const blob = await resBlob.blob();
    if (blob.size > 0) {
      const form = new FormData();
      form.append("file", blob, "image.jpg");
      form.append("prefix", prefix);
      const res = await fetch("/api/media/upload", {
        method: "POST",
        body: form,
      });
      const data = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (res.ok && data.url) return data.url;
      if (!res.ok) {
        throw new Error(data.error || `이미지 업로드 실패 (HTTP ${res.status})`);
      }
    }
  } catch (e) {
    // multipart 실패 시 JSON 폴백
    if (e instanceof Error && /이미지 업로드 실패/.test(e.message)) throw e;
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

/** 제거된 룸/슬롯 URL이 고아면 서버에서 파일 삭제 */
export async function releaseMediaUrls(urls: string[]): Promise<void> {
  const list = urls.map((u) => u.trim()).filter(Boolean);
  if (!list.length) return;
  try {
    await fetch("/api/media/release", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls: list }),
    });
  } catch {
    /* best-effort */
  }
}
