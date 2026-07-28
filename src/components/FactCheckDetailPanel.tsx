"use client";

import { useEffect, useState } from "react";
import {
  Check,
  ClipboardCopy,
  ClipboardPaste,
  ImagePlus,
  Link2,
  Loader2,
  Pencil,
  Save,
  Trash2,
  X,
} from "lucide-react";
import type {
  FactCheckResult,
  FactCheckVerdict,
  SummaryItem,
  TypedReport,
  VideoRecord,
} from "@/lib/types";
import { isFailedVerdict, verdictBadge } from "@/lib/text-format";
import { verdictLabel } from "@/lib/labels";
import {
  clearFactCheckDetailApi,
  deleteFactCheckItemApi,
  FC_VERDICT_OPTIONS,
  resolveFactCheckDetailSourceWithId,
  saveFactCheckEditApi,
  factCheckPasteHtml,
  textToFactCheckHtml,
  type FactCheckDetailSource,
} from "@/lib/factcheck-detail";

export type FactCheckDetailCapabilities = {
  edit?: boolean;
  pasteToSection?: boolean;
  unlink?: boolean;
  clearDetail?: boolean;
  deleteAll?: boolean;
};

type Props = {
  presentation: "inline" | "modal" | "embedded";
  label: string;
  statementFallback: string;
  itemId?: string;
  item?: SummaryItem;
  videoFc?: FactCheckResult;
  reportFc?: TypedReport["factChecks"][number];
  entry?: {
    text?: string;
    html?: string;
    answerImageUrl?: string;
    answerImageUrls?: string[];
    answerParts?: FactCheckDetailSource["parts"];
  };
  videoId: string;
  capabilities?: FactCheckDetailCapabilities;
  busy?: boolean;
  onClose?: () => void;
  onVideoUpdate: (video: VideoRecord) => void;
  onPasteText?: (html: string) => void;
  onPasteImages?: (urls: string[]) => void;
  onUnlink?: () => void;
};

