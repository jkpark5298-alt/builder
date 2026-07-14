"use client";

import {
  Mail,
  MessageCircle,
  FileDown,
  ImageDown,
  Trash2,
  Share2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { VideoRecord } from "@/lib/types";
import { canExportArtifacts } from "@/lib/factcheck-client";

declare global {
  interface Window {
    Kakao?: {
      isInitialized: () => boolean;
      init: (key: string) => void;
      Share: {
        sendDefault: (opts: Record<string, unknown>) => void;
      };
    };
  }
}

export function ActionBar({ video }: { video: VideoRecord }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const ready = canExportArtifacts(video);
  const kakaoConfigured = Boolean(process.env.NEXT_PUBLIC_KAKAO_JS_KEY);

  async function markShared(channel: "email" | "kakao") {
    await fetch(`/api/videos/${video.id}/infographic`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel }),
    });
  }

  function shareEmail() {
    if (!ready) return;
    const subject = encodeURIComponent(`[FactCheck] ${video.title}`);
    const body = encodeURIComponent(
      [
        video.title,
        video.channel,
        video.youtubeUrl,
        "",
        video.overview,
        "",
        `상세: ${window.location.href}`,
        `PDF: ${window.location.origin}/api/videos/${video.id}/pdf`,
        `인포그래픽: ${window.location.origin}/api/videos/${video.id}/infographic`,
      ].join("\n")
    );
    void markShared("email");
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  }

  async function shareKakao() {
    if (!ready) return;
    const key = process.env.NEXT_PUBLIC_KAKAO_JS_KEY;
    if (!key) {
      alert(
        "카카오톡 공유를 쓰려면 NEXT_PUBLIC_KAKAO_JS_KEY를 .env.local에 설정하세요."
      );
      return;
    }

    if (!window.Kakao) {
      await loadKakaoSdk();
    }
    if (window.Kakao && !window.Kakao.isInitialized()) {
      window.Kakao.init(key);
    }

    const origin = window.location.origin;
    window.Kakao?.Share.sendDefault({
      objectType: "feed",
      content: {
        title: video.title,
        description: video.overview.slice(0, 120),
        imageUrl: video.thumbnailUrl,
        link: {
          mobileWebUrl: window.location.href,
          webUrl: window.location.href,
        },
      },
      buttons: [
        {
          title: "보고서 보기",
          link: {
            mobileWebUrl: window.location.href,
            webUrl: window.location.href,
          },
        },
        {
          title: "인포그래픽",
          link: {
            mobileWebUrl: `${origin}/api/videos/${video.id}/infographic`,
            webUrl: `${origin}/api/videos/${video.id}/infographic`,
          },
        },
      ],
    });
    void markShared("kakao");
  }

  function downloadSvg() {
    if (!ready) return;
    window.location.href = `/api/videos/${video.id}/infographic?download=1`;
  }

  async function remove() {
    if (!confirm("이 항목을 삭제할까요?")) return;
    setBusy(true);
    await fetch(`/api/videos/${video.id}`, { method: "DELETE" });
    router.push("/");
    router.refresh();
  }

  const btn =
    "inline-flex items-center justify-center gap-2 min-h-11 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors";
  const enabled =
    "border-ink-200 bg-white hover:border-accent hover:text-accent active:bg-ink-50";
  const disabled = "border-ink-100 bg-ink-50 text-ink-300 pointer-events-none";

  return (
    <div className="space-y-2">
      {!ready && (
        <p className="text-sm text-accent bg-accent-muted/50 rounded-xl px-3 py-2">
          ① 팩트체크 중 → <strong>임시 저장</strong> 목록. ② 팩트체크 완료 →{" "}
          <strong>보고서 저장</strong> 목록. ③ PDF 생성 후 공유·저장 가능.
        </p>
      )}
      <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
        <a
          href={ready ? `/api/videos/${video.id}/pdf` : undefined}
          aria-disabled={!ready}
          className={`${btn} ${ready ? enabled : disabled}`}
        >
          <FileDown className="h-4 w-4 shrink-0" />
          PDF 보고서
        </a>
        <button
          type="button"
          disabled={!ready}
          onClick={downloadSvg}
          className={`${btn} ${ready ? enabled : disabled}`}
        >
          <ImageDown className="h-4 w-4 shrink-0" />
          SVG 다운로드
        </button>
        <button
          type="button"
          disabled={!ready}
          onClick={shareEmail}
          className={`${btn} ${ready ? enabled : disabled}`}
        >
          <Mail className="h-4 w-4 shrink-0" />
          이메일
        </button>
        <button
          type="button"
          disabled={!ready}
          onClick={shareKakao}
          className={`${btn} ${ready ? enabled : disabled}`}
          title={
            kakaoConfigured
              ? "카카오톡 공유"
              : "NEXT_PUBLIC_KAKAO_JS_KEY 설정 필요"
          }
        >
          <MessageCircle className="h-4 w-4 shrink-0" />
          카톡{kakaoConfigured ? "" : " (키 필요)"}
        </button>
        {ready && (
          <a
            href={`/api/videos/${video.id}/infographic`}
            target="_blank"
            rel="noreferrer"
            className={`${btn} ${enabled} col-span-2 sm:col-span-1`}
          >
            <Share2 className="h-4 w-4 shrink-0" />
            인포그래픽 보기
          </a>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={remove}
          className={`${btn} border-verify-false/30 bg-white text-verify-false hover:bg-verify-false/5 col-span-2 sm:col-span-1`}
        >
          <Trash2 className="h-4 w-4 shrink-0" />
          삭제
        </button>
      </div>
    </div>
  );
}

function loadKakaoSdk() {
  return new Promise<void>((resolve, reject) => {
    if (document.getElementById("kakao-sdk")) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.id = "kakao-sdk";
    s.src = "https://t1.kakaocdn.net/kakao_js_sdk/2.7.4/kakao.min.js";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Kakao SDK load failed"));
    document.head.appendChild(s);
  });
}
