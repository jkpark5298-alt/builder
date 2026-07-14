"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

const CACHE_KEY = (id: string) => `yfc-video:${id}`;

export function cacheVideoSnapshot(video: { id: string }) {
  try {
    sessionStorage.setItem(CACHE_KEY(video.id), JSON.stringify(video));
  } catch {
    /* ignore */
  }
}

/** 서버에 아직 없으면(구 /tmp 레이스) 잠시 재시도 후 홈으로 안내 */
export function VideoNotFoundRecovery({ id }: { id: string }) {
  const router = useRouter();
  const [tries, setTries] = useState(0);
  const [message, setMessage] = useState("영상을 찾는 중…");

  useEffect(() => {
    let cancelled = false;
    let n = 0;

    const tick = async () => {
      n += 1;
      if (!cancelled) setTries(n);
      try {
        const res = await fetch(`/api/videos/${id}`, { cache: "no-store" });
        if (res.ok) {
          router.refresh();
          return;
        }
      } catch {
        /* retry */
      }

      if (n >= 8) {
        if (!cancelled) {
          setMessage(
            "영상을 찾지 못했습니다. 홈에서 스크립트를 다시 붙여넣고 「스크립트로 요약 · 검증」을 눌러 주세요."
          );
        }
        return;
      }
      if (!cancelled) {
        setMessage(`저장소 동기화 대기 중… (${n}/8)`);
      }
      window.setTimeout(tick, 1500);
    };

    tick();
    return () => {
      cancelled = true;
    };
  }, [id, router]);

  return (
    <div className="mx-auto max-w-lg rounded-2xl border border-ink-200 bg-white p-6 text-center space-y-4 mt-10">
      <Loader2 className="h-8 w-8 animate-spin text-accent mx-auto" />
      <p className="font-medium text-ink-900">{message}</p>
      <p className="text-sm text-ink-500">시도 {tries}회</p>
      <a
        href="/#paste"
        className="inline-flex min-h-11 items-center justify-center rounded-xl bg-ink-900 px-4 text-sm font-medium text-white"
      >
        홈으로 돌아가기
      </a>
    </div>
  );
}
