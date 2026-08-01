"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ClipboardPaste,
  Copy,
  Loader2,
  Sparkles,
} from "lucide-react";
import type {
  FactCheckResult,
  FactCheckVerdict,
  SummaryItem,
  VideoRecord,
} from "@/lib/types";
import {
  buildBulkFactCheckPrompt,
  formatBulkParsePreview,
  normalizeAiFactCheckPaste,
  parseBulkFactCheckPasteRobust,
  rebuildPasteDraftFromItems,
  type BulkPasteEntry,
} from "@/lib/bulk-factcheck-paste";
import { FC_VERDICT_OPTIONS } from "@/lib/factcheck-detail";
import { normalizeSimpleVerdict, verdictLabel } from "@/lib/labels";

export function BulkFactCheckPastePanel({
  video,
  items,
  liveVerdicts,
  onApplied,
}: {
  video: VideoRecord;
  items: SummaryItem[];
  /** 아래 항목 화면에서 고른 판정(저장 전·후) */
  liveVerdicts?: Record<string, FactCheckVerdict>;
  onApplied: (video: VideoRecord) => void;
}) {
  const initialPaste = useMemo(() => {
    const saved = video.factCheckPasteDraft?.trim();
    if (saved) return saved;
    return rebuildPasteDraftFromItems(items, video.factChecks);
  }, [video.id]); // hydrate once per video open

  const [paste, setPaste] = useState(initialPaste);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<BulkPasteEntry[] | null>(null);
  /** 미리보기에서 판정만 고친 경우 (저장 전) */
  const [verdictOverrides, setVerdictOverrides] = useState<
    Record<string, FactCheckVerdict>
  >({});
  /** 일괄 저장 직후 — 붙여넣기 자동 인식 박스를 숨기고 「저장된 판정」만 보여 줌 */
  const [hidePastePreview, setHidePastePreview] = useState(false);

  useEffect(() => {
    setPaste(initialPaste);
    setVerdictOverrides({});
    setHidePastePreview(false);
  }, [initialPaste]);

  const prompt = useMemo(() => buildBulkFactCheckPrompt(items), [items]);
  const targets = useMemo(
    () => items.filter((i) => i.needsFactCheck),
    [items]
  );

  const fcMap = useMemo(
    () => new Map(video.factChecks.map((f) => [f.itemId, f])),
    [video.factChecks]
  );

  /** 항목별 화면에서 저장한 판정 — 붙여넣기 미리보기와 별개 */
  const savedProgress = useMemo(() => {
    return targets.map((item, i) => {
      const fc = fcMap.get(item.id);
      const saved =
        Boolean(fc) &&
        fc!.verdict !== "pending" &&
        fc!.explanation.trim().length >= 8;
      return {
        index: i + 1,
        itemId: item.id,
        statement: item.statement,
        verdict: fc?.verdict ?? ("pending" as FactCheckVerdict),
        saved,
      };
    });
  }, [targets, fcMap]);

  const live = useMemo(() => {
    if (!paste.trim()) return null;
    try {
      return parseBulkFactCheckPasteRobust(paste, items);
    } catch {
      return null;
    }
  }, [paste, items]);

  async function pasteFromClipboard() {
    setError(null);
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        setError("클립보드에 텍스트가 없습니다. 먼저 외부 AI 답변을 복사하세요.");
        return;
      }
      setPaste((prev) => (prev.trim() ? `${prev.trim()}\n\n${text}` : text));
      setPreview(null);
      setHidePastePreview(false);
      setNotice("클립보드에서 붙여넣었습니다.");
    } catch {
      setError(
        "클립보드 권한이 없습니다. 답변란을 클릭한 뒤 Ctrl+V로 직접 붙여넣으세요."
      );
    }
  }

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("복사에 실패했습니다. 아래 질문을 직접 드래그해 복사해 주세요.");
    }
  }

  function runNormalize() {
    setError(null);
    setVerdictOverrides({});
    const cleaned = normalizeAiFactCheckPaste(paste);
    if (!cleaned.trim()) {
      setError("정리할 내용이 없습니다.");
      return;
    }
    setPaste(cleaned);
    // 인식 목록은 「붙여넣기 인식」을 눌렀을 때만 표시
    setPreview(null);
    setNotice(
      "정리했습니다. 「붙여넣기 인식」을 눌러 항목을 확인한 뒤 저장하세요."
    );
  }

  function runParse() {
    setError(null);
    setNotice(null);
    setVerdictOverrides({});
    const result = parseBulkFactCheckPasteRobust(paste, items);
    if (result.normalizedText && result.normalizedText !== paste.trim()) {
      setPaste(result.normalizedText);
    }
    setPreview(result.entries.length ? result.entries : null);
    setHidePastePreview(false);
    setNotice(result.notice);
    if (!result.entries.length) setError(result.notice);
  }

  async function applyParsed(entries: BulkPasteEntry[], pasteText: string) {
    if (!entries.length) {
      setError(
        "적용할 항목이 없습니다. 「붙여넣기 인식」또는 「정리 후 항목에 반영」을 눌러 주세요."
      );
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/videos/${video.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft: true,
          factCheckPasteDraft: pasteText,
          bulkFactChecks: entries.map((e) => ({
            itemId: e.itemId,
            verdict:
              verdictOverrides[e.itemId] ?? e.verdict,
            explanation: e.explanation,
            statement: e.statement,
            isNew: e.isNew,
            sources: [],
          })),
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        video?: VideoRecord;
      };
      if (!res.ok || !data.video) {
        throw new Error(data.error || "일괄 적용 실패");
      }
      onApplied(data.video);
      const n = data.video.items.filter((i) => i.needsFactCheck).length;
      setNotice(
        `저장 완료 · ${entries.length}건 반영 · 항목 ${n}개. 아래 「저장된 판정」에 표시됩니다.`
      );
      setPreview(null);
      setVerdictOverrides({});
      setHidePastePreview(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "일괄 적용 실패");
    } finally {
      setBusy(false);
    }
  }

  async function normalizeAndApply() {
    const result = parseBulkFactCheckPasteRobust(paste, items);
    const text = result.normalizedText ?? paste;
    if (result.normalizedText) setPaste(result.normalizedText);
    setPreview(result.entries);
    if (!result.entries.length) {
      setError(result.notice || "인식된 주장이 없습니다.");
      setNotice(null);
      return;
    }
    setNotice(result.notice);
    await applyParsed(result.entries, text);
  }

  // 「붙여넣기 인식」버튼을 눌렀을 때만 목록 표시 (자동 인식 숨김)
  const readyEntries =
    hidePastePreview || !preview?.length ? [] : preview;
  const displayEntries = readyEntries.map((e) => {
    const saved = fcMap.get(e.itemId);
    const fromDb =
      saved &&
      saved.verdict !== "pending" &&
      saved.explanation.trim().length >= 8
        ? normalizeSimpleVerdict(saved.verdict)
        : null;
    return {
      ...e,
      verdict:
        verdictOverrides[e.itemId] ??
        liveVerdicts?.[e.itemId] ??
        fromDb ??
        e.verdict,
    };
  });
  const liveCount = live?.claimCount ?? 0;
  const savedCount = savedProgress.filter((r) => r.saved).length;
  const restoredHint =
    !video.factCheckPasteDraft?.trim() &&
    Boolean(paste.trim()) &&
    targets.some((t) =>
      video.factChecks.some(
        (f) =>
          f.itemId === t.id &&
          f.verdict !== "pending" &&
          f.explanation.trim().length >= 12
      )
    );

  return (
    <div className="rounded-xl border border-accent/35 bg-white px-3 py-3 sm:px-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink-900">
            간편: 전체 답변 한 번에 붙여넣기
          </p>
          <details className="mt-1">
            <summary className="cursor-pointer select-none text-xs text-ink-500 hover:text-ink-800">
              사용 방법 보기
            </summary>
            <p className="text-xs text-ink-500 mt-1 leading-relaxed">
              <strong>정리 후 항목에 반영·저장</strong> = 외부 AI 답변 전체를
              한 번에 각 팩트체크 항목(답변·판정)에 나눠 넣습니다. 항목을 하나씩
              채울 필요 없을 때 씁니다. 미리보기만으로는 저장되지 않습니다.
            </p>
          </details>
        </div>
        <button
          type="button"
          onClick={() => void copyAll()}
          className="inline-flex items-center gap-1.5 min-h-10 rounded-xl border border-accent/40 bg-accent-muted/40 px-3 text-sm font-medium text-ink-900 hover:bg-accent-muted"
        >
          <Copy className="h-4 w-4" />
          {copied ? "복사됨" : "전체 질문 복사"}
        </button>
      </div>

      {targets.length > 0 && (
        <details className="text-xs text-ink-500">
          <summary className="cursor-pointer select-none text-ink-600 hover:text-ink-900">
            복사되는 질문 미리보기 ({targets.length}건)
          </summary>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-ink-100 bg-ink-50 px-3 py-2 text-[11px] leading-relaxed">
            {prompt}
          </pre>
        </details>
      )}

      <label className="block text-sm text-ink-700">
        외부 AI 답변 전체
        {liveCount > 0 && (
          <span className="ml-2 text-xs font-medium text-emerald-700">
            · {liveCount}건 인식됨
          </span>
        )}
        {restoredHint && (
          <span className="ml-2 text-xs font-medium text-amber-700">
            · 저장된 항목에서 복원함
          </span>
        )}
        <textarea
          value={paste}
          onChange={(e) => {
            setPaste(e.target.value);
            setPreview(null);
            setVerdictOverrides({});
            setHidePastePreview(false);
            setNotice(null);
            setError(null);
          }}
          rows={8}
          placeholder={
            "1. (주장)\n판정: 사실\n근거(출처): …\n\n2. (주장)\n판정: 거짓\n근거(출처): …"
          }
          className="mt-1.5 w-full rounded-xl border border-ink-200 px-3 py-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
      </label>
      <button
        type="button"
        disabled={busy}
        onClick={() => void pasteFromClipboard()}
        className="inline-flex items-center gap-1.5 min-h-9 rounded-lg border border-ink-200 bg-white px-3 text-xs font-medium hover:border-accent disabled:opacity-50"
      >
        <ClipboardPaste className="h-3.5 w-3.5" />
        클립보드에서 붙여넣기
      </button>

      {liveCount > 0 && targets.length < liveCount && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-ink-700">
          답변란 <strong>{liveCount}건</strong> · 아래 대상{" "}
          <strong>{targets.length}개</strong>. 「정리 후 항목에 반영」으로 맞출
          수 있습니다.
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !paste.trim()}
          onClick={runNormalize}
          className="inline-flex items-center gap-1.5 min-h-10 rounded-xl border border-accent/40 bg-accent-muted/30 px-3 text-sm font-medium text-ink-900 hover:bg-accent-muted disabled:opacity-50"
        >
          <Sparkles className="h-4 w-4" />
          AI 답변 정리
        </button>
        <button
          type="button"
          disabled={busy || !paste.trim()}
          onClick={runParse}
          className="inline-flex items-center gap-1.5 min-h-10 rounded-xl border border-ink-300 bg-white px-3 text-sm font-medium disabled:opacity-50"
        >
          <ClipboardPaste className="h-4 w-4" />
          붙여넣기 인식
        </button>
      </div>

      <p className="text-[11px] text-ink-500 leading-relaxed">
        「붙여넣기 인식」을 눌러야 아래 목록이 나옵니다. 확인 후{" "}
        <strong>「항목에 반영·저장」</strong>을 눌러야 DB에 저장됩니다.
      </p>

      {notice && (
        <p className="text-xs text-ink-600" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="text-sm text-verify-false" role="alert">
          {error}
        </p>
      )}
      {displayEntries.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2 space-y-2">
          <p className="text-xs font-medium text-amber-950">
            붙여넣기 인식 {displayEntries.length}건
          </p>
          <p className="text-[11px] text-ink-600 leading-relaxed">
            아래 항목에서 판정을 고르면 여기 목록에도 바로 바뀝니다. DB 저장은
            「항목에 반영·저장」또는 「이 항목 저장하고 다음」입니다.
          </p>
          {displayEntries.every((e) => e.verdict === "unverifiable") && (
            <p className="text-[11px] text-amber-900 bg-amber-100/80 border border-amber-200 rounded-md px-2 py-1.5 leading-relaxed">
              답변에 <strong>판정: …</strong> 줄이 없어 모두 「검증 불가」로
              잡혔습니다. 아래에서 판정을 고친 뒤 저장하거나, 답변에 판정 줄을
              넣어 주세요.
            </p>
          )}
          <pre className="whitespace-pre-wrap text-[11px] text-ink-700 leading-relaxed">
            {formatBulkParsePreview(displayEntries)}
          </pre>
          <ul className="space-y-1.5">
            {displayEntries.map((e) => (
              <li
                key={`${e.itemId}-${e.index}`}
                className="flex flex-wrap items-center gap-2 text-[11px] text-ink-700"
              >
                <span className="min-w-[1.25rem] font-medium">{e.index}.</span>
                <label className="inline-flex items-center gap-1.5">
                  판정
                  <select
                    value={e.verdict}
                    disabled={busy}
                    onChange={(ev) => {
                      const v = ev.target.value as FactCheckVerdict;
                      setVerdictOverrides((prev) => ({
                        ...prev,
                        [e.itemId]: v,
                      }));
                    }}
                    className="rounded-md border border-ink-200 bg-white px-1.5 py-1 text-[11px]"
                  >
                    {FC_VERDICT_OPTIONS.map((v) => (
                      <option key={v} value={v}>
                        {verdictLabel(v)}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="text-ink-500">
                  {e.isNew ? "새 대상 추가" : "기존 대상 갱신"}
                </span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={busy}
            onClick={() => void applyParsed(displayEntries, paste)}
            className="w-full inline-flex items-center justify-center gap-1.5 min-h-12 rounded-xl bg-accent px-3 text-sm font-medium text-white hover:bg-ink-900 disabled:opacity-50"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                저장 중…
              </>
            ) : (
              <>
                <Check className="h-4 w-4" />
                항목에 반영·저장 ({displayEntries.length}건)
              </>
            )}
          </button>
        </div>
      )}

      {savedCount > 0 && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2 space-y-1.5">
          <p className="text-xs font-medium text-emerald-900">
            저장된 판정 {savedCount}/{targets.length}건
            <span className="font-normal text-emerald-800">
              {" "}
              · 「이 항목 저장하고 다음」또는 일괄 저장 결과
            </span>
          </p>
          <ul className="text-[11px] text-ink-700 space-y-0.5">
            {savedProgress.map((r) => {
              const draft = liveVerdicts?.[r.itemId];
              const show =
                draft && (!r.saved || draft !== r.verdict)
                  ? draft
                  : r.saved
                    ? r.verdict
                    : draft;
              return (
                <li key={r.itemId}>
                  {r.index}.{" "}
                  {show ? (
                    <>
                      <strong>{verdictLabel(show)}</strong>
                      {!r.saved && draft ? (
                        <span className="text-amber-700"> · 선택됨(미저장)</span>
                      ) : null}
                      <span className="text-ink-500">
                        {" "}
                        · {r.statement.replace(/\s+/g, " ").slice(0, 36)}
                        {r.statement.length > 36 ? "…" : ""}
                      </span>
                    </>
                  ) : (
                    <span className="text-ink-400">아직 미저장</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* 저장은 아직 없어도 판정만 고른 경우 목록 표시 */}
      {savedCount === 0 &&
        liveVerdicts &&
        Object.keys(liveVerdicts).length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 space-y-1.5">
            <p className="text-xs font-medium text-amber-950">
              선택한 판정 (아직 미저장)
            </p>
            <ul className="text-[11px] text-ink-700 space-y-0.5">
              {targets.map((item, i) => {
                const v = liveVerdicts[item.id];
                if (!v) return null;
                return (
                  <li key={item.id}>
                    {i + 1}. <strong>{verdictLabel(v)}</strong>
                    <span className="text-ink-500">
                      {" "}
                      · {item.statement.replace(/\s+/g, " ").slice(0, 36)}
                      {item.statement.length > 36 ? "…" : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

      {displayEntries.length === 0 && paste.trim() && (
        <button
          type="button"
          disabled={busy || !paste.trim()}
          onClick={() => void normalizeAndApply()}
          className="w-full inline-flex items-center justify-center gap-1.5 min-h-11 rounded-xl bg-accent px-3 text-sm font-medium text-white hover:bg-ink-900 disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          )}
          {busy ? "반영 중…" : "정리 후 항목에 반영·저장 (일괄)"}
        </button>
      )}
    </div>
  );
}

export function countFilledFactChecks(
  items: SummaryItem[],
  factChecks: FactCheckResult[]
): number {
  const map = new Map(factChecks.map((f) => [f.itemId, f]));
  return items.filter((i) => {
    if (!i.needsFactCheck) return false;
    const fc = map.get(i.id);
    return Boolean(
      fc && fc.explanation.trim().length >= 20 && fc.verdict !== "pending"
    );
  }).length;
}
