"use client";

import { useEffect, useState } from "react";
import { BookOpen, Minus, Plus, X } from "lucide-react";
import type { ReaderDoc } from "@/lib/reader-view";
import { READER_PDF_FONT_FAMILY } from "@/lib/reader-view";

const PREF_KEY = "yfc-reader-prefs-v1";
const FONT_STEPS = [17, 19, 21, 23, 26] as const;
type Theme = "paper" | "light" | "dark";

type Prefs = { theme: Theme; fontIdx: number };

function loadPrefs(): Prefs {
  if (typeof window === "undefined") return { theme: "paper", fontIdx: 1 };
  try {
    const raw = localStorage.getItem(PREF_KEY);
    const p = raw ? (JSON.parse(raw) as Partial<Prefs>) : {};
    const fontIdx = Math.min(
      FONT_STEPS.length - 1,
      Math.max(0, Number(p.fontIdx) || 1)
    );
    const theme: Theme =
      p.theme === "light" || p.theme === "dark" || p.theme === "paper"
        ? p.theme
        : "paper";
    return { theme, fontIdx };
  } catch {
    return { theme: "paper", fontIdx: 1 };
  }
}

const THEME: Record<
  Theme,
  { bg: string; fg: string; muted: string; bar: string; img: string }
> = {
  paper: {
    bg: "#f4ecd8",
    fg: "#3b2f2f",
    muted: "#6b5e4e",
    bar: "rgba(244,236,216,0.92)",
    img: "#e8dcc4",
  },
  light: {
    bg: "#fafafa",
    fg: "#1a1a1a",
    muted: "#5c5c5c",
    bar: "rgba(250,250,250,0.94)",
    img: "#eee",
  },
  dark: {
    bg: "#1c1c1e",
    fg: "#f2f2f7",
    muted: "#a1a1aa",
    bar: "rgba(28,28,30,0.94)",
    img: "#2c2c2e",
  },
};

export function ArticleReaderView({
  doc,
  onClose,
}: {
  doc: ReaderDoc;
  onClose: () => void;
}) {
  const [prefs, setPrefs] = useState<Prefs>({ theme: "paper", fontIdx: 1 });

  useEffect(() => {
    setPrefs(loadPrefs());
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
    } catch {
      /* quota */
    }
  }, [prefs]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const theme = THEME[prefs.theme];
  const fontPx = FONT_STEPS[prefs.fontIdx] ?? 19;

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col print:hidden"
      style={{ background: theme.bg, color: theme.fg }}
      role="dialog"
      aria-modal="true"
      aria-label="읽기 도구"
    >
      <div
        className="sticky top-0 z-10 flex items-center gap-2 border-b px-3 py-2"
        style={{
          background: theme.bar,
          borderColor: prefs.theme === "dark" ? "#3a3a3c" : "#e0d4bc",
          paddingTop: "max(0.5rem, env(safe-area-inset-top))",
        }}
      >
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full"
          aria-label="읽기 도구 닫기"
        >
          <X className="h-5 w-5" />
        </button>
        <p className="flex-1 min-w-0 text-sm font-medium truncate inline-flex items-center gap-1.5">
          <BookOpen className="h-4 w-4 shrink-0" />
          읽기 도구
        </p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={prefs.fontIdx <= 0}
            onClick={() =>
              setPrefs((p) => ({ ...p, fontIdx: Math.max(0, p.fontIdx - 1) }))
            }
            className="inline-flex h-10 w-10 items-center justify-center rounded-full disabled:opacity-30"
            aria-label="글자 작게"
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={prefs.fontIdx >= FONT_STEPS.length - 1}
            onClick={() =>
              setPrefs((p) => ({
                ...p,
                fontIdx: Math.min(FONT_STEPS.length - 1, p.fontIdx + 1),
              }))
            }
            className="inline-flex h-10 w-10 items-center justify-center rounded-full disabled:opacity-30"
            aria-label="글자 크게"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <div className="flex items-center gap-1 rounded-full border px-1 py-0.5" style={{ borderColor: theme.muted }}>
          {(["paper", "light", "dark"] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setPrefs((p) => ({ ...p, theme: id }))}
              className="h-7 w-7 rounded-full"
              style={{
                background:
                  id === "paper" ? "#f4ecd8" : id === "light" ? "#fff" : "#1c1c1e",
                outline:
                  prefs.theme === id ? `2px solid ${theme.fg}` : "1px solid #c4b8a4",
                outlineOffset: 1,
              }}
              aria-label={
                id === "paper" ? "종이 배경" : id === "light" ? "밝은 배경" : "어두운 배경"
              }
            />
          ))}
        </div>
      </div>

      <div
        className="flex-1 overflow-y-auto"
        style={{
          paddingBottom: "max(2rem, env(safe-area-inset-bottom))",
        }}
      >
        <article
          className="mx-auto w-full max-w-[40rem] px-5 py-8 sm:px-8"
          style={{
            fontFamily: READER_PDF_FONT_FAMILY,
            fontSize: fontPx,
            lineHeight: 1.85,
            wordBreak: "keep-all",
            overflowWrap: "break-word",
          }}
        >
          <h1
            className="font-display mb-3"
            style={{
              fontSize: `calc(${fontPx}px + 0.85rem)`,
              lineHeight: 1.35,
              fontWeight: 700,
            }}
          >
            {doc.title}
          </h1>
          {(doc.source || doc.url) && (
            <p className="mb-8 text-[0.85em]" style={{ color: theme.muted }}>
              {[doc.source, doc.url].filter(Boolean).join(" · ")}
            </p>
          )}
          <div className="space-y-5 reader-rich">
            {doc.blocks.map((b, i) => {
              if (b.type === "h") {
                return b.html ? (
                  <h2
                    key={`h-${i}`}
                    className="font-display pt-2"
                    style={{ fontSize: "1.15em", lineHeight: 1.4 }}
                    dangerouslySetInnerHTML={{ __html: b.html }}
                  />
                ) : (
                  <h2
                    key={`h-${i}`}
                    className="font-display pt-2"
                    style={{ fontSize: "1.15em", lineHeight: 1.4 }}
                  >
                    {b.text}
                  </h2>
                );
              }
              if (b.type === "img") {
                return (
                  <figure
                    key={`img-${i}-${b.src.slice(0, 24)}`}
                    className="overflow-hidden rounded-xl"
                    style={{ background: theme.img }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={b.src}
                      alt={b.alt || ""}
                      className="w-full h-auto object-contain"
                    />
                  </figure>
                );
              }
              return b.html ? (
                <p
                  key={`p-${i}`}
                  className="m-0"
                  dangerouslySetInnerHTML={{ __html: b.html }}
                />
              ) : (
                <p key={`p-${i}`} className="m-0">
                  {b.text}
                </p>
              );
            })}
          </div>
        </article>
      </div>
    </div>
  );
}
