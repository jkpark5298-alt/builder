"use client";

import { Check, Copy, ExternalLink, Monitor, Smartphone } from "lucide-react";
import { useMemo, useState } from "react";

/**
 * 유튜브 페이지에서 실행 → 자막을 클립보드에 복사.
 * 주의: 최신 Chrome은 주소창에 javascript: 붙여넣기를 막고 검색으로 보냄 → 북마크 사용.
 */
const BOOKMARKLET_BODY = `(async()=>{try{function getTracks(){const a=window.ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;if(a?.length)return a;const scripts=[...document.querySelectorAll('script')];for(const s of scripts){const t=s.textContent||'';const i=t.indexOf('ytInitialPlayerResponse');if(i<0)continue;const eq=t.indexOf('=',i);if(eq<0)continue;let p=eq+1;while(p<t.length&&/\\s/.test(t[p]))p++;if(t[p]!=='{')continue;let depth=0,inStr=false,esc=false;for(let j=p;j<t.length;j++){const ch=t[j];if(inStr){if(esc)esc=false;else if(ch==='\\\\')esc=true;else if(ch==='"')inStr=false;continue;}if(ch==='"'){inStr=true;continue;}if(ch==='{')depth++;else if(ch==='}'){depth--;if(depth===0){try{const obj=JSON.parse(t.slice(p,j+1));const tr=obj?.captions?.playerCaptionsTracklistRenderer?.captionTracks;if(tr?.length)return tr;}catch(e){}break;}}}}return null;}const tracks=getTracks();if(!tracks||!tracks.length){const segs=[...document.querySelectorAll('ytd-transcript-segment-renderer yt-formatted-string, ytd-transcript-segment-renderer .segment-text')].map(n=>(n.textContent||'').trim()).filter(Boolean);if(segs.length){const text=[...new Set(segs)].join('\\n');await navigator.clipboard.writeText(text);alert('패널에서 자막 '+segs.length+'줄을 복사했습니다.\\nFactCheck에 붙여넣으세요.');return;}alert('자막을 찾지 못했습니다.\\n1) ⋯ → 스크립트 표시\\n2) 이 북마크를 다시 클릭');return;}const ko=tracks.find(t=>(t.languageCode||'').startsWith('ko'));const manual=tracks.find(t=>t.kind!=='asr');const pick=ko||manual||tracks[0];const base=String(pick.baseUrl).replace(/\\\\u0026/g,'&').replace(/&amp;/g,'&');async function fromJson3(url){const u=url+(url.includes('?')?'&':'?')+'fmt=json3';const r=await fetch(u);if(!r.ok)return'';const j=await r.json();return(j.events||[]).flatMap(e=>e.segs||[]).map(s=>s.utf8||'').join(' ').replace(/\\s+/g,' ').trim();}async function fromXml(url){const r=await fetch(url);if(!r.ok)return'';const xml=await r.text();const d=document.createElement('div');d.innerHTML=xml;return[...d.querySelectorAll('text')].map(t=>t.textContent||'').join(' ').replace(/\\s+/g,' ').trim();}let text=await fromJson3(base);if(!text||text.length<20)text=await fromXml(base);if(!text||text.length<20){alert('자막 텍스트를 읽지 못했습니다.');return;}await navigator.clipboard.writeText(text);alert('자막 '+text.length+'자를 복사했습니다.\\nFactCheck 탭으로 돌아와 붙여넣으세요.');}catch(e){alert('복사 실패: '+(e&&e.message?e.message:e));}})();`;

export const YOUTUBE_SCRIPT_BOOKMARKLET = `javascript:${BOOKMARKLET_BODY}`;

type Props = {
  youtubeUrl?: string;
  compact?: boolean;
};

