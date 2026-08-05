import type { Metadata, Viewport } from "next";
import "./globals.css";
import { HomeSectionLink } from "@/components/HomeSectionLink";

export const metadata: Metadata = {
  title: "YouTube FactCheck — 요약 · 검증 · 보고서",
  description:
    "유튜브 링크 요약, 수동/자동 팩트체크, PDF 보고서, 인포그래픽, 검색·공유 (iPhone·PC)",
  appleWebApp: {
    capable: true,
    title: "YouTube FactCheck",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: "#f4f6f8",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>
        <div className="min-h-screen pb-[env(safe-area-inset-bottom)]">
          <header className="border-b border-ink-200/80 bg-white/80 backdrop-blur-md sticky top-0 z-40 pt-[env(safe-area-inset-top)]">
            <div className="mx-auto max-w-6xl px-3 sm:px-4 py-3 sm:py-4 flex items-center justify-between gap-3">
              <a href="/" className="group min-w-0">
                <p className="font-display text-xl sm:text-2xl tracking-tight text-ink-900 group-hover:text-accent transition-colors truncate">
                  YouTube FactCheck
                </p>
                <p className="text-[11px] sm:text-xs text-ink-500 mt-0.5 truncate">
                  요약 · 팩트체크 · 보고서 · 인포그래픽
                </p>
              </a>
              <nav className="flex items-center gap-1.5 sm:gap-2 text-sm text-ink-600 shrink-0">
                <HomeSectionLink
                  hash="youtube"
                  className="hidden md:inline hover:text-accent transition-colors px-2 py-2"
                >
                  유튜브
                </HomeSectionLink>
                <HomeSectionLink
                  hash="factcheck"
                  className="hidden md:inline hover:text-accent transition-colors px-2 py-2"
                >
                  팩트체크 보고서
                </HomeSectionLink>
                <HomeSectionLink
                  hash="topics"
                  className="hidden md:inline hover:text-accent transition-colors px-2 py-2"
                >
                  주제
                </HomeSectionLink>
                <HomeSectionLink
                  hash="paste"
                  className="rounded-xl bg-ink-900 text-white px-3 py-2.5 min-h-11 inline-flex items-center hover:bg-accent transition-colors text-sm font-medium"
                >
                  홈
                </HomeSectionLink>
              </nav>
            </div>
          </header>
          <main className="mx-auto max-w-6xl px-3 sm:px-4 py-5 sm:py-8">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