export function FactCheckDetailPanel({
  presentation,
  label,
  statementFallback,
  itemId,
  item,
  videoFc,
  reportFc,
  entry,
  videoId,
  capabilities = {},
  busy,
  onClose,
  onVideoUpdate,
  onPasteText,
  onPasteImages,
  onUnlink,
}: Props) {
  const caps = {
    edit: false,
    pasteToSection: false,
    unlink: false,
    clearDetail: true,
    deleteAll: true,
    ...capabilities,
  };

  const source = resolveFactCheckDetailSourceWithId({
    label,
    statementFallback,
    itemId,
    item,
    videoFc,
    reportFc,
    entry: entry
      ? {
          ...entry,
          answerParts: entry.answerParts ?? undefined,
        }
      : undefined,
  });

  const [mode, setMode] = useState<"view" | "edit">("view");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const [statement, setStatement] = useState(source.statement);
  const [detail, setDetail] = useState(source.detail);
  const [explanation, setExplanation] = useState(source.answerText);
  const [editVerdict, setEditVerdict] = useState<FactCheckVerdict>(
    source.verdict !== "pending" ? source.verdict : "unverifiable"
  );

  useEffect(() => {
    setStatement(source.statement);
    setDetail(source.detail);
    setExplanation(source.answerText);
    setEditVerdict(
      source.verdict !== "pending" ? source.verdict : "unverifiable"
    );
    setMode("view");
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when item changes
  }, [itemId, label, source.statement, source.answerText, source.verdict]);

  const badge = verdictBadge(source.verdict);
  const failed = isFailedVerdict(source.verdict);
  const locked = Boolean(busy || saving);

  function notify(msg: string) {
    setFlash(msg);
    window.setTimeout(() => setFlash(null), 2000);
  }

  async function copyText() {
    const text = [source.statement, source.answerText]
      .filter(Boolean)
      .join("\n\n");
    if (!text.trim()) {
      setError("복사할 내용이 없습니다.");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      notify("텍스트 복사됨");
      setError(null);
    } catch {
      setError("클립보드 복사에 실패했습니다.");
    }
  }

  async function clearDetail() {
    if (!source.itemId) {
      setError("이 항목은 DETAIL만 비울 수 없습니다.");
      return;
    }
    if (
      !window.confirm(
        "팩트체크 제목은 남기고 DETAIL(답변·이미지)만 삭제할까요?"
      )
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const video = await clearFactCheckDetailApi(videoId, source.itemId);
      onVideoUpdate(video);
      notify("DETAIL 삭제됨 (제목 유지)");
      setMode("view");
    } catch (e) {
      setError(e instanceof Error ? e.message : "DETAIL 삭제 실패");
    } finally {
      setSaving(false);
    }
  }

  async function deleteAll() {
    if (!source.itemId) {
      onUnlink?.();
      onClose?.();
      return;
    }
    if (
      !window.confirm(
        "팩트체크 제목과 DETAIL을 모두 삭제할까요? 보고서 연결도 제거됩니다."
      )
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const video = await deleteFactCheckItemApi(videoId, source.itemId);
      onVideoUpdate(video);
      onClose?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "전체 삭제 실패");
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit() {
    if (!source.itemId) {
      setError(
        "이 항목은 보고서 연결만 있습니다. 원본 FC ID가 없어 수정할 수 없습니다."
      );
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const video = await saveFactCheckEditApi(videoId, {
        itemId: source.itemId,
        statement,
        detail,
        explanation,
        verdict: editVerdict,
        prev: videoFc,
      });
      onVideoUpdate(video);
      setMode("view");
      notify("저장됨");
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  }

  const body = (
    <div
      className={
        presentation === "inline"
          ? "rounded-xl border border-accent/30 bg-white p-3 space-y-2 shadow-sm"
          : presentation === "embedded"
            ? "rounded-lg border border-accent/30 bg-white p-2.5 space-y-2"
            : "space-y-3 text-sm"
      }
    >
      {presentation !== "modal" && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-ink-500">
            {label} DETAIL · {badge.mark} {badge.label}
          </p>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="text-xs text-ink-500 underline"
            >
              닫기
            </button>
          )}
        </div>
      )}

      {flash && (
        <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5">
          <Check className="h-3.5 w-3.5" />
          {flash}
        </p>
      )}
      {error && (
        <p className="text-xs text-verify-false" role="alert">
          {error}
        </p>
      )}

      {mode === "edit" ? (
        <div className="space-y-2">
          <label className="block text-xs text-ink-500">
            주장
            <textarea
              value={statement}
              onChange={(e) => setStatement(e.target.value)}
              rows={2}
              className="mt-0.5 w-full rounded-lg border border-ink-200 px-2.5 py-2 text-sm outline-none focus:border-accent"
            />
          </label>
          <label className="block text-xs text-ink-500">
            상세 (선택)
            <textarea
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              rows={2}
              className="mt-0.5 w-full rounded-lg border border-ink-200 px-2.5 py-2 text-sm outline-none focus:border-accent"
            />
          </label>
          <label className="block text-xs text-ink-500">
            팩트체크 답변
            <textarea
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              rows={6}
              className="mt-0.5 w-full rounded-lg border border-ink-200 px-2.5 py-2 text-sm outline-none focus:border-accent"
            />
          </label>
          <label className="block text-xs text-ink-500">
            판정
            <select
              value={editVerdict}
              onChange={(e) =>
                setEditVerdict(e.target.value as FactCheckVerdict)
              }
              className="mt-0.5 w-full rounded-lg border border-ink-200 px-2.5 py-2 text-sm outline-none focus:border-accent"
            >
              {FC_VERDICT_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {verdictLabel(v)}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              disabled={locked}
              onClick={() => void saveEdit()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              저장
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setMode("view");
                setError(null);
              }}
              className="rounded-lg border border-ink-200 px-3 py-2 text-xs font-medium"
            >
              취소
            </button>
          </div>
        </div>
      ) : (
        <>
          <p
            className={`font-medium text-ink-900 leading-snug ${
              presentation === "inline" ? "text-sm" : ""
            }`}
          >
            {presentation === "modal" ? (
              <u className="decoration-accent/70 underline-offset-2">
                {source.statement}
              </u>
            ) : (
              source.statement
            )}
          </p>

          {source.parts?.length ? (
            <div className="space-y-3">
              {source.parts.map((part) => (
                <div
                  key={part.number}
                  className="rounded-lg border border-ink-100 bg-ink-50/80 p-2.5 space-y-2"
                >
                  <p className="text-ink-800 leading-relaxed whitespace-pre-wrap text-sm">
                    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-ink-900 text-[10px] font-bold text-white mr-1.5 align-middle">
                      {part.number}
                    </span>
                    {part.text}
                  </p>
                  {(part.imageUrls ?? [])
                    .filter(
                      (u) => !/i\.ytimg\.com|ytimg\.com\/vi\//i.test(u)
                    )
                    .map((src) => (
                      <div
                        key={src.slice(0, 48)}
                        className="overflow-hidden rounded-lg border border-ink-100 bg-white"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={src}
                          alt={`${part.number}번 이미지`}
                          className="w-full max-h-64 object-contain bg-ink-50"
                        />
                      </div>
                    ))}
                </div>
              ))}
            </div>
          ) : source.answerText ? (
            <div
              className={`rounded-lg bg-ink-50 border border-ink-100 p-3 text-ink-700 whitespace-pre-wrap leading-relaxed ${
                presentation === "inline" ? "text-sm p-0 bg-transparent border-0" : ""
              }`}
            >
              {failed && presentation !== "inline" && (
                <p className="text-verify-false font-bold mb-2">
                  ✗ 사실과 다름
                </p>
              )}
              {source.answerText}
            </div>
          ) : (
            <p className="text-xs text-ink-400">DETAIL 없음</p>
          )}

          {!source.parts?.length && source.images.length > 0 && (
            <div
              className={
                presentation === "inline" ? "flex flex-wrap gap-2" : "space-y-2"
              }
            >
              {source.images.map((src) => (
                <div
                  key={src.slice(0, 48)}
                  className={
                    presentation === "inline"
                      ? undefined
                      : "overflow-hidden rounded-lg border border-ink-100"
                  }
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={src}
                    alt=""
                    className={
                      presentation === "inline"
                        ? "h-20 w-auto rounded-lg border border-ink-100 object-cover"
                        : "w-full max-h-64 object-contain bg-ink-50"
                    }
                  />
                </div>
              ))}
            </div>
          )}

          <div
            className={`flex flex-wrap gap-1.5 pt-1 ${
              presentation === "modal" ? "border-t border-ink-100" : ""
            }`}
          >
            <button
              type="button"
              onClick={() => void copyText()}
              className="inline-flex items-center gap-1 rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-xs font-medium"
            >
              <ClipboardCopy className="h-3.5 w-3.5" />
              복사
            </button>
            {caps.pasteToSection && onPasteText && (
              <button
                type="button"
                disabled={!source.answerText}
                onClick={() => {
                  const html = source.itemId
                    ? factCheckPasteHtml({
                        itemId: source.itemId,
                        statement: source.statement,
                        answerText: source.answerText,
                      })
                    : textToFactCheckHtml(
                        [`【${label}】 ${source.statement}`, source.answerText]
                          .filter(Boolean)
                          .join("\n\n")
                      );
                  if (html) onPasteText(html);
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-accent/40 bg-accent-muted/40 px-2.5 py-1.5 text-xs font-medium disabled:opacity-40"
              >
                <ClipboardPaste className="h-3.5 w-3.5" />
                본문에 넣기
              </button>
            )}
            {caps.pasteToSection &&
              onPasteImages &&
              source.images.length > 0 && (
                <button
                  type="button"
                  onClick={() => onPasteImages(source.images)}
                  className="inline-flex items-center gap-1 rounded-lg border border-accent/40 bg-accent-muted/40 px-2.5 py-1.5 text-xs font-medium"
                >
                  <ImagePlus className="h-3.5 w-3.5" />
                  이미지 넣기
                </button>
              )}
            {caps.unlink && onUnlink && (
              <button
                type="button"
                onClick={onUnlink}
                className="inline-flex items-center gap-1 rounded-lg border border-ink-200 px-2.5 py-1.5 text-xs font-medium"
              >
                <Link2 className="h-3.5 w-3.5" />
                연결 제거
              </button>
            )}
            {caps.edit && (
              <button
                type="button"
                disabled={locked || !source.itemId}
                onClick={() => setMode("edit")}
                className="inline-flex items-center gap-1 rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-xs font-medium disabled:opacity-40"
              >
                <Pencil className="h-3.5 w-3.5" />
                수정
              </button>
            )}
            {caps.clearDetail && (
              <button
                type="button"
                disabled={locked || !source.itemId || !source.answerText}
                onClick={() => void clearDetail()}
                className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-900 disabled:opacity-40"
              >
                DETAIL 삭제
              </button>
            )}
            {caps.deleteAll && (
              <button
                type="button"
                disabled={locked}
                onClick={() => void deleteAll()}
                className="inline-flex items-center gap-1 rounded-lg border border-verify-false/40 bg-verify-false/5 px-2.5 py-1.5 text-xs font-medium text-verify-false disabled:opacity-40"
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                전체 삭제
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );

  if (presentation !== "modal") return body;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-ink-900/50 p-3 print:hidden"
      role="dialog"
      aria-modal="true"
      aria-label={`팩트체크 ${label}`}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[90vh] overflow-auto rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 px-4 py-3 border-b border-ink-100 bg-white">
          <div className="flex items-center gap-2 min-w-0">
            <span className="fc-badge">{label}</span>
            <span
              className={`text-sm font-medium truncate ${
                failed
                  ? "text-verify-false"
                  : badge.ok
                    ? "text-verify-true"
                    : "text-ink-700"
              }`}
            >
              {badge.mark} {badge.label}
            </span>
          </div>
          {onClose && (
            <button type="button" onClick={onClose} className="p-1 shrink-0">
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
        <div className="p-4">{body}</div>
      </div>
    </div>
  );
}
