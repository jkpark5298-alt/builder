/** iPhone Safari 등 Clipboard API 실패 시 textarea + execCommand 폴백 */

function copyViaExecCommand(text: string): boolean {
  if (typeof document === "undefined") return false;
  const el = document.createElement("textarea");
  el.value = text;
  el.setAttribute("readonly", "");
  // iOS: 화면 밖·투명이면 복사가 막히는 경우가 있어 최소 크기로 유지
  el.style.cssText =
    "position:fixed;top:0;left:0;width:1px;height:1px;padding:0;margin:0;border:0;opacity:0.01;font-size:16px;";
  document.body.appendChild(el);

  const prevActive = document.activeElement as HTMLElement | null;
  el.focus();
  el.select();
  el.setSelectionRange(0, text.length);

  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  } finally {
    document.body.removeChild(el);
    prevActive?.focus?.();
  }
  return ok;
}

/**
 * 클립보드에 텍스트 복사.
 * @returns true면 성공, false면 자동 복사 실패(수동 선택 UI 필요)
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  const value = text ?? "";
  if (!value) return false;

  // iOS는 사용자 제스처 직후 sync execCommand가 더 안정적
  if (copyViaExecCommand(value)) return true;

  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // fall through
  }

  // writeText 실패 후 한 번 더 폴백
  return copyViaExecCommand(value);
}
