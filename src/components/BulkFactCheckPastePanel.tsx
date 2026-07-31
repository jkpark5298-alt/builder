"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ClipboardPaste,
  Copy,
  Loader2,
  Sparkles,
} from "lucide-react";
import type { FactCheckResult, SummaryItem, VideoRecord } from "@/lib/types";
import {
  buildBulkFactCheckPrompt,
  formatBulkParsePreview,
  normalizeAiFactCheckPaste,
  parseBulkFactCheckPasteRobust,
  rebuildPasteDraftFromItems,
  type BulkPasteEntry,
} from "@/lib/bulk-factcheck-paste";
import { verdictLabel } from "@/lib/labels";

export function BulkFactCheckPastePanel({
  video,
  items,
  onApplied,
}: {
  video: VideoRecord;
  items: SummaryItem[];
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

  useEffect(() => {
    setPaste(initialPaste);
  }, [initialPaste]);

  const prompt = useMemo(() => buildBulkFactCheckPrompt(items), [items]);
  const targets = useMemo(
    () => items.filter((i) => i.needsFactCheck),
    [items]
  );

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
    const cleaned = normalizeAiFactCheckPaste(paste);
    if (!cleaned.trim()) {
      setError("정리할 내용이 없습니다.");
      return;
    }
    setPaste(cleaned);
    const result = parseBulkFactCheckPasteRobust(cleaned, items);
    setPreview(result.entries);
    setNotice(
      result.entries.length
        ? `정리 완료 · ${result.notice}`
        : "정리했습니다. 형식을 확인한 뒤 다시 미리보기 하세요."
    );
    if (!result.entries.length) setError(result.notice);
  }

  function runParse() {
    setError(null);
    setNotice(null);
    const result = parseBulkFactCheckPasteRobust(paste, items);
    if (result.normalizedText && result.normalizedText !== paste.trim()) {
      setPaste(result.normalizedText);
    }
    setPreview(result.entries);
    setNotice(result.notice);
    if (!result.entries.length) setError(result.notice);
  }

  async function applyParsed(entries: BulkPasteEntry[], pasteText: string) {
    if (!entries.length) {
      setError(
        "적용할 항목이 없습니다. 「미리보기」또는 「정리 후 항목에 반영」을 눌러 주세요."
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
            verdict: e.verdict,
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
        `${entries.length}건 반영 · 항목 ${n}개. 외부 AI 답변란도 저장해 두었습니다.`
      );
      setPreview(null);
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

  const readyEntries = preview?.length ? preview : live?.entries ?? [];
  const liveCount = live?.claimCount ?? 0;
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
              「정리 후 항목에 반영」하면 아래 대상이 생기고{" "}
              <strong>외부 AI 답변란도 저장</strong>됩니다. 항목만 있고 답변란이
              비면, 저장된 항목에서 다시 채웁니다.
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
          미리보기
        </button>
        <button
          type="button"
          disabled={busy || !paste.trim()}
          onClick={() => void normalizeAndApply()}
          className="inline-flex items-center gap-1.5 min-h-10 rounded-xl bg-accent px-3 text-sm font-medium text-white hover:bg-ink-900 disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          )}
          {busy
            ? "반영 중…"
            : `정리 후 항목에 반영${liveCount ? ` (${liveCount})` : ""}`}
        </button>
      </div>

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
      {readyEntries.length > 0 && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 space-y-1.5">
          <p className="text-xs font-medium text-emerald-800">
            반영될 항목 {readyEntries.length}건
            {preview ? " (미리보기)" : " (자동 인식)"}
          </p>
          <pre className="whitespace-pre-wrap text-[11px] text-ink-700 leading-relaxed">
            {formatBulkParsePreview(readyEntries)}
          </pre>
          <ul className="text-[11px] text-ink-600 space-y-0.5">
            {readyEntries.map((e) => (
              <li key={`${e.itemId}-${e.index}`}>
                {e.index}. 판정 <strong>{verdictLabel(e.verdict)}</strong>
                {e.isNew ? " · 새 대상 추가" : " · 기존 대상 갱신"}
              </li>
            ))}
          </ul>
        </div>
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
