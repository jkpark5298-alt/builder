"use client";

import { BookmarkPlus, Check, Copy, ExternalLink, Monitor, Smartphone } from "lucide-react";
import { useMemo, useState } from "react";

/**
 * 유튜브 페이지에서 실행 → 자막을 클립보드에 복사.
 * Chrome은 주소창 javascript: 붙여넣기를 막음 → 북마크 또는 수동 Ctrl+A/C.
 */
const BOOKMARKLET_BODY = `(async()=>{try{function getTracks(){const a=window.ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;if(a?.length)return a;const scripts=[...document.querySelectorAll('script')];for(const s of scripts){const t=s.textContent||'';const i=t.indexOf('ytInitialPlayerResponse');if(i<0)continue;const eq=t.indexOf('=',i);if(eq<0)continue;let p=eq+1;while(p<t.length&&/\\s/.test(t[p]))p++;if(t[p]!=='{')continue;let depth=0,inStr=false,esc=false;for(let j=p;j<t.length;j++){const ch=t[j];if(inStr){if(esc)esc=false;else if(ch==='\\\\')esc=true;else if(ch==='"')inStr=false;continue;}if(ch==='"'){inStr=true;continue;}if(ch==='{')depth++;else if(ch==='}'){depth--;if(depth===0){try{const obj=JSON.parse(t.slice(p,j+1));const tr=obj?.captions?.playerCaptionsTracklistRenderer?.captionTracks;if(tr?.length)return tr;}catch(e){}break;}}}}return null;}const tracks=getTracks();if(!tracks||!tracks.length){const segs=[...document.querySelectorAll('ytd-transcript-segment-renderer yt-formatted-string, ytd-transcript-segment-renderer .segment-text')].map(n=>(n.textContent||'').trim()).filter(Boolean);if(segs.length){const text=[...new Set(segs)].join('\\n');await navigator.clipboard.writeText(text);alert('패널에서 자막 '+segs.length+'줄을 복사했습니다.\\nFactCheck에 붙여넣으세요.');return;}alert('자막을 찾지 못했습니다.\\n1) ⋯ → 스크립트 표시\\n2) 이 북마크를 다시 클릭');return;}const ko=tracks.find(t=>(t.languageCode||'').startsWith('ko'));const manual=tracks.find(t=>t.kind!=='asr');const pick=ko||manual||tracks[0];const base=String(pick.baseUrl).replace(/\\\\u0026/g,'&').replace(/&amp;/g,'&');async function fromJson3(url){const u=url+(url.includes('?')?'&':'?')+'fmt=json3';const r=await fetch(u);if(!r.ok)return'';const j=await r.json();return(j.events||[]).flatMap(e=>e.segs||[]).map(s=>s.utf8||'').join(' ').replace(/\\s+/g,' ').trim();}async function fromXml(url){const r=await fetch(url);if(!r.ok)return'';const xml=await r.text();const d=document.createElement('div');d.innerHTML=xml;return[...d.querySelectorAll('text')].map(t=>t.textContent||'').join(' ').replace(/\\s+/g,' ').trim();}let text=await fromJson3(base);if(!text||text.length<20)text=await fromXml(base);if(!text||text.length<20){alert('자막 텍스트를 읽지 못했습니다.');return;}await navigator.clipboard.writeText(text);alert('자막 '+text.length+'자를 복사했습니다.\\nFactCheck 탭으로 돌아와 붙여넣으세요.');}catch(e){alert('복사 실패: '+(e&&e.message?e.message:e));}})();`;

export const YOUTUBE_SCRIPT_BOOKMARKLET = `javascript:${BOOKMARKLET_BODY}`;

type Props = {
  youtubeUrl?: string;
  compact?: boolean;
};

