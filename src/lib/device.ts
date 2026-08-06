/** iPhone / iPad (터치 Mac 포함) — HTML 붙여넣기 charset 깨짐 회피용 */
export function preferPlainPaste(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  // iPadOS 13+ 는 Mac처럼 보이지만 터치
  if (navigator.platform === "MacIntel" && (navigator.maxTouchPoints ?? 0) > 1) {
    return true;
  }
  return false;
}
