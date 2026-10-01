/** Hosts we may fetch when attaching a preview image from 메타 보기. */

function hostnameOf(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function isAllowedRemoteImageUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (!host || host === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    return false;
  }
  if (host === "instagram.com" || host.endsWith(".instagram.com")) return true;
  if (host === "cdninstagram.com" || host.endsWith(".cdninstagram.com")) {
    return true;
  }
  if (host === "fbcdn.net" || host.endsWith(".fbcdn.net")) return true;
  if (host.endsWith(".fbsbx.com")) return true;
  if (host.endsWith(".vercel-storage.com")) return true;
  if (host.endsWith(".supabase.co") && parsed.pathname.includes("/storage/")) {
    return true;
  }
  return false;
}

/** Page we may open to read og:title / og:image (Instagram + public mirrors). */
export function isAllowedMetaPageUrl(value: string): boolean {
  const host = hostnameOf(value);
  if (!host) return false;
  if (host === "instagram.com" || host.endsWith(".instagram.com")) return true;
  if (host === "instagr.am" || host.endsWith(".instagr.am")) return true;
  if (host === "ddinstagram.com" || host.endsWith(".ddinstagram.com")) return true;
  if (host === "kkinstagram.com" || host.endsWith(".kkinstagram.com")) return true;
  if (host === "imginn.com" || host.endsWith(".imginn.com")) return true;
  return false;
}

export function resolveAllowedRedirect(
  current: string,
  location: string,
): string | null {
  if (!location.trim()) return null;
  try {
    const next = new URL(location, current).href;
    return isAllowedRemoteImageUrl(next) ? next : null;
  } catch {
    return null;
  }
}
