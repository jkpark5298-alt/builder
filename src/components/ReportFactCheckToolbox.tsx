"use client";

import { useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardCopy,
  ClipboardPaste,
  ImagePlus,
  Link2,
  Pencil,
} from "lucide-react";
import type {
  FactCheckResult,
  SummaryItem,
  TypedReport,
  VideoRecord,
} from "@/lib/types";
import { collectEntryImages } from "@/lib/fc-markers";
import { normalizeAiAnswer, verdictBadge } from "@/lib/text-format";
import { factCheckPasteHtml } from "@/lib/factcheck-detail";
import { FactCheckDetailPanel } from "@/components/FactCheckDetailPanel";

function fcAnswerText(fc?: FactCheckResult): string {
  if (!fc) return "";
  const raw = fc.explanation?.trim() ?? "";
  if (!raw || (/^다음 주장을/.test(raw) && /팩트체크/.test(raw))) {
    return "";
  }
  return normalizeAiAnswer(raw);
}

export type ReportFcRow = {
  item: SummaryItem;
  fc?: FactCheckResult;
  images: string[];
  answerText: string;
};

export function ReportFactCheckToolbox({
  video,
  draft,
  editing,
  activeSectionIdx,
  busy,
  onVideoUpdate,
  onDraftUpdate,
  onPasteTextToSection,
  onPasteImagesToSection,
  onLinkToSection,
}: {
  video: VideoRecord;
  draft: TypedReport;
  editing: boolean;
  activeSectionIdx: number;
  busy?: boolean;
  onVideoUpdate: (video: VideoRecord) => void;
  onDraftUpdate: (report: TypedReport) => void;
  onPasteTextToSection: (html: string) => void;
  onPasteImagesToSection: (urls: string[]) => void;
  onLinkToSection: (row: ReportFcRow) => void;
}) {
  const [open, setOpen] = useState(true);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(() => {
    const fcMap = new Map(video.factChecks.map((f) => [f.itemId, f]));
    return video.items
      .filter((i) => i.needsFactCheck)
      .map((item) => {
        const fc = fcMap.get(item.id);
        const answerText = fcAnswerText(fc);
        const entryLike = {
          itemId: item.id,
          text: item.statement,
          answerImageUrl: fc?.answerImageUrl,
          answerImageUrls: fc?.answerImageUrls,
          answerParts: fc?.answerParts,
        };
        return {
          item,
          fc,
          answerText,
          images: collectEntryImages(entryLike, fc),
        } satisfies ReportFcRow;
      });
  }, [video.items, video.factChecks]);

  function notify(msg: string) {
    setFlash(msg);
    window.setTimeout(() => setFlash(null), 2200);
  }

  async function copyText(text: string, label: string) {
    if (!text.trim()) {
      setError("복사할 텍스트가 없습니다.");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      notify(`${label} 복사됨`);
      setError(null);
    } catch {
      setError("클립보드 복사에 실패했습니다.");
    }
  }

  async function copyImageUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      notify("이미지 URL 복사됨 — 본문에 붙여넣기하거나 「이미지 넣기」를 쓰세요");
      setError(null);
    } catch {
      setError("이미지 URL 복사에 실패했습니다.");
    }
  }

  function handleVideoUpdate(v: VideoRecord) {
    onVideoUpdate(v);
    if (v.report) onDraftUpdate(v.report);
  }

  if (!rows.length) {
    return (
      <div className="rounded-xl border border-ink-200 bg-ink-50/80 px-3 py-2.5 text-sm text-ink-600 print:hidden">
        연결된 팩트체크 항목이 없습니다.
      </div>
    );
  }

  return (
    <aside className="rounded-xl border border-accent/30 bg-white shadow-sm print:hidden overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 bg-accent-muted/40 border-b border-accent/20 text-left"
      >
        <span className="text-sm font-medium text-ink-900">
          팩트체크 자료 ({rows.length})
        </span>
        {open ? (
          <ChevronUp className="h-4 w-4 text-ink-500" />
        ) : (
          <ChevronDown className="h-4 w-4 text-ink-500" />
        )}
      </button>

      {open && (
        <div className="p-3 space-y-3 max-h-[min(70vh,36rem)] overflow-y-auto">
          <p className="text-xs text-ink-500 leading-relaxed">
            DETAIL을 열어 확인·수정합니다. 편집 중이면 현재 섹션(
            <span className="font-medium text-ink-700">
              {draft.sections[activeSectionIdx]?.heading || "섹션"}
            </span>
            )에 넣을 수 있습니다.
          </p>

          {flash && (
            <p
              className="flex items-center gap-1.5 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5"
              role="status"
            >
              <Check className="h-3.5 w-3.5" />
              {flash}
            </p>
          )}
          {error && (
            <p className="text-xs text-verify-false" role="alert">
              {error}
            </p>
          )}

          {rows.map((row, i) => {
            const badge = verdictBadge(row.fc?.verdict ?? "pending");
            const isOpen = detailId === row.item.id;
            const label = `FC${i + 1}`;

            return (
              <div
                key={row.item.id}
                className="rounded-lg border border-ink-100 bg-ink-50/50 p-2.5 space-y-2"
              >
                <div className="min-w-0">
                  <p className="text-[11px] text-ink-400 font-medium">
                    {label} · {badge.mark} {badge.label}
                  </p>
                  <p className="text-sm font-medium text-ink-900 leading-snug mt-0.5">
                    {row.item.statement}
                  </p>
                </div>

                {!isOpen && (
                  <>
                    {row.answerText ? (
                      <p className="text-xs text-ink-700 whitespace-pre-wrap leading-relaxed line-clamp-4">
                        {row.answerText}
                      </p>
                    ) : (
                      <p className="text-xs text-ink-400">답변 없음</p>
                    )}

                    {row.images.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {row.images.map((src) => (
                          <button
                            key={src.slice(0, 48)}
                            type="button"
                            title="이미지 URL 복사"
                            onClick={() => void copyImageUrl(src)}
                            className="relative group overflow-hidden rounded-md border border-ink-200 bg-white"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={src}
                              alt=""
                              className="h-14 w-14 object-cover"
                            />
                            <span className="absolute inset-0 hidden group-hover:flex items-center justify-center bg-ink-900/50 text-[10px] text-white font-medium">
                              복사
                            </span>
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => setDetailId(row.item.id)}
                        className="inline-flex items-center gap-1 rounded-md border border-accent/40 bg-accent-muted/40 px-2 py-1 text-[11px] font-medium"
                      >
                        <Pencil className="h-3 w-3" />
                        DETAIL
                      </button>
                      <button
                        type="button"
                        disabled={!row.answerText}
                        onClick={() =>
                          void copyText(
                            [row.item.statement, row.answerText]
                              .filter(Boolean)
                              .join("\n\n"),
                            "FC 텍스트"
                          )
                        }
                        className="inline-flex items-center gap-1 rounded-md border border-ink-200 bg-white px-2 py-1 text-[11px] font-medium disabled:opacity-40"
                      >
                        <ClipboardCopy className="h-3 w-3" />
                        복사
                      </button>
                      {editing && (
                        <>
                          <button
                            type="button"
                            disabled={!row.answerText}
                            onClick={() => {
                              const html = factCheckPasteHtml({
                                itemId: row.item.id,
                                statement: row.item.statement,
                                answerText: row.answerText,
                              });
                              if (!html) return;
                              onPasteTextToSection(html);
                              notify("현재 섹션 본문에 붙여넣음");
                            }}
                            className="inline-flex items-center gap-1 rounded-md border border-accent/40 bg-accent-muted/40 px-2 py-1 text-[11px] font-medium disabled:opacity-40"
                          >
                            <ClipboardPaste className="h-3 w-3" />
                            본문에 넣기
                          </button>
                          {row.images.length > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                onPasteImagesToSection(row.images);
                                notify("이미지 넣음");
                              }}
                              className="inline-flex items-center gap-1 rounded-md border border-accent/40 bg-accent-muted/40 px-2 py-1 text-[11px] font-medium"
                            >
                              <ImagePlus className="h-3 w-3" />
                              이미지
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              onLinkToSection(row);
                              notify("섹션에 연결됨");
                            }}
                            className="inline-flex items-center gap-1 rounded-md border border-ink-200 bg-white px-2 py-1 text-[11px] font-medium"
                          >
                            <Link2 className="h-3 w-3" />
                            연결
                          </button>
                        </>
                      )}
                    </div>
                  </>
                )}

                {isOpen && (
                  <FactCheckDetailPanel
                    presentation="embedded"
                    label={label}
                    statementFallback={row.item.statement}
                    itemId={row.item.id}
                    item={row.item}
                    videoFc={row.fc}
                    entry={{
                      text: row.item.statement,
                      answerImageUrl: row.fc?.answerImageUrl,
                      answerImageUrls: row.fc?.answerImageUrls,
                      answerParts: row.fc?.answerParts,
                    }}
                    videoId={video.id}
                    busy={busy}
                    capabilities={{
                      edit: true,
                      pasteToSection: editing,
                      clearDetail: true,
                      deleteAll: true,
                    }}
                    onClose={() => setDetailId(null)}
                    onVideoUpdate={handleVideoUpdate}
                    onPasteText={
                      editing
                        ? (html) => {
                            onPasteTextToSection(html);
                            notify("현재 섹션 본문에 붙여넣음");
                          }
                        : undefined
                    }
                    onPasteImages={
                      editing
                        ? (urls) => {
                            onPasteImagesToSection(urls);
                            notify("이미지 넣음");
                          }
                        : undefined
                    }
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}
