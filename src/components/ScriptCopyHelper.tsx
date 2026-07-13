"use client";

import { Check, Copy, ExternalLink, Monitor, Smartphone } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

/**
 * 유튜브 페이지에서 실행 → 자막을 클립보드에 복사.
 * Chrome은 주소창 javascript: 붙여넣기를 막음 → 북마크 또는 수동 Ctrl+A/C.
 */
const BOOKMARKLET_BODY = `void(async()=>{try{alert('자막 복사 시작…');const sleep=ms=>new Promise(r=>setTimeout(r,ms));async function openPanel(){const items=[...document.querySelectorAll('button, tp-yt-paper-item, yt-list-item-view-model, span')];const btn=items.find(el=>/스크립트 표시|Show transcript|스크립트/i.test((el.textContent||'')+(el.getAttribute('aria-label')||'')));if(btn){btn.click();await sleep(1500);}}function scrape(){return[...document.querySelectorAll('ytd-transcript-segment-renderer yt-formatted-string, ytd-transcript-segment-renderer .segment-text, #segments-container yt-formatted-string')].map(n=>(n.textContent||'').trim()).filter(Boolean);}let lines=scrape();if(!lines.length){await openPanel();lines=scrape();}if(lines.length){const text=[...new Set(lines)].join('\\n');await navigator.clipboard.writeText(text);alert('자막 '+lines.length+'줄을 복사했습니다.\\nFactCheck에 Ctrl+V 하세요.');return;}const tracks=window.ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;if(!tracks||!tracks.length){alert('자막을 못 찾았습니다.\\n⋯ → 스크립트 표시를 연 뒤 다시 눌러 주세요.\\n그래도 안 되면 Ctrl+A → Ctrl+C 로 수동 복사하세요.');return;}const pick=tracks.find(t=>(t.languageCode||'').startsWith('ko'))||tracks.find(t=>t.kind!=='asr')||tracks[0];let url=String(pick.baseUrl).split('\\u0026').join('&').split('&amp;').join('&');if(!/[?&]fmt=/.test(url))url+=(url.includes('?')?'&':'?')+'fmt=json3';const res=await fetch(url);const data=await res.json();const text=(data.events||[]).flatMap(e=>e.segs||[]).map(s=>s.utf8||'').join(' ').replace(/\\s+/g,' ').trim();if(!text||text.length<20){alert('자막 텍스트가 비었습니다. ⋯→스크립트 표시 후 Ctrl+A→Ctrl+C 하세요.');return;}await navigator.clipboard.writeText(text);alert('자막 '+text.length+'자를 복사했습니다.\\nFactCheck에 Ctrl+V 하세요.');}catch(e){alert('실패: '+(e&&e.message?e.message:e)+'\\n수동: ⋯→스크립트 표시→Ctrl+A→Ctrl+C');}})();`;

export const YOUTUBE_SCRIPT_BOOKMARKLET = `javascript:${BOOKMARKLET_BODY}`;

type Props = {
  youtubeUrl?: string;
  compact?: boolean;
};

export function ScriptCopyHelper({ youtubeUrl }: Props) {
  const [copied, setCopied] = useState<"full" | null>(null);
  const [tab, setTab] = useState<"pc" | "ios">("pc");
  const [step, setStep] = useState<"easy" | "bookmark" | "manual">("easy");
  const dragHostRef = useRef<HTMLDivElement>(null);

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

  // React는 JSX의 javascript: href를 보안상 막음 → 네이티브 DOM으로만 드래그 링크 생성
  useEffect(() => {
    if (step !== "bookmark") return;
    const host = dragHostRef.current;
    if (!host) return;
    host.replaceChildren();
    const a = document.createElement("a");
    a.href = YOUTUBE_SCRIPT_BOOKMARKLET;
    a.draggable = true;
    a.className =
      "flex items-center justify-center gap-2 min-h-14 w-full rounded-xl border-2 border-dashed border-accent bg-accent-muted px-4 text-base font-semibold text-accent cursor-grab active:cursor-grabbing select-none";
    a.title = "이 버튼을 즐겨찾기 표시줄로 드래그";
    a.textContent = "YT 스크립트 복사 ← 여기를 드래그";
    a.addEventListener("click", (e) => {
      e.preventDefault();
      alert(
        "이 버튼은 ‘클릭’이 아니라 ‘드래그’입니다.\n\n또는 아래 ‘북마크 코드 복사’로 URL을 직접 넣으세요."
      );
    });
    host.appendChild(a);
    return () => {
      host.replaceChildren();
    };
  }, [step]);

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
          <div className="rounded-lg border border-verify-false/40 bg-red-50 px-3 py-2.5 text-xs sm:text-sm text-ink-800">
            <p className="font-medium text-ink-900 mb-1">
              「React has blocked a javascript: URL」 오류가 나면
            </p>
            <p className="mb-2">
              예전에 저장된 북마크가 <strong>잘못된 코드</strong>입니다. 아래
              순서대로 URL을 다시 넣으세요.
            </p>
            <ol className="list-decimal pl-4 space-y-1">
              <li>
                <strong>북마크 코드 복사</strong> 클릭
              </li>
              <li>
                즐겨찾기 <strong>YT 스크립트 복사</strong> 우클릭 →{" "}
                <strong>수정</strong>
              </li>
              <li>
                URL 칸을 전부 지우고 <kbd className="rounded bg-white px-1 border">Ctrl</kbd>+
                <kbd className="rounded bg-white px-1 border">V</kbd> → 저장
              </li>
              <li>
                URL이 <code className="bg-white px-1 rounded border text-[11px]">javascript:void</code> 로
                시작하는지 확인 (React / Error 글자가 있으면 안 됨)
              </li>
              <li>유튜브에서 다시 클릭 → 「자막 복사 시작…」 알림 확인</li>
            </ol>
          </div>

          <p className="font-medium text-ink-900">
            권장 — 북마크 코드 복사 후 URL에 직접 넣기
          </p>
          <button
            type="button"
            onClick={copyFull}
            className="inline-flex items-center justify-center gap-2 min-h-11 w-full rounded-xl bg-ink-900 px-4 text-sm font-medium text-white hover:bg-accent"
          >
            {copied === "full" ? (
              <Check className="h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            {copied === "full"
              ? "복사됨 — 북마크 수정 → URL에 Ctrl+V"
              : "북마크 코드 복사"}
          </button>

          <p className="font-medium text-ink-900 pt-1">
            또는 — 아래 버튼을 즐겨찾기로 드래그
          </p>
          <p className="text-xs text-ink-600">
            마우스 왼쪽 누른 채 주소창 아래 즐겨찾기 줄로 끌어다 놓으세요.
          </p>
          <div ref={dragHostRef} />

          <div className="rounded-lg border border-accent/30 bg-accent-muted/40 p-3 text-xs sm:text-sm">
            <p className="font-medium text-ink-900 mb-1">즐겨찾기 표시줄 켜기</p>
            <p>
              Chrome <strong>⋮</strong> → 북마크 → 즐겨찾기 표시줄 표시
              (또는 Ctrl+Shift+B)
            </p>
          </div>
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
