/** Open Gemini / Daglo after copying text (iPhone Safari–friendly). */

export type ExternalAppId = "gemini" | "daglo";

export const EXTERNAL_APP_LABEL: Record<ExternalAppId, string> = {
  gemini: "제미나이",
  daglo: "다글로",
};

/** Gemini standalone app. Do not chain extra schemes — a failed one blocks Safari. */
export const GEMINI_IOS_SCHEME = "googlegemini://";

export const GEMINI_WEB_URL = "https://gemini.google.com/app";

/**
 * Android Intent: open the Gemini app, or the website if it is not installed.
 * Play package is still `com.google.android.apps.bard`.
 */
export const GEMINI_ANDROID_INTENT =
  "intent://#Intent;scheme=googlegemini;package=com.google.android.apps.bard;S.browser_fallback_url=https%3A%2F%2Fgemini.google.com%2Fapp;end";

/**
 * Daglo Universal Link host (`apple-app-site-association` paths: "*").
 * `/home` returns 422, so use the site root.
 */
export const DAGLO_WEB_URL = "https://daglo.ai/";

export const DAGLO_ANDROID_INTENT =
  "intent://#Intent;scheme=https;authority=daglo.ai;package=ai.daglo.mobile;S.browser_fallback_url=https%3A%2F%2Fdaglo.ai%2F;end";

export function externalAppWebUrl(app: ExternalAppId) {
  return app === "gemini" ? GEMINI_WEB_URL : DAGLO_WEB_URL;
}

export type ExternalAppLaunchEnv = {
  mobile: boolean;
  android: boolean;
};

export function detectExternalAppLaunchEnv(): ExternalAppLaunchEnv {
  if (typeof navigator === "undefined") {
    return { mobile: false, android: false };
  }
  const ua = navigator.userAgent || "";
  const android = /Android/i.test(ua);
  const iPadOs =
    navigator.platform === "MacIntel" && (navigator.maxTouchPoints || 0) > 1;
  const mobile = android || /iPhone|iPad|iPod/i.test(ua) || iPadOs;
  return { mobile, android };
}

/** Href used for a same-tap launch. Desktop Gemini/Daglo open this in a new tab. */
export function externalAppLaunchHref(
  app: ExternalAppId,
  env: ExternalAppLaunchEnv
) {
  if (app === "daglo") {
    return env.android ? DAGLO_ANDROID_INTENT : DAGLO_WEB_URL;
  }
  if (env.android) return GEMINI_ANDROID_INTENT;
  if (env.mobile) return GEMINI_IOS_SCHEME;
  return GEMINI_WEB_URL;
}

function openHrefInUserGesture(href: string, newTab: boolean) {
  if (newTab) {
    const opened = window.open(href, "_blank", "noopener,noreferrer");
    if (opened) return;
  }

  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.rel = "noopener noreferrer";
  if (newTab) anchor.target = "_blank";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/**
 * Must run in the same tap as the button. Waiting on clipboard or a timer
 * drops the user gesture, and iOS then blocks custom schemes / window.open.
 */
export function launchExternalApp(app: ExternalAppId) {
  if (typeof window === "undefined") return;
  const env = detectExternalAppLaunchEnv();
  const href = externalAppLaunchHref(app, env);
  const newTab = !env.mobile;
  openHrefInUserGesture(href, newTab);
}