export function ScriptCopyHelper({ youtubeUrl }: Props) {
  const [copied, setCopied] = useState<"full" | null>(null);
  const [tab, setTab] = useState<"pc" | "ios">("pc");
  const [step, setStep] = useState<"easy" | "bookmark" | "manual">("easy");

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
    setTimeout(() => setCopied(null), 4000);
  }

  return (
    <div className="rounded-xl border border-ink-200 bg-white/90 p-4 space-y-4">
      <div>
        <p className="text-base font-medium text-ink-900">스크립트(자막) 복사 방법</p>
        <p className="text-xs text-ink-500 mt-1">
          가장 쉬운 건 <strong>수동 복사</strong>입니다. 북마크는 자주 쓸 때만
          설치하세요.
        </p>
      </div>

      <div className="flex gap-1 rounded-lg bg-ink-100/80 p-0.5">
        {(
          [
            ["easy", "가장 쉬움"],
            ["bookmark", "북마크"],
            ["manual", "기기별"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setStep(id)}
            className={`flex-1 min-h-9 rounded-md text-xs sm:text-sm font-medium ${
              step === id ? "bg-white text-ink-900 shadow-sm" : "text-ink-500"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {step === "easy" && (
        <div className="space-y-3 text-sm text-ink-800 leading-relaxed">
          <p className="font-medium text-ink-900">PC에서 수동 복사 (추천)</p>
          <ol className="list-decimal pl-5 space-y-2">
            <li>
              {watchUrl ? (
                <>
                  <a
                    href={watchUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent font-medium underline"
                  >
                    유튜브에서 영상 열기
                  </a>
                  를 누릅니다.
                </>
              ) : (
                <>먼저 위에 유튜브 주소를 입력한 뒤, 유튜브에서 영상을 엽니다.</>
              )}
            </li>
            <li>
              영상 제목 아래 <strong>⋯ (더보기)</strong> 클릭
            </li>
            <li>
              <strong>스크립트 표시</strong> 클릭 → 오른쪽에 자막 목록이 열림
            </li>
            <li>
              자막 목록 안을 한 번 클릭 →{" "}
              <kbd className="rounded bg-ink-100 px-1">Ctrl</kbd>+
              <kbd className="rounded bg-ink-100 px-1">A</kbd> (전체 선택) →{" "}
              <kbd className="rounded bg-ink-100 px-1">Ctrl</kbd>+
              <kbd className="rounded bg-ink-100 px-1">C</kbd> (복사)
            </li>
            <li>
              FactCheck로 돌아와 아래 붙여넣기 칸에{" "}
              <kbd className="rounded bg-ink-100 px-1">Ctrl</kbd>+
              <kbd className="rounded bg-ink-100 px-1">V</kbd>
            </li>
          </ol>
          {watchUrl && (
            <a
              href={watchUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 min-h-11 rounded-xl bg-ink-900 px-4 text-sm font-medium text-white hover:bg-accent"
            >
              <ExternalLink className="h-4 w-4" />
              유튜브에서 영상 열기
            </a>
          )}
        </div>
      )}

      {step === "bookmark" && (
        <div className="space-y-4 text-sm text-ink-800 leading-relaxed">
          <div className="rounded-lg border border-accent/30 bg-accent-muted/40 p-3 text-xs sm:text-sm">
            <p className="font-medium text-ink-900 mb-1">
              Ctrl+Shift+B 가 안 될 때 (즐겨찾기 표시줄 켜기)
            </p>
            <ol className="list-decimal pl-4 space-y-1">
              <li>
                Chrome 오른쪽 위 <strong>⋮</strong> (점 3개) 클릭
              </li>
              <li>
                <strong>북마크</strong> (또는 즐겨찾기) 위로 마우스 올리기
              </li>
              <li>
                <strong>즐겨찾기 표시줄 표시</strong> 클릭
              </li>
            </ol>
            <p className="mt-2 text-ink-600">
              Edge: ⋯ → 즐겨찾기 → 즐겨찾기 표시줄 표시
              <br />
              주소창 아래, 탭 바로 밑에 가로 줄이 생기면 성공입니다.
            </p>
          </div>

          <p className="font-medium text-ink-900">
            방법 1 — 아래 버튼을 즐겨찾기로 드래그
          </p>
          <p className="text-xs text-ink-600">
            이 큰 버튼을 <strong>마우스 왼쪽 버튼으로 누른 채</strong> 주소창
            아래 즐겨찾기 줄까지 끌어다 놓으세요.
          </p>

          {/* 눈에 띄는 드래그 타깃 */}
          <a
            href={YOUTUBE_SCRIPT_BOOKMARKLET}
            onClick={(e) => {
              e.preventDefault();
              alert(
                "이 버튼은 ‘클릭’이 아니라 ‘드래그’입니다.\n\n1) 즐겨찾기 표시줄을 켠 뒤\n2) 이 주황색 버튼을 마우스로 잡아\n3) 주소창 아래 즐겨찾기 줄에 놓으세요."
              );
            }}
            draggable
            className="flex items-center justify-center gap-2 min-h-14 w-full rounded-xl border-2 border-dashed border-accent bg-accent-muted px-4 text-base font-semibold text-accent cursor-grab active:cursor-grabbing select-none"
            title="이 버튼을 즐겨찾기 표시줄로 드래그"
          >
            <BookmarkPlus className="h-5 w-5" />
            YT 스크립트 복사 ← 여기를 드래그
          </a>

          <p className="font-medium text-ink-900">방법 2 — 드래그가 안 되면 (수동 추가)</p>
          <ol className="list-decimal pl-5 space-y-2">
            <li>
              아래 <strong>북마크 코드 복사</strong> 버튼을 누릅니다.
            </li>
            <li>
              Chrome 주소창 오른쪽 <strong>☆ (별)</strong> 클릭 → 이름에{" "}
              <code className="bg-ink-100 px-1 rounded">YT 스크립트 복사</code>{" "}
              입력 → 저장 위치는 <strong>즐겨찾기 표시줄</strong>
            </li>
            <li>
              저장된 북마크를 <strong>우클릭 → 수정</strong>
            </li>
            <li>
              <strong>URL</strong> 칸을 모두 지우고,{" "}
              <kbd className="rounded bg-ink-100 px-1">Ctrl</kbd>+
              <kbd className="rounded bg-ink-100 px-1">V</kbd> 로 붙여넣기 →
              저장
            </li>
            <li>
              유튜브 영상 탭에서 즐겨찾기 줄의{" "}
              <strong>YT 스크립트 복사</strong>를 클릭
            </li>
            <li>
              FactCheck 붙여넣기 칸에{" "}
              <kbd className="rounded bg-ink-100 px-1">Ctrl</kbd>+
              <kbd className="rounded bg-ink-100 px-1">V</kbd>
            </li>
          </ol>

          <button
            type="button"
            onClick={copyFull}
            className="inline-flex items-center justify-center gap-2 min-h-11 rounded-xl border border-ink-200 bg-white px-4 text-sm font-medium hover:border-accent"
          >
            {copied === "full" ? (
              <Check className="h-4 w-4 text-verify-true" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            {copied === "full"
              ? "복사됨 — 북마크 URL에 붙여넣으세요"
              : "북마크 코드 복사"}
          </button>
        </div>
      )}

      {step === "manual" && (
        <div className="space-y-3">
          <div className="flex gap-1 rounded-lg bg-ink-50 p-0.5">
            <button
              type="button"
              onClick={() => setTab("pc")}
              className={`flex-1 inline-flex items-center justify-center gap-1 min-h-9 rounded-md text-xs font-medium ${
                tab === "pc" ? "bg-white shadow-sm" : "text-ink-500"
              }`}
            >
              <Monitor className="h-3.5 w-3.5" />
              PC
            </button>
            <button
              type="button"
              onClick={() => setTab("ios")}
              className={`flex-1 inline-flex items-center justify-center gap-1 min-h-9 rounded-md text-xs font-medium ${
                tab === "ios" ? "bg-white shadow-sm" : "text-ink-500"
              }`}
            >
              <Smartphone className="h-3.5 w-3.5" />
              아이폰
            </button>
          </div>
          {tab === "pc" ? (
            <p className="text-sm text-ink-700 leading-relaxed">
              PC는 <strong>가장 쉬움</strong> 탭의 ⋯ → 스크립트 표시 → Ctrl+A →
              Ctrl+C 가 가장 확실합니다.
            </p>
          ) : (
            <ol className="list-decimal pl-5 space-y-2 text-sm text-ink-700 leading-relaxed">
              <li>유튜브 <strong>앱이 아니라 Safari</strong>로 영상을 엽니다.</li>
              <li>
                주소창 <strong>AA</strong> → 데스크톱 웹 사이트 요청
              </li>
              <li>⋯ → 스크립트 표시</li>
              <li>자막을 길게 눌러 선택 → 복사 → FactCheck에 붙여넣기</li>
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
