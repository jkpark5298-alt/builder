"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardPaste, Loader2 } from "lucide-react";
import type { VideoRecord } from "@/lib/types";
import { isYoutubeInput } from "@/lib/input-mode";
import { detectPasteKind } from "@/lib/paste-organize";
import { normalizeAiOverviewPaste } from "@/lib/text-format";
import { FLOW, flowLabel, PENDING_OVERVIEW_KEY } from "@/lib/flow-steps";
import {
  EXTERNAL_APP_LABEL,
  launchExternalApp,
  type ExternalAppId,
} from "@/lib/external-apps";
import { ScriptCopyHelper } from "@/components/ScriptCopyHelper";

type Role = "transcript" | "overview";

function guessRole(video: VideoRecord, text: string): Role {
  const detected = detectPasteKind(text);
  if (detected.kind === "overview" && detected.confidence >= 0.7) {
    return "overview";
  }
  const hasScript = (video.transcript ?? "").trim().length >= 80;
  const hasOverview = (video.overview ?? "").trim().length >= 40;
  if (!hasScript && text.trim().length >= 80) return "transcript";
  if (!hasOverview && text.trim().length >= 40) return "overview";
  return "overview";
}

const ROLE_LABEL: Record<Role, string> = {
  transcript: "원문",
  overview: "요약",
};

