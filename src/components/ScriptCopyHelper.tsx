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
  const [showHow, setShowHow] = useState(true);

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
    setTimeout(() => setCopied(false), 2500);
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

      <div className="flex flex-col sm:flex-row gap-2">
        {watchUrl ? (
          <a
            href={watchUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-1.5 min-h-10 rounded-xl border border-ink-200 bg-white px-3 text-sm font-medium text-ink-800 hover:border-accent hover:text-accent"
          >
            <ExternalLink className="h-4 w-4" />
            1. 유튜브에서 스크립트 열기
          </a>
        ) : null}
        <button
          type="button"
          onClick={copyBookmarklet}
          className="inline-flex items-center justify-center gap-1.5 min-h-10 rounded-xl bg-ink-900 px-3 text-sm font-medium text-white hover:bg-accent"
        >
          {copied ? (
            <Check className="h-4 w-4" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
          {copied ? "2. 코드가 복사됨 ✓" : "2. 원클릭 복사 코드 복사"}
        </button>
      </div>

      {copied && (
        <p className="rounded-lg bg-accent-muted/70 border border-accent/30 px-3 py-2 text-xs sm:text-sm text-ink-800">
          코드가 클립보드에 있습니다. 이제 <strong>유튜브 탭</strong>으로 가서
          주소창을 클릭 → <kbd className="rounded bg-white px-1 border">Ctrl</kbd>+
          <kbd className="rounded bg-white px-1 border">V</kbd> →{" "}
          <kbd className="rounded bg-white px-1 border">Enter</kbd>
        </p>
      )}

      {tab === "pc" ? (
        <div className="space-y-2 text-xs sm:text-sm text-ink-700 leading-relaxed">
          <button
            type="button"
            onClick={() => setShowHow((v) => !v)}
            className="text-accent font-medium underline-offset-2 hover:underline"
          >
            {showHow ? "상세 설명 접기" : "원클릭 복사, 어떻게 하나요? (상세)"}
          </button>

          {showHow && (
            <div className="rounded-xl border border-ink-200 bg-ink-50/80 p-3 space-y-3">
              <p className="font-medium text-ink-900">방법 A — 주소창에 붙여넣기 (처음 1회부터 가능)</p>
              <ol className="list-decimal pl-4 space-y-2">
                <li>
                  위 <strong>1. 유튜브에서 스크립트 열기</strong>를 누르면 새 탭에
                  영상이 열립니다. (Chrome / Edge / 네이버웨일 등)
                </li>
                <li>
                  FactCheck 탭으로 돌아와{" "}
                  <strong>2. 원클릭 복사 코드 복사</strong>를 누릅니다.
                  <br />
                  <span className="text-ink-500">
                    → <code className="text-[11px] bg-white px-1 rounded border">javascript:(…)</code>{" "}
                    로 시작하는 긴 글이 클립보드에 들어갑니다. (화면에 안 보여도 됩니다)
                  </span>
                </li>
                <li>
                  다시 <strong>유튜브 탭</strong>을 클릭합니다.
                </li>
                <li>
                  브라우저 <strong>맨 위 주소창</strong>(보통{" "}
                  <code className="text-[11px] bg-white px-1 rounded border">
                    https://www.youtube.com/watch?v=…
                  </code>
                  가 보이는 칸)을 <strong>한 번 클릭</strong>합니다.
                </li>
                <li>
                  주소가 파랗게 선택되면{" "}
                  <kbd className="rounded bg-white px-1 border">Ctrl</kbd>+
                  <kbd className="rounded bg-white px-1 border">V</kbd> 로
                  붙여넣습니다.
                  <br />
                  <span className="text-ink-500">
                    주소 대신 <code className="text-[11px]">javascript:…</code> 가
                    보여야 합니다. (Chrome이{" "}
                    <code className="text-[11px]">javascript:</code> 를 지우면, 주소창에
                    직접 <code className="text-[11px]">javascript:</code> 를 다시 치고
                    나머지 붙여넣기)
                  </span>
                </li>
                <li>
                  <kbd className="rounded bg-white px-1 border">Enter</kbd> 를
                  누릅니다.
                </li>
                <li>
                  “자막 ○○자를 복사했습니다” 창이 뜨면 성공입니다. FactCheck 탭으로
                  돌아와 붙여넣기 칸에{" "}
                  <kbd className="rounded bg-white px-1 border">Ctrl</kbd>+
                  <kbd className="rounded bg-white px-1 border">V</kbd>.
                </li>
              </ol>

              <p className="font-medium text-ink-900 pt-1">방법 B — 북마크로 저장 (다음부터 한 번 클릭)</p>
              <ol className="list-decimal pl-4 space-y-2">
                <li>
                  북마크 바를 켭니다. Chrome:{" "}
                  <strong>Ctrl+Shift+B</strong> (즐겨찾기 표시줄).
                </li>
                <li>
                  아래 <strong>YT 스크립트 복사</strong> 글자를{" "}
                  <strong>북마크 바로 드래그</strong>해 놓습니다.
                </li>
                <li>
                  유튜브 영상 탭에서 그 북마크를 <strong>한 번 클릭</strong>하면
                  바로 복사됩니다. (주소창 붙여넣기 불필요)
                </li>
              </ol>

              <p className="text-ink-500 border-t border-ink-200 pt-2">
                둘 다 안 되면: 유튜브에서 ⋯ → <strong>스크립트 표시</strong> →
                스크립트 목록을 클릭 → Ctrl+A → Ctrl+C → FactCheck에 Ctrl+V.
              </p>
            </div>
          )}
        </div>
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

      <p className="text-[11px] text-ink-500 leading-relaxed">
        북마크 저장:{" "}
        <a
          href={YOUTUBE_SCRIPT_BOOKMARKLET}
          onClick={(e) => e.preventDefault()}
          draggable
          className="text-accent underline font-medium cursor-grab"
          title="이 글자를 북마크 바로 드래그"
        >
          YT 스크립트 복사
        </a>
        를 북마크 바로 끌어다 놓으세요. 유튜브 <strong>웹</strong>에서만 동작합니다.
      </p>
    </div>
  );
}
