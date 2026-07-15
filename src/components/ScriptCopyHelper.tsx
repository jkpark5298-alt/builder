"use client";

import {
  Check,
  ClipboardCopy,
  Copy,
  ExternalLink,
  Link2,
  Monitor,
  Smartphone,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { extractVideoId } from "@/lib/youtube";

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

type Step = "app" | "easy" | "bookmark" | "manual";

function buildTranscriptAppUrl(videoId: string | null): string {
  if (videoId) return `https://youtubetranscript.com/?v=${videoId}`;
  return "https://youtubetranscript.com/";
}

export function ScriptCopyHelper({ youtubeUrl }: Props) {
  const [copied, setCopied] = useState<"full" | "url" | null>(null);
  const [tab, setTab] = useState<"pc" | "ios">(() => {
    if (typeof navigator === "undefined") return "pc";
    return /iPhone|iPad|iPod/i.test(navigator.userAgent) ? "ios" : "pc";
  });
  const [step, setStep] = useState<Step>("app");
  const [phase, setPhase] = useState<1 | 2 | 3 | 4>(1);
  const dragHostRef = useRef<HTMLDivElement>(null);

  const videoId = useMemo(
    () => (youtubeUrl?.trim() ? extractVideoId(youtubeUrl.trim()) : null),
    [youtubeUrl]
  );

  const watchUrl = useMemo(() => {
    if (!youtubeUrl?.trim()) return null;
    if (videoId) return `https://www.youtube.com/watch?v=${videoId}`;
    return youtubeUrl.trim();
  }, [youtubeUrl, videoId]);

  const transcriptAppUrl = useMemo(
    () => buildTranscriptAppUrl(videoId),
    [videoId]
  );

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

  async function copyWatchUrl() {
    const text = watchUrl || youtubeUrl?.trim() || "";
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied("url");
    setPhase(2);
    setTimeout(() => setCopied(null), 4000);
  }

  function openTranscriptApp() {
    setPhase((p) => (p < 2 ? 2 : p));
    window.open(transcriptAppUrl, "_blank", "noopener,noreferrer");
  }

  async function requestSubtitles() {
    // 1) URL 복사 2) 자막 앱 열기
    if (watchUrl || youtubeUrl?.trim()) {
      try {
        await navigator.clipboard.writeText(watchUrl || youtubeUrl!.trim());
        setCopied("url");
        setTimeout(() => setCopied(null), 4000);
      } catch {
        /* 클립보드 실패해도 앱은 연다 */
      }
    }
    setPhase(2);
    window.open(transcriptAppUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="rounded-xl border border-ink-200 bg-white/90 p-4 space-y-4">
      <div>
        <p className="text-base font-medium text-ink-900">스크립트(자막) 가져오기</p>
        <p className="text-xs text-ink-500 mt-1">
          추천: 무료 웹앱{" "}
          <strong>youtubetranscript.com</strong>에서 자막 복사 → 여기 붙여넣기
        </p>
      </div>

      <div className="flex gap-1 rounded-lg bg-ink-100/80 p-0.5">
        {(
          [
            ["app", "자막 앱"],
            ["easy", "유튜브 수동"],
            ["bookmark", "북마크"],
            ["manual", "기기별"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setStep(id)}
            className={`flex-1 min-h-9 rounded-md text-[11px] sm:text-sm font-medium ${
              step === id ? "bg-white text-ink-900 shadow-sm" : "text-ink-500"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {step === "app" && (
        <div className="space-y-3 text-sm text-ink-800 leading-relaxed">
          <ol className="space-y-3">
            <li
              className={`rounded-xl border px-3 py-3 ${
                phase === 1
                  ? "border-accent bg-accent-muted/40"
                  : "border-ink-100 bg-ink-50/60"
              }`}
            >
              <p className="font-medium text-ink-900 mb-1">1. 자막 요청</p>
              <p className="text-xs text-ink-600 mb-2">
                유튜브 주소를 복사하고 무료 자막 앱으로 이동합니다.
              </p>
              {!videoId && (
                <p className="text-xs text-verify-false mb-2">
                  먼저 위에 유튜브 주소를 붙여넣어 주세요.
                </p>
              )}
              <button
                type="button"
                onClick={() => void requestSubtitles()}
                disabled={!videoId && !youtubeUrl?.trim()}
                className="inline-flex w-full items-center justify-center gap-2 min-h-11 rounded-xl bg-accent px-4 text-sm font-medium text-white hover:bg-ink-900 disabled:opacity-50"
              >
                <ExternalLink className="h-4 w-4" />
                자막 요청 · 앱으로 이동
              </button>
              {copied === "url" && (
                <p className="mt-2 text-xs text-accent font-medium flex items-center gap-1">
                  <Check className="h-3.5 w-3.5" />
                  유튜브 주소가 복사됐습니다
                </p>
              )}
            </li>

            <li
              className={`rounded-xl border px-3 py-3 ${
                phase === 2
                  ? "border-accent bg-accent-muted/40"
                  : "border-ink-100 bg-ink-50/60"
              }`}
            >
              <p className="font-medium text-ink-900 mb-1">
                2. 자막 앱에 URL 입력
              </p>
              <p className="text-xs text-ink-600 mb-2">
                <strong>youtubetranscript.com</strong>이 열리면 영상이 자동으로
                불러와집니다. 안 되면 복사한 주소를 붙여넣으세요.
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  onClick={() => void copyWatchUrl()}
                  disabled={!watchUrl}
                  className="inline-flex flex-1 items-center justify-center gap-2 min-h-10 rounded-xl border border-ink-200 bg-white px-3 text-xs font-medium hover:border-accent disabled:opacity-50"
                >
                  <Link2 className="h-3.5 w-3.5" />
                  URL 다시 복사
                </button>
                <button
                  type="button"
                  onClick={openTranscriptApp}
                  className="inline-flex flex-1 items-center justify-center gap-2 min-h-10 rounded-xl border border-ink-200 bg-white px-3 text-xs font-medium hover:border-accent"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  앱 다시 열기
                </button>
              </div>
              <button
                type="button"
                onClick={() => setPhase(3)}
                className="mt-2 text-xs text-accent font-medium underline"
              >
                앱에서 자막이 보임 → 다음
              </button>
            </li>

            <li
              className={`rounded-xl border px-3 py-3 ${
                phase === 3
                  ? "border-accent bg-accent-muted/40"
                  : "border-ink-100 bg-ink-50/60"
              }`}
            >
              <p className="font-medium text-ink-900 mb-1">3. 자막 복사</p>
              <p className="text-xs text-ink-600">
                사이트에서{" "}
                <strong>Copy entire transcript</strong> (전체 자막 복사)를
                누르거나, 자막 텍스트를 전체 선택 → 복사하세요.
              </p>
              <button
                type="button"
                onClick={() => setPhase(4)}
                className="mt-2 inline-flex items-center gap-1.5 min-h-10 rounded-xl bg-ink-900 px-3 text-xs font-medium text-white"
              >
                <ClipboardCopy className="h-3.5 w-3.5" />
                복사 완료 · 붙여넣기로
              </button>
            </li>

            <li
              className={`rounded-xl border px-3 py-3 ${
                phase === 4
                  ? "border-accent bg-accent-muted/40"
                  : "border-ink-100 bg-ink-50/60"
              }`}
            >
              <p className="font-medium text-ink-900 mb-1">4. 여기에 붙여넣기</p>
              <p className="text-xs text-ink-600">
                FactCheck로 돌아와 아래{" "}
                <strong>② 스크립트</strong> 칸에 붙여넣기 →{" "}
                <strong>스크립트로 요약 · 검증</strong>
              </p>
            </li>
          </ol>

          <p className="text-[11px] text-ink-500 leading-relaxed">
            무료 웹 서비스(youtubetranscript.com)입니다. 자막이 없는 영상은
            가져올 수 없습니다.
          </p>
        </div>
      )}

      {step === "easy" && (
        <div className="space-y-3 text-sm text-ink-800 leading-relaxed">
          <p className="font-medium text-ink-900">
            {tab === "ios" ? "아이폰에서 수동 복사" : "PC에서 수동 복사"}
          </p>
          {tab === "ios" ? (
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
                    (Safari 또는 YouTube 앱)
                  </>
                ) : (
                  <>유튜브에서 영상을 엽니다.</>
                )}
              </li>
              <li>
                제목 아래 <strong>⋯ 더보기</strong> → <strong>스크립트 표시</strong>
              </li>
              <li>
                자막 목록을 <strong>길게 누르기</strong> → <strong>텍스트 선택</strong> →{" "}
                <strong>전체 선택</strong> → <strong>복사</strong>
              </li>
              <li>
                FactCheck로 돌아와 붙여넣기 칸을 <strong>길게 눌러 붙여넣기</strong>
              </li>
            </ol>
          ) : (
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
                  </>
                ) : (
                  <>먼저 유튜브 주소를 입력한 뒤 영상을 엽니다.</>
                )}
              </li>
              <li>
                <strong>⋯</strong> → <strong>스크립트 표시</strong>
              </li>
              <li>
                자막 클릭 → Ctrl+A → Ctrl+C → FactCheck에 Ctrl+V
              </li>
            </ol>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setTab("ios")}
              className={`inline-flex items-center gap-1 min-h-10 rounded-lg border px-3 text-xs ${
                tab === "ios"
                  ? "border-accent bg-accent-muted text-accent"
                  : "border-ink-200"
              }`}
            >
              <Smartphone className="h-3.5 w-3.5" />
              아이폰
            </button>
            <button
              type="button"
              onClick={() => setTab("pc")}
              className={`inline-flex items-center gap-1 min-h-10 rounded-lg border px-3 text-xs ${
                tab === "pc"
                  ? "border-accent bg-accent-muted text-accent"
                  : "border-ink-200"
              }`}
            >
              <Monitor className="h-3.5 w-3.5" />
              PC
            </button>
          </div>
        </div>
      )}

      {step === "bookmark" && (
        <div className="space-y-4 text-sm text-ink-800 leading-relaxed">
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
          <div ref={dragHostRef} />
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
              PC는 <strong>자막 앱</strong> 탭 또는 유튜브 ⋯ → 스크립트 표시가
              가장 확실합니다.
            </p>
          ) : (
            <ol className="list-decimal pl-5 space-y-2 text-sm text-ink-700 leading-relaxed">
              <li>
                <strong>자막 앱</strong> 탭의 「자막 요청 · 앱으로 이동」을
                권장합니다.
              </li>
              <li>
                Safari로 열면 Copy entire transcript 후 FactCheck에 붙여넣기
              </li>
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
