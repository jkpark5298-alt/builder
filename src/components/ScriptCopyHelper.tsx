"use client";

import { Check, Copy, ExternalLink, Monitor, Smartphone } from "lucide-react";
import { useMemo, useState } from "react";

/**
 * 유튜브 페이지(같은 탭)에서 실행 → 자막 트랙 URL로 텍스트를 받아 클립보드에 복사.
 * PC·아이폰 Safari(유튜브 웹)에서 동작. 유튜브 앱 안에서는 불가.
 */
export const YOUTUBE_SCRIPT_BOOKMARKLET = `javascript:(async()=>{try{const tracks=window.ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;if(!tracks||!tracks.length){alert('이 영상에서 자막 트랙을 찾지 못했습니다.\\n(⋯→스크립트 표시가 있는 영상인지 확인해 주세요)');return;}const ko=tracks.find(t=>(t.languageCode||'').startsWith('ko'));const manual=tracks.find(t=>t.kind!=='asr');const pick=ko||manual||tracks[0];const base=pick.baseUrl.replace(/\\\\u0026/g,'&');async function fromJson3(url){const u=url+(url.includes('?')?'&':'?')+'fmt=json3';const r=await fetch(u);if(!r.ok)return'';const j=await r.json();return(j.events||[]).flatMap(e=>e.segs||[]).map(s=>s.utf8||'').join(' ').replace(/\\s+/g,' ').trim();}async function fromXml(url){const r=await fetch(url);if(!r.ok)return'';const xml=await r.text();const d=document.createElement('div');d.innerHTML=xml;return[...d.querySelectorAll('text')].map(t=>t.textContent||'').join(' ').replace(/\\s+/g,' ').trim();}let text=await fromJson3(base);if(!text||text.length<20)text=await fromXml(base);if(!text||text.length<20){alert('자막 텍스트를 읽지 못했습니다.');return;}await navigator.clipboard.writeText(text);alert('자막 '+text.length+'자를 복사했습니다.\\nFactCheck 탭으로 돌아와 붙여넣으세요.');}catch(e){alert('복사 실패: '+(e&&e.message?e.message:e));}})();`;

type Props = {
  youtubeUrl?: string;
  compact?: boolean;
};

export function ScriptCopyHelper({ youtubeUrl, compact }: Props) {
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<"pc" | "ios">("pc");

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
        <p className="text-sm font-medium text-ink-900">
          자막 자동 복사 (유튜브로 이동)
        </p>
      )}

      <div className="flex gap-1 rounded-lg bg-ink-100/80 p-0.5">
        <button
          type="button"
          onClick={() => setTab("pc")}
          className={`flex-1 inline-flex items-center justify-center gap-1.5 min-h-9 rounded-md text-xs sm:text-sm font-medium ${
            tab === "pc" ? "bg-white text-ink-900 shadow-sm" : "text-ink-500"
          }`}
        >
          <Monitor className="h-3.5 w-3.5" />
          PC
        </button>
        <button
          type="button"
          onClick={() => setTab("ios")}
          className={`flex-1 inline-flex items-center justify-center gap-1.5 min-h-9 rounded-md text-xs sm:text-sm font-medium ${
            tab === "ios" ? "bg-white text-ink-900 shadow-sm" : "text-ink-500"
          }`}
        >
          <Smartphone className="h-3.5 w-3.5" />
          아이폰
        </button>
      </div>

      {tab === "pc" ? (
        <ol className="list-decimal pl-4 space-y-1.5 text-xs sm:text-sm text-ink-700 leading-relaxed">
          <li>
            <strong>유튜브에서 스크립트 열기</strong>로 영상 탭을 엽니다.
          </li>
          <li>
            아래 <strong>원클릭 복사 코드 복사</strong> → 유튜브 주소창에 붙여넣고
            Enter (또는 북마크 <strong>YT 스크립트 복사</strong> 클릭).
          </li>
          <li>
            “복사했습니다” 알림이 뜨면 FactCheck로 돌아와{" "}
            <kbd className="rounded bg-ink-100 px-1">Ctrl</kbd>+
            <kbd className="rounded bg-ink-100 px-1">V</kbd>.
          </li>
          <li className="text-ink-500">
            코드가 안 되면: ⋯ → 스크립트 표시 → 스크립트 칸에서 Ctrl+A → Ctrl+C.
          </li>
        </ol>
      ) : (
        <ol className="list-decimal pl-4 space-y-1.5 text-xs sm:text-sm text-ink-700 leading-relaxed">
          <li>
            <strong>유튜브 앱에서는 스크립트 복사가 안 됩니다.</strong> Safari를
            쓰세요.
          </li>
          <li>
            Safari에서 영상 열기 → 주소창 <strong>AA</strong> →{" "}
            <strong>데스크톱 웹 사이트 요청</strong>.
          </li>
          <li>
            ⋯ → <strong>스크립트 표시</strong> 후, 공유/북마크에 넣어 둔{" "}
            <strong>YT 스크립트 복사</strong>를 탭해 자동 복사.
          </li>
          <li>
            FactCheck Safari 탭으로 돌아와 길게 눌러 <strong>붙여넣기</strong>.
          </li>
          <li className="text-ink-500">
            자동 복사가 어려우면: 스크립트 문구를 길게 눌러 선택·복사(데스크톱
            모드에서만 되는 경우가 많음).
          </li>
        </ol>
      )}

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
        >
          {copied ? (
            <Check className="h-4 w-4 text-verify-true" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
          {copied ? "복사 코드 복사됨" : "원클릭 복사 코드 복사"}
        </button>
      </div>

      <p className="text-[11px] text-ink-500 leading-relaxed">
        자주 쓰면{" "}
        <a
          href={YOUTUBE_SCRIPT_BOOKMARKLET}
          onClick={(e) => e.preventDefault()}
          className="text-accent underline font-medium"
          title="북마크 바로 드래그 (PC) / 아이폰은 북마크로 추가"
        >
          YT 스크립트 복사
        </a>
        를 북마크에 저장하세요. 유튜브 <strong>웹</strong> 페이지에서만
        동작합니다.
      </p>
    </div>
  );
}