export function ScriptCopyHelper({ youtubeUrl, compact }: Props) {
  const [copied, setCopied] = useState<"full" | "body" | null>(null);
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

  async function copyFull() {
    await navigator.clipboard.writeText(YOUTUBE_SCRIPT_BOOKMARKLET);
    setCopied("full");
    setTimeout(() => setCopied(null), 3000);
  }

  async function copyBodyOnly() {
    await navigator.clipboard.writeText(BOOKMARKLET_BODY);
    setCopied("body");
    setTimeout(() => setCopied(null), 4000);
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

      <div className="rounded-lg border border-accent/30 bg-accent-muted/50 px-3 py-2 text-xs sm:text-sm text-ink-800 leading-relaxed">
        <strong>중요:</strong> Chrome 주소창에 코드를 붙여넣으면{" "}
        <em>「다음에 대한 결과가 없음」</em> 검색이 됩니다.{" "}
        <strong>북마크로 저장</strong>해서 쓰는 방법이 맞습니다.
      </div>

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
            1. 유튜브에서 영상 열기
          </a>
        ) : null}
      </div>

      {tab === "pc" ? (
        <div className="space-y-2 text-xs sm:text-sm text-ink-700 leading-relaxed">
          <p className="font-medium text-ink-900">권장: 북마크로 한 번만 설치</p>
          <ol className="list-decimal pl-4 space-y-2">
            <li>
              Chrome에서 <kbd className="rounded bg-ink-100 px-1">Ctrl</kbd>+
              <kbd className="rounded bg-ink-100 px-1">Shift</kbd>+
              <kbd className="rounded bg-ink-100 px-1">B</kbd> 로{" "}
              <strong>즐겨찾기 표시줄</strong>을 켭니다.
            </li>
            <li>
              아래 파란 글자{" "}
              <a
                href={YOUTUBE_SCRIPT_BOOKMARKLET}
                onClick={(e) => e.preventDefault()}
                draggable
                className="text-accent underline font-semibold cursor-grab"
              >
                YT 스크립트 복사
              </a>
              를 <strong>마우스로 잡아 즐겨찾기 표시줄에 끌어다 놓습니다.</strong>
            </li>
            <li>
              <strong>1. 유튜브에서 영상 열기</strong>로 영상 탭을 엽니다.
            </li>
            <li>
              유튜브 탭에서 방금 만든 북마크{" "}
              <strong>YT 스크립트 복사</strong>를 <strong>클릭</strong>합니다.
            </li>
            <li>
              “자막 ○○자를 복사했습니다”가 뜨면 FactCheck로 돌아와{" "}
              <kbd className="rounded bg-ink-100 px-1">Ctrl</kbd>+
              <kbd className="rounded bg-ink-100 px-1">V</kbd>.
            </li>
          </ol>

          <button
            type="button"
            onClick={() => setShowHow((v) => !v)}
            className="text-accent font-medium underline-offset-2 hover:underline"
          >
            {showHow
              ? "주소창 방법(비권장) 접기"
              : "주소창에 붙여넣기 — Chrome에서 왜 안 되나?"}
          </button>

          {showHow && (
            <div className="rounded-xl border border-ink-200 bg-ink-50/80 p-3 space-y-3">
              <p>
                Chrome은 보안 때문에 주소창에{" "}
                <code className="text-[11px] bg-white px-1 rounded border">
                  javascript:
                </code>
                를 붙여넣으면 <strong>지워 버리고 검색</strong>합니다. 그래서
                「다음에 대한 결과가 없음」이 뜹니다.
              </p>
              <p className="font-medium text-ink-900">그래도 주소창을 쓰려면:</p>
              <ol className="list-decimal pl-4 space-y-2">
                <li>유튜브 영상 탭을 연다.</li>
                <li>
                  주소창을 클릭하고, 키보드로{" "}
                  <code className="text-[11px] bg-white px-1 rounded border">
                    javascript:
                  </code>
                  만 <strong>직접 타이핑</strong>한다.
                </li>
                <li>
                  아래 <strong>코드 본문만 복사</strong>를 누른 뒤, 주소창{" "}
                  <code className="text-[11px]">javascript:</code> 뒤에{" "}
                  <kbd className="rounded bg-white px-1 border">Ctrl</kbd>+
                  <kbd className="rounded bg-white px-1 border">V</kbd>.
                </li>
                <li>
                  <kbd className="rounded bg-white px-1 border">Enter</kbd>.
                </li>
              </ol>
              <button
                type="button"
                onClick={copyBodyOnly}
                className="inline-flex items-center gap-1.5 min-h-9 rounded-lg border border-ink-200 bg-white px-3 text-sm font-medium"
              >
                {copied === "body" ? (
                  <Check className="h-4 w-4 text-verify-true" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                {copied === "body"
                  ? "본문 복사됨 — javascript: 뒤에 붙여넣기"
                  : "코드 본문만 복사 (javascript: 직접 입력용)"}
              </button>
              <p className="text-ink-500 border-t border-ink-200 pt-2">
                최후 수단: 유튜브 ⋯ → 스크립트 표시 → 스크립트 칸 Ctrl+A →
                Ctrl+C → FactCheck에 Ctrl+V.
              </p>
            </div>
          )}
        </div>
      ) : (
        <ol className="list-decimal pl-4 space-y-1.5 text-xs sm:text-sm text-ink-700 leading-relaxed">
          <li>
            <strong>유튜브 앱에서는 복사가 안 됩니다.</strong> Safari를 쓰세요.
          </li>
          <li>
            Safari에서 영상 열기 → <strong>AA</strong> → 데스크톱 웹 사이트 요청.
          </li>
          <li>
            PC에서 만든 것과 같은 북마크를 iCloud로 쓰거나, Safari 북마크에{" "}
            <strong>YT 스크립트 복사</strong>를 추가합니다.
          </li>
          <li>유튜브(웹)에서 그 북마크를 탭 → FactCheck에 붙여넣기.</li>
          <li className="text-ink-500">
            안 되면 ⋯ → 스크립트 표시 후 길게 눌러 수동 복사.
          </li>
        </ol>
      )}

      <button
        type="button"
        onClick={copyFull}
        className="inline-flex items-center justify-center gap-1.5 min-h-9 rounded-lg border border-ink-200 bg-white px-3 text-xs sm:text-sm text-ink-600"
      >
        {copied === "full" ? (
          <Check className="h-3.5 w-3.5" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
        {copied === "full"
          ? "전체 코드 복사됨 (북마크 URL에 붙여넣기용)"
          : "전체 코드 복사 (북마크 수동 추가용)"}
      </button>
    </div>
  );
}