export function AiPasteInbox({ video }: { video: VideoRecord }) {
  const router = useRouter();
  const [paste, setPaste] = useState("");
  const [role, setRole] = useState<Role | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    try {
      const pending = sessionStorage.getItem(PENDING_OVERVIEW_KEY);
      if (!pending?.trim()) return;
      sessionStorage.removeItem(PENDING_OVERVIEW_KEY);
      setPaste(pending.trim());
      setRole("overview");
      setHint("제미나이 API 요약이 자동으로 채워졌습니다. 확인 후 저장하세요.");
    } catch {
      /* ignore */
    }
  }, []);

  const guessed = useMemo(
    () => (paste.trim().length >= 20 ? guessRole(video, paste) : null),
    [paste, video]
  );
  const active = role ?? guessed ?? "overview";

  async function patch(body: Record<string, unknown>) {
    const res = await fetch(`/api/videos/${video.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(data.error || "저장하지 못했습니다.");
  }

  function openExternalAfterCopyTranscript(app: ExternalAppId) {
    const text = (video.transcript || "").trim();
    if (text.length < 40) {
      setError("저장된 자막이 없습니다. 위에서 자막을 먼저 가져오세요.");
      return;
    }
    setError(null);
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setHint(
          `자막을 복사했습니다 · ${EXTERNAL_APP_LABEL[app]}에서 붙여 요약한 뒤, 아래에 요약을 붙이세요.`
        );
      })
      .catch(() => {
        setError("복사에 실패했습니다. 자막을 직접 복사해 주세요.");
      });
    launchExternalApp(app);
  }

  async function apply() {
    const text = paste.trim();
    setError(null);
    setHint(null);
    if (text.length < 40) {
      setError("조금 더 붙여넣어 주세요.");
      return;
    }
    setBusy(true);
    try {
      if (active === "transcript") {
        if (video.status === "report_input_draft") {
          await patch({
            updateReportInput: {
              title: video.title,
              pastedScript: text,
            },
          });
        } else if (isYoutubeInput(video)) {
          const res = await fetch(`/api/videos/${video.id}/reprocess`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pastedScript: text }),
          });
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          if (!res.ok) throw new Error(data.error || "원문을 넣지 못했습니다.");
        } else {
          await patch({ pastedScript: text });
        }
        setHint("원문을 넣었습니다. 이어서 요약을 붙이면 됩니다.");
      } else if (active === "overview") {
        const overview = normalizeAiOverviewPaste(text) || text;
        await patch({
          updateOverview: { overview, complete: true },
        });
        setHint(
          `${flowLabel("pasteSummary")}·저장 완료. 「1. 자막·요약」에 반영됨. 다음: ${flowLabel("copySummary")} → ${flowLabel("pasteReport")}.`
        );
      }
      setPaste("");
      setRole(null);
      router.refresh();
      window.setTimeout(() => {
        document
          .getElementById("general-summary")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 300);
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-ink-900 bg-white p-4 sm:p-5 space-y-3 print:hidden">
      <div className="flex items-start gap-2">
        <ClipboardPaste className="h-5 w-5 mt-0.5 shrink-0" />
        <div>
          <h2 className="font-medium text-ink-900">외부 AI 답변 붙여넣기</h2>
          <p className="text-xs text-ink-500 mt-0.5">
            제미나이·다글로에서 <strong>받은 요약</strong>을 아래 칸에 붙입니다.
          </p>
        </div>
      </div>
      <ol className="text-xs text-ink-700 leading-relaxed list-none ml-0 space-y-0.5 rounded-lg bg-ink-50 border border-ink-100 px-3 py-2">
        <li>{flowLabel("pasteSummary")} — 탭을 <strong>요약</strong>으로</li>
        <li>
          {FLOW.pasteSummary.n}. 제미나이 요약을 아래 칸에 붙여넣기
        </li>
        <li>
          {flowLabel("saveSummary", "요약으로 넣기")} (정리·저장 포함)
        </li>
      </ol>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={(video.transcript || "").trim().length < 40}
          onClick={() => openExternalAfterCopyTranscript("gemini")}
          className="inline-flex items-center min-h-9 rounded-lg border border-ink-200 bg-white px-3 text-xs font-medium hover:border-accent disabled:opacity-50"
        >
          제미나이
        </button>
        <button
          type="button"
          disabled={(video.transcript || "").trim().length < 40}
          onClick={() => openExternalAfterCopyTranscript("daglo")}
          className="inline-flex items-center min-h-9 rounded-lg border border-ink-200 bg-white px-3 text-xs font-medium hover:border-accent disabled:opacity-50"
        >
          다글로
        </button>
        <span className="text-[11px] text-ink-500 self-center">
          자막 복사 후 앱 열기
        </span>
      </div>
      {isYoutubeInput(video) ? (
        <details className="rounded-xl border border-ink-200 bg-ink-50/50 px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium text-ink-800">
            {flowLabel("copyScript")} · 유튜브에서 가져오기
          </summary>
          <div className="mt-3">
            <ScriptCopyHelper
              youtubeUrl={video.youtubeUrl}
              onScriptFetched={(script) => {
                setPaste(script);
                setRole("transcript");
                setHint(
                  "자막을 가져왔습니다. 「원문으로 넣기」를 누르면 저장됩니다."
                );
              }}
            />
          </div>
        </details>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(ROLE_LABEL) as Role[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setRole(key)}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-medium border ${
              active === key
                ? "bg-ink-900 text-white border-ink-900"
                : "bg-white text-ink-600 border-ink-200"
            }`}
          >
            {ROLE_LABEL[key]}
            {!role && guessed === key ? " · 추정" : ""}
          </button>
        ))}
      </div>
      <textarea
        value={paste}
        onChange={(e) => {
          setPaste(e.target.value);
          setRole(null);
        }}
        rows={8}
        placeholder="제미나이·다글로에서 받은 요약을 여기에 붙이세요."
        className="w-full rounded-xl border border-ink-200 bg-ink-50/40 px-3 py-3 text-sm outline-none focus:border-ink-900 focus:bg-white"
      />
      {error ? (
        <p className="text-sm text-verify-false" role="alert">
          {error}
        </p>
      ) : null}
      {hint ? <p className="text-sm text-ink-700">{hint}</p> : null}
      <button
        type="button"
        disabled={busy}
        onClick={() => void apply()}
        className="w-full sm:w-auto min-h-11 inline-flex items-center justify-center gap-1.5 rounded-xl bg-ink-900 text-white px-4 text-sm font-medium hover:bg-accent disabled:opacity-50"
      >
        {busy ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            넣는 중…
          </>
        ) : (
          `${ROLE_LABEL[active] === "요약" ? flowLabel("saveSummary", "요약으로 넣기") : `${ROLE_LABEL[active]}으로 넣기`}`
        )}
      </button>
    </section>
  );
}
