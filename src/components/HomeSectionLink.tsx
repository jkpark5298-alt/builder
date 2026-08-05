"use client";

import type { MouseEvent, ReactNode } from "react";

/**
 * 홈 섹션 앵커 — 이미 `/` 에 있으면 전체 이동 없이 스크롤만.
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
    if (!onHome) return;

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
