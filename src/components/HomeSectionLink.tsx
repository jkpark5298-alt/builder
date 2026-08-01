"use client";

import type { MouseEvent, ReactNode } from "react";

const RETURN_KEY = "ycf:return-after-images";

/**
 * 홈 섹션 앵커 — 이미 `/` 에 있으면 전체 이동 없이 스크롤만.
 * `/#images` 전체 이동은 Next가 페이지를 다시 그려 맨 위(입력 탭)로 떨어지는 경우가 많음.
 */
export function HomeSectionLink({
  hash,
  children,
  className,
}: {
  hash: string;
  children: ReactNode;
  className?: string;
}) {
  const id = hash.replace(/^#/, "");

  function go(e: MouseEvent<HTMLAnchorElement>) {
    if (typeof window === "undefined") return;
    const onHome =
      window.location.pathname === "/" || window.location.pathname === "";
    if (!onHome) {
      // 보고서 등에서 「이미지」를 누르면 돌아올 경로를 기억
      if (id === "images") {
        try {
          sessionStorage.setItem(
            RETURN_KEY,
            `${window.location.pathname}${window.location.hash}`
          );
        } catch {
          /* ignore */
        }
      }
      return;
    }

    e.preventDefault();
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    window.history.replaceState(null, "", `/#${id}`);
  }

  return (
    <a href={`/#${id}`} className={className} onClick={go}>
      {children}
    </a>
  );
}

export function peekImageLibraryReturnPath(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sessionStorage.getItem(RETURN_KEY);
  } catch {
    return null;
  }
}

export function clearImageLibraryReturnPath() {
  try {
    sessionStorage.removeItem(RETURN_KEY);
  } catch {
    /* ignore */
  }
}
