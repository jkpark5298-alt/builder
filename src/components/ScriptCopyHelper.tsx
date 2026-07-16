"use client";

import {
  Check,
  ClipboardCopy,
  Copy,
  ExternalLink,
  Loader2,
  Monitor,
  Smartphone,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { extractVideoId } from "@/lib/youtube";
import { cleanYoutubeTranscriptAi } from "@/lib/youtube-transcript-ai";

/**
 * 유튜브 페이지에서 실행 → 자막을 클립보드에 복사.
 */
const BOOKMARKLET_BODY = `void(async()=>{try{alert('자막 복사 시작…');const sleep=ms=>new Promise(r=>setTimeout(r,ms));async function openPanel(){const items=[...document.querySelectorAll('button, tp-yt-paper-item, yt-list-item-view-model, span')];const btn=items.find(el=>/스크립트 표시|Show transcript|스크립트/i.test((el.textContent||'')+(el.getAttribute('aria-label')||'')));if(btn){btn.click();await sleep(1500);}}function scrape(){return[...document.querySelectorAll('ytd-transcript-segment-renderer yt-formatted-string, ytd-transcript-segment-renderer .segment-text, #segments-container yt-formatted-string')].map(n=>(n.textContent||'').trim()).filter(Boolean);}let lines=scrape();if(!lines.length){await openPanel();lines=scrape();}if(lines.length){const text=[...new Set(lines)].join('\\n');await navigator.clipboard.writeText(text);alert('자막 '+lines.length+'줄을 복사했습니다.\\n② 스크립트(자막) 칸에 Ctrl+V 하세요.');return;}const tracks=window.ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;if(!tracks||!tracks.length){alert('자막을 못 찾았습니다.\\n⋯ → 스크립트 표시를 연 뒤 다시 눌러 주세요.');return;}const pick=tracks.find(t=>(t.languageCode||'').startsWith('ko'))||tracks.find(t=>t.kind!=='asr')||tracks[0];let url=String(pick.baseUrl).split('\\u0026').join('&').split('&amp;').join('&');if(!/[?&]fmt=/.test(url))url+=(url.includes('?')?'&':'?')+'fmt=json3';const res=await fetch(url);const data=await res.json();const text=(data.events||[]).flatMap(e=>e.segs||[]).map(s=>s.utf8||'').join(' ').replace(/\\s+/g,' ').trim();if(!text||text.length<20){alert('자막 텍스트가 비었습니다.');return;}await navigator.clipboard.writeText(text);alert('자막 '+text.length+'자를 복사했습니다.\\n② 스크립트(자막) 칸에 Ctrl+V 하세요.');}catch(e){alert('실패: '+(e&&e.message?e.message:e));}})();`;

export const YOUTUBE_SCRIPT_BOOKMARKLET = `javascript:${BOOKMARKLET_BODY}`;

type Props = {
  youtubeUrl?: string;
  /** 가져온 자막을 ② 스크립트(자막) 칸에 채움 */
  onScriptFetched?: (script: string) => void;
  onFetchError?: (message: string) => void;
  compact?: boolean;
};

type Step = "auto" | "app" | "easy" | "bookmark";

export function ScriptCopyHelper({
  youtubeUrl,
  onScriptFetched,
  onFetchError,
}: Props) {
  const [copied, setCopied] = useState<"full" | null>(null);
  const [tab, setTab] = useState<"pc" | "ios">(() => {
    if (typeof navigator === "undefined") return "pc";
    return /iPhone|iPad|iPod/i.test(navigator.userAgent) ? "ios" : "pc";
  });
  const [step, setStep] = useState<Step>("auto");
  const [fetching, setFetching] = useState(false);
  const [fetchMsg, setFetchMsg] = useState<string | null>(null);
  const [fetchErr, setFetchErr] = useState<string | null>(null);
  const dragHostRef = useRef<HTMLDivElement>(null);

  const videoId = useMemo(
    () => (youtubeUrl?.trim() ? extractVideoId(youtubeUrl.trim()) : null),
    [youtubeUrl]
  );

  const watchUrl = useMemo(() => {
    if (videoId) return `https://www.youtube.com/watch?v=${videoId}`;
    return youtubeUrl?.trim() || null;
  }, [youtubeUrl, videoId]);

  const appUrl = useMemo(() => {
    if (videoId) return `https://youtube-transcript.ai/?v=${videoId}`;
    return "https://youtube-transcript.ai/";
  }, [videoId]);

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
    a.textContent = "YT 스크립트 복사 ← 여기를 드래그";
    a.addEventListener("click", (e) => {
      e.preventDefault();
      alert("드래그로 즐겨찾기에 넣거나, ‘북마크 코드 복사’를 쓰세요.");
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

  async function fetchDirectFromApp(id: string): Promise<string | null> {
    const urls = [
      `https://youtube-transcript.ai/transcript/${id}.txt`,
      `https://youtube-transcript.ai/transcript/${id}.txt?lang=ko`,
      `https://youtube-transcript.ai/transcript/${id}.txt?lang=en`,
    ];
    for (const u of urls) {
      try {
        const res = await fetch(u, {
          signal: AbortSignal.timeout(40_000),
        });
        if (!res.ok) continue;
        const raw = await res.text();
        const text = cleanYoutubeTranscriptAi(raw);
        if (text.length >= 80) return text;
      } catch {
        /* next url */
      }
    }
    return null;
  }

  async function fetchTranscriptAuto() {
    setFetchErr(null);
    setFetchMsg(null);
    if (!videoId && !youtubeUrl?.trim()) {
      setFetchErr("먼저 ① 유튜브 주소를 붙여넣어 주세요.");
      return;
    }
    setFetching(true);
    try {
      // 1) 브라우저 → youtube-transcript.ai 직접 (CORS 허용)
      if (videoId) {
        const direct = await fetchDirectFromApp(videoId);
        if (direct) {
          onScriptFetched?.(direct);
          setFetchMsg(
            `${direct.length.toLocaleString()}자를 ② 스크립트(자막) 칸에 넣었습니다.`
          );
          return;
        }
      }

      // 2) 서버 프록시 재시도
      const q = videoId
        ? `videoId=${encodeURIComponent(videoId)}`
        : `url=${encodeURIComponent(youtubeUrl!.trim())}`;
      const res = await fetch(`/api/transcript?${q}`, {
        signal: AbortSignal.timeout(55_000),
      });
      const data = (await res.json()) as {
        error?: string;
        transcript?: string;
        length?: number;
        langTried?: string;
      };
      if (!res.ok || !data.transcript) {
        throw new Error(data.error || "자막을 가져오지 못했습니다.");
      }
      onScriptFetched?.(data.transcript);
      setFetchMsg(
        `${data.length?.toLocaleString() ?? data.transcript.length}자를 ② 스크립트(자막) 칸에 넣었습니다.`
      );
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : "자막 자동 가져오기에 실패했습니다.";
      setFetchErr(msg);
      onFetchError?.(msg);
      setStep("app");
    } finally {
      setFetching(false);
    }
  }

  return (
    <div className="rounded-xl border border-ink-200 bg-white/90 p-4 space-y-4">
      <div>
        <p className="text-base font-medium text-ink-900">스크립트(자막) 가져오기</p>
        <p className="text-xs text-ink-500 mt-1">
          <strong>youtube-transcript.ai</strong>로 자막을 가져와{" "}
          <strong>② 스크립트(자막)</strong> 칸에 자동 붙여넣기합니다.
          <span className="block mt-0.5 text-ink-400">
            ※ 팩트체크(AI 답변) 칸이 아닙니다.
          </span>
        </p>
      </div>

      <div className="flex gap-1 rounded-lg bg-ink-100/80 p-0.5">
        {(
          [
            ["auto", "자동 가져오기"],
            ["app", "앱 열기"],
            ["easy", "유튜브 수동"],
            ["bookmark", "북마크"],
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

      {step === "auto" && (
        <div className="space-y-3 text-sm text-ink-800">
          {!videoId && (
            <p className="text-xs text-verify-false">
              ① 유튜브 주소를 먼저 넣어 주세요.
            </p>
          )}
          <button
            type="button"
            onClick={() => void fetchTranscriptAuto()}
            disabled={fetching || !videoId}
            className="inline-flex w-full items-center justify-center gap-2 min-h-12 rounded-xl bg-accent px-4 text-sm font-medium text-white hover:bg-ink-900 disabled:opacity-50"
          >
            {fetching ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                자막 가져오는 중…
              </>
            ) : (
              <>
                <ClipboardCopy className="h-4 w-4" />
                자막 자동 가져오기 → 스크립트 칸에 넣기
              </>
            )}
          </button>
          {fetchMsg && (
            <p
              className="text-sm font-medium text-emerald-800 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2.5 flex gap-2"
              role="status"
              aria-live="polite"
            >
              <Check className="h-4 w-4 shrink-0 mt-0.5" />
              <span>자막 복사 완료 — {fetchMsg}</span>
            </p>
          )}
          {fetchErr && (
            <p
              className="text-sm font-medium text-verify-false rounded-lg border border-verify-false/30 bg-verify-false/5 px-3 py-2.5"
              role="alert"
            >
              자막 복사 실패 — {fetchErr} 「앱 열기」탭을 사용하세요.
            </p>
          )}
          <p className="text-[11px] text-ink-500 leading-relaxed">
            서비스: youtube-transcript.ai (무료 API). 자막이 없는 영상은 실패할
            수 있습니다.
          </p>
        </div>
      )}

      {step === "app" && (
        <div className="space-y-3 text-sm text-ink-800 leading-relaxed">
          <ol className="list-decimal pl-5 space-y-2">
            <li>
              아래 버튼으로 <strong>youtube-transcript.ai</strong>를 엽니다.
            </li>
            <li>
              페이지에서 <strong>Copy</strong>로 자막을 복사합니다.
            </li>
            <li>
              여기로 돌아와 <strong>② 스크립트(자막)</strong> 칸에 붙여넣기
              (팩트체크 칸 ❌)
            </li>
          </ol>
          <a
            href={appUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex w-full items-center justify-center gap-2 min-h-11 rounded-xl bg-ink-900 px-4 text-sm font-medium text-white hover:bg-accent"
          >
            <ExternalLink className="h-4 w-4" />
            youtube-transcript.ai 열기
          </a>
          {watchUrl && (
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(watchUrl)}
              className="inline-flex w-full items-center justify-center gap-2 min-h-10 rounded-xl border border-ink-200 bg-white text-xs font-medium"
            >
              <Copy className="h-3.5 w-3.5" />
              유튜브 URL 복사 (앱에 붙여넣기용)
            </button>
          )}
        </div>
      )}

      {step === "easy" && (
        <div className="space-y-3 text-sm text-ink-800 leading-relaxed">
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
          <ol className="list-decimal pl-5 space-y-2">
            <li>유튜브에서 ⋯ → 스크립트 표시</li>
            <li>전체 선택 후 복사</li>
            <li>
              <strong>② 스크립트(자막)</strong> 칸에 붙여넣기
            </li>
          </ol>
        </div>
      )}

      {step === "bookmark" && (
        <div className="space-y-3 text-sm text-ink-800">
          <button
            type="button"
            onClick={() => void copyFull()}
            className="inline-flex items-center justify-center gap-2 min-h-11 w-full rounded-xl bg-ink-900 px-4 text-sm font-medium text-white"
          >
            {copied === "full" ? (
              <Check className="h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            {copied === "full" ? "복사됨" : "북마크 코드 복사"}
          </button>
          <div ref={dragHostRef} />
        </div>
      )}
    </div>
  );
}
