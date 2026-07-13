"use client";

import { Check, Copy, ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";

/** 유튜브 페이지에서 스크립트를 클립보드로 복사하는 북마클릿 */
export const YOUTUBE_SCRIPT_BOOKMARKLET = `javascript:(async()=>{try{const pick=()=>{const nodes=[...document.querySelectorAll('ytd-transcript-segment-renderer yt-formatted-string, ytd-transcript-segment-renderer .segment-text, #segments-container yt-formatted-string')];return nodes.map(n=>(n.textContent||'').trim()).filter(Boolean);};let lines=pick();if(!lines.length){const btn=[...document.querySelectorAll('button, yt-button-shape button, tp-yt-paper-item')].find(el=>/스크립트|transcript|대본/i.test((el.textContent||'')+(el.getAttribute('aria-label')||'')));if(btn){btn.click();await new Promise(r=>setTimeout(r,1200));lines=pick();}}if(!lines.length){alert('스크립트가 안 보입니다.\\n1) ⋯ 더보기 → 스크립트 표시\\n2) 패널이 열린 뒤 이 버튼을 다시 눌러 주세요.');return;}const text=[...new Set(lines)].join('\\n');await navigator.clipboard.writeText(text);alert('스크립트 '+lines.length+'줄을 복사했습니다.\\nFactCheck 탭으로 돌아와 붙여넣으세요.');}catch(e){alert('복사 실패: '+(e&&e.message?e.message:e));}})();`;

type Props = {
  youtubeUrl?: string;
  compact?: boolean;
};

export function ScriptCopyHelper({ youtubeUrl, compact }: Props) {
  const [copied, setCopied] = useState(false);

  const watchUrl = useMemo(() => {
    if (!youtubeUrl?.trim()) return null;
    try {
      const u = new URL(youtubeUrl.trim());
      if (u.hostname.includes("youtu.be")) {
        const id = u.pathname.replace("/", "");
        return id ? `https://www.youtube.com/watch?v=${id}` : youtubeUrl;
      }
      return youtubeUrl.trim();
    } catch {
      return youtubeUrl.trim();
    }
  }, [youtubeUrl]);

  async function copyBookmarklet() {
    await navigator.clipboard.writeText(YOUTUBE_SCRIPT_BOOKMARKLET);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div
      className={
        compact
          ? "space-y-2 text-xs text-ink-600"
          : "rounded-xl border border-ink-200 bg-white/80 p-3 space-y-3"
      }
    >
      {!compact && (
        <p className="text-sm font-medium text-ink-900">스크립트 쉽게 복사</p>
      )}
      <ol className="list-decimal pl-4 space-y-1 text-xs sm:text-sm text-ink-700 leading-relaxed">
        <li>
          유튜브에서 <strong>⋯ → 스크립트 표시</strong>를 엽니다.
        </li>
        <li>
          PC면 스크립트 칸에서 <kbd className="rounded bg-ink-100 px-1">Ctrl</kbd>+
          <kbd className="rounded bg-ink-100 px-1">A</kbd> →{" "}
          <kbd className="rounded bg-ink-100 px-1">Ctrl</kbd>+
          <kbd className="rounded bg-ink-100 px-1">C</kbd>
        </li>
        <li>이 사이트에 돌아와 붙여넣기합니다.</li>
      </ol>

      <div className="flex flex-col sm:flex-row gap-2">
        {watchUrl ? (
          <a
            href={watchUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-1.5 min-h-10 rounded-xl border border-ink-200 bg-white px-3 text-sm font-medium text-ink-800 hover:border-accent hover:text-accent"
          >
            <ExternalLink className="h-4 w-4" />
            유튜브에서 스크립트 열기
          </a>
        ) : null}
        <button
          type="button"
          onClick={copyBookmarklet}
          className="inline-flex items-center justify-center gap-1.5 min-h-10 rounded-xl border border-ink-200 bg-white px-3 text-sm font-medium text-ink-800 hover:border-accent hover:text-accent"
          title="유튜브 탭 주소창에 붙여넣으면 스크립트를 복사합니다"
        >
          {copied ? (
            <Check className="h-4 w-4 text-verify-true" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
          {copied ? "복사 코드 복사됨" : "원클릭 복사 코드 복사"}
        </button>
      </div>

      <p className="text-[11px] sm:text-xs text-ink-500 leading-relaxed">
        <strong>원클릭 복사:</strong> 위 버튼으로 코드를 복사 → 유튜브 탭 주소창에
        붙여넣고 Enter → 스크립트가 클립보드에 저장됩니다. (먼저 스크립트 패널을
        연 상태가 가장 잘 됩니다)
      </p>

      {/* 북마크바용 드래그 링크 */}
      <p className="text-[11px] text-ink-500">
        자주 쓰면 이 링크를 북마크 바로 드래그해 두세요:{" "}
        <a
          href={YOUTUBE_SCRIPT_BOOKMARKLET}
          onClick={(e) => e.preventDefault()}
          className="text-accent underline font-medium"
          title="북마크 바로 드래그"
        >
          YT 스크립트 복사
        </a>
      </p>
    </div>
  );
}
