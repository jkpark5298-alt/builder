"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { AlertTriangle, Loader2, Link2 } from "lucide-react";
import { extractVideoId } from "@/lib/youtube";
import { ScriptCopyHelper } from "./ScriptCopyHelper";

const CLIENT_TIMEOUT_MS = 55_000;

export function UrlPasteForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [creatorNotes, setCreatorNotes] = useState("");
  const [pastedScript, setPastedScript] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needManual, setNeedManual] = useState(false);

  async function startAnalyze(withScript: boolean) {
    setError(null);
    setLoading(true);
    setStatus(
      withScript
        ? "붙여넣은 스크립트로 요약·검증 준비 중…"
        : "유튜브 정보 조회 · 자막 자동 수집 시도 중…"
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);

    try {
      const res = await fetch("/api/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          youtubeUrl: url.trim(),
          creatorNotes: creatorNotes.trim() || undefined,
          pastedScript: withScript
            ? pastedScript.trim() || undefined
            : undefined,
        }),
      });

      const raw = await res.text();
      let data: {
        error?: string;
        video?: { id: string; transcriptSource?: string };
        scriptNotice?: string;
      } = {};
      try {
        data = raw ? (JSON.parse(raw) as typeof data) : {};
      } catch {
        throw new Error(
          res.ok
            ? "서버 응답을 읽지 못했습니다."
            : `서버 오류 (${res.status}). 잠시 후 다시 시도해 주세요.`
        );
      }

      if (!res.ok) {
        throw new Error(data.error || `처리 실패 (${res.status})`);
      }
      if (!data.video?.id) {
        throw new Error("영상 ID를 받지 못했습니다. 다시 시도해 주세요.");
      }

      const source = data.video.transcriptSource;
      const noScript = source === "none" || source === "creator_meta";
      if (noScript && !withScript) {
        setNeedManual(true);
        setStatus(
          "자동 자막 수집이 안 됐습니다. 아래 칸에 스크립트를 붙여넣은 뒤 다시 눌러 주세요."
        );
        // 상세로 이동 — 거기서도 붙여넣기 가능
        router.push(`/videos/${data.video.id}`);
        router.refresh();
        return;
      }

      setStatus("완료. 팩트체크 화면으로 이동합니다…");
      router.push(`/videos/${data.video.id}`);
      router.refresh();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError(
          "시간이 너무 오래 걸렸습니다. 네트워크를 확인하거나, 스크립트를 붙여넣은 뒤 다시 시도해 주세요."
        );
      } else {
        const message = err instanceof Error ? err.message : "처리 실패";
        if (/Failed to fetch|NetworkError|Load failed|fetch/i.test(message)) {
          setError(
            "서버에 연결할 수 없습니다. Wi‑Fi/데이터를 확인한 뒤 다시 시도해 주세요."
          );
        } else {
          setError(message);
        }
      }
      setStatus(null);
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      setError("유튜브 주소를 입력해 주세요.");
      return;
    }
    if (!extractVideoId(trimmedUrl)) {
      setError(
        "유효한 유튜브 URL이 아닙니다. 공유 링크로 붙여넣어도 됩니다. (youtube.com / youtu.be)"
      );
      return;
    }

    const hasScript = pastedScript.trim().length > 80;
    if (needManual && !hasScript) {
      setError(
        "자막을 자동으로 못 가져왔습니다. 아래 「스크립트 붙여넣기」에 80자 이상 붙여넣은 뒤 다시 눌러 주세요."
      );
      return;
    }

    await startAnalyze(hasScript);
  }

  const busy = loading;

  return (
    <form
      id="paste"
      onSubmit={onSubmit}
      className="relative overflow-hidden rounded-2xl border border-ink-200 bg-white/80 p-5 sm:p-6 shadow-sm"
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "radial-gradient(circle at 10% 20%, rgba(196,92,38,0.15), transparent 40%), radial-gradient(circle at 90% 80%, rgba(26,36,48,0.08), transparent 35%)",
        }}
      />
      <div className="relative space-y-4">
        <div className="flex items-center gap-2 text-accent">
          <Link2 className="h-5 w-5" />
          <span className="text-sm font-medium tracking-wide uppercase">
            Share & Summarize
          </span>
        </div>
        <div>
          <h1 className="font-display text-2xl sm:text-3xl md:text-4xl text-ink-900 mb-2">
            YouTube FactCheck
          </h1>
          <ol className="text-ink-600 text-[15px] leading-relaxed space-y-1 list-decimal pl-5">
            <li>
              <strong>유튜브 링크</strong> 붙여넣기 → <strong>조회 · 검증</strong>
            </li>
            <li>가능하면 <strong>자막 자동 수집</strong></li>
            <li>안 되면 <strong>스크립트 수동 붙여넣기</strong> → 다시 검증</li>
            <li>
              다음: <strong>팩트체크 정리</strong> → <strong>보고서</strong> →{" "}
              <strong>완료</strong>
            </li>
          </ol>
        </div>

        <label className="block text-sm text-ink-600">
          1. 유튜브 주소
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="유튜브에서 공유 → 링크 붙여넣기"
            inputMode="url"
            enterKeyHint="go"
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="url"
            className="mt-1.5 w-full rounded-xl border border-ink-200 bg-white px-4 py-3.5 text-base text-ink-900 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </label>

        <button
          type="submit"
          disabled={busy}
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-ink-900 min-h-12 px-5 py-3.5 text-white font-medium hover:bg-accent disabled:opacity-60 transition-colors"
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              조회 · 검증 중…
            </>
          ) : pastedScript.trim().length > 80 ? (
            "스크립트로 요약 · 검증"
          ) : (
            "조회 · 검증 시작"
          )}
        </button>

        {(busy || status) && (
          <div
            className="rounded-xl border border-ink-200 bg-ink-50 px-4 py-3 text-sm text-ink-700"
            role="status"
            aria-live="polite"
          >
            {status ||
              "처리 중입니다. 화면을 끄지 말고 잠시만 기다려 주세요."}
          </div>
        )}

        {error && (
          <p
            className="rounded-xl border border-verify-false/30 bg-verify-false/5 px-4 py-3 text-sm text-verify-false"
            role="alert"
          >
            {error}
          </p>
        )}

        {(needManual || pastedScript.length > 0) && (
          <div
            className="rounded-xl border border-accent/40 bg-accent-muted/50 px-4 py-3 text-sm text-ink-800"
            role="status"
          >
            <div className="flex gap-2 items-start">
              <AlertTriangle className="h-5 w-5 text-accent shrink-0 mt-0.5" />
              <p>
                <strong>자동 자막 수집 실패 시:</strong> 유튜브에서 스크립트를
                복사해 아래에 붙여넣고, 다시 「스크립트로 요약 · 검증」을
                누르세요.
              </p>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-sm font-medium text-ink-800">
            2. (선택·수동) 스크립트(자막) 붙여넣기
          </p>
          <ScriptCopyHelper youtubeUrl={url || undefined} />
          <label className="block text-sm text-ink-600">
            스크립트(자막)
            <textarea
              value={pastedScript}
              onChange={(e) => setPastedScript(e.target.value)}
              rows={5}
              placeholder="아이폰: 유튜브 → ⋯ → 스크립트 표시 → 길게 눌러 복사 → 여기에 붙여넣기"
              className="mt-1.5 w-full rounded-xl border border-ink-200 bg-white px-3 py-3 text-sm sm:text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </label>
          {pastedScript.trim().length > 0 && (
            <p className="text-xs text-ink-500">
              {pastedScript.trim().length}자
              {pastedScript.trim().length < 80
                ? " · 조금 더 붙여넣으면 검증할 수 있습니다"
                : " · 준비됨"}
            </p>
          )}
        </div>

        {/* 아이폰: 붙여넣기 후 버튼이 바로 보이도록 하단에도 CTA */}
        <button
          type="submit"
          disabled={busy}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-accent min-h-12 px-5 py-3.5 text-white font-medium hover:bg-ink-900 disabled:opacity-60 transition-colors"
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              처리 중…
            </>
          ) : pastedScript.trim().length > 80 ? (
            "스크립트로 요약 · 검증"
          ) : (
            "조회 · 검증 시작"
          )}
        </button>

        <label className="block text-sm text-ink-600">
          제작자 설명·챕터 (선택)
          <textarea
            value={creatorNotes}
            onChange={(e) => setCreatorNotes(e.target.value)}
            rows={3}
            placeholder={`예)\n00:00 인트로\n03:47 …`}
            className="mt-1.5 w-full rounded-xl border border-ink-200 bg-white px-3 py-3 text-sm sm:text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </label>

        <div className="rounded-xl border border-ink-100 bg-white/70 px-4 py-3 text-xs sm:text-sm text-ink-600 leading-relaxed">
          <p className="font-medium text-ink-800 mb-1">검증 후 다음 단계</p>
          <p>
            ① <strong>임시 저장</strong>에서 팩트체크 항목 정리 → ②{" "}
            <strong>보고서 작성</strong>(PDF·인포) → ③ <strong>완료</strong>{" "}
            목록. 수정이 필요하면 완료에서 다시 임시 저장으로 옮길 수 있습니다.
          </p>
        </div>
      </div>
    </form>
  );
}
