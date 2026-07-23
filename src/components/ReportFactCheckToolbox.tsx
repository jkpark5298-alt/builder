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
  Loader2,
  Pencil,
  Trash2,
} from "lucide-react";
import type {
  FactCheckResult,
  FactCheckVerdict,
  SummaryItem,
  TypedReport,
  VideoRecord,
} from "@/lib/types";
import { collectEntryImages } from "@/lib/fc-markers";
import { normalizeImageUrls } from "@/lib/image-urls";
import { normalizeAiAnswer, verdictBadge } from "@/lib/text-format";
import { resolveAnswerParts } from "@/lib/answer-parts";

const VERDICT_OPTIONS: FactCheckVerdict[] = [
  "true",
  "mostly_true",
  "mixed",
  "mostly_false",
  "false",
  "unverifiable",
];

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function textToHtmlParagraphs(text: string): string {
  const clean = normalizeAiAnswer(text).trim();
  if (!clean) return "";
  return clean
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function fcAnswerText(fc?: FactCheckResult, item?: SummaryItem): string {
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(() => {
    const fcMap = new Map(video.factChecks.map((f) => [f.itemId, f]));
    return video.items
      .filter((i) => i.needsFactCheck)
      .map((item) => {
        const fc = fcMap.get(item.id);
        const answerText = fcAnswerText(fc, item);
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

  async function deleteFc(itemId: string) {
    if (
      !window.confirm(
        "이 팩트체크를 삭제할까요? 보고서 연결·답변도 함께 제거됩니다."
      )
    ) {
      return;
    }
    setSavingId(itemId);
    setError(null);
    try {
      const res = await fetch(`/api/videos/${video.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deleteItem: { itemId },
          preserveReadyStatus: true,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        video?: VideoRecord;
      };
      if (!res.ok) throw new Error(data.error || "삭제 실패");
      if (data.video) {
        onVideoUpdate(data.video);
        if (data.video.report) onDraftUpdate(data.video.report);
      }
      notify("팩트체크 삭제됨");
      setEditingId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "삭제 실패");
    } finally {
      setSavingId(null);
    }
  }

  async function saveFcEdit(opts: {
    itemId: string;
    statement: string;
    detail: string;
    explanation: string;
    verdict: FactCheckVerdict;
  }) {
    setSavingId(opts.itemId);
    setError(null);
    try {
      const explanation = normalizeAiAnswer(opts.explanation.trim());
      if (explanation.length < 20) {
        throw new Error("팩트체크 답변을 20자 이상 입력해 주세요.");
      }
      if (!opts.statement.trim()) {
        throw new Error("주장을 입력해 주세요.");
      }

      const itemRes = await fetch(`/api/videos/${video.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updateItem: {
            itemId: opts.itemId,
            statement: opts.statement.trim(),
            detail: opts.detail.trim() || null,
          },
          preserveReadyStatus: true,
        }),
      });
      const itemData = (await itemRes.json()) as {
        error?: string;
        video?: VideoRecord;
      };
      if (!itemRes.ok) throw new Error(itemData.error || "주장 수정 실패");

      const prev = (itemData.video ?? video).factChecks.find(
        (f) => f.itemId === opts.itemId
      );
      const parts = resolveAnswerParts({
        explanation,
        answerImageUrl: prev?.answerImageUrl,
        answerImageUrls: prev?.answerImageUrls,
        answerParts: prev?.answerParts,
      });

      const fcRes = await fetch(`/api/videos/${video.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          factCheck: {
            itemId: opts.itemId,
            verdict: opts.verdict === "pending" ? "unverifiable" : opts.verdict,
            explanation,
            sources: prev?.sources ?? [],
            answerParts: parts,
          },
          preserveReadyStatus: true,
        }),
      });
      const fcData = (await fcRes.json()) as {
        error?: string;
        video?: VideoRecord;
      };
      if (!fcRes.ok) throw new Error(fcData.error || "답변 저장 실패");
      if (fcData.video) {
        onVideoUpdate(fcData.video);
        if (fcData.video.report) onDraftUpdate(fcData.video.report);
      }
      notify("팩트체크 저장됨");
      setEditingId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setSavingId(null);
    }
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
            내용·사진을 확인한 뒤 복사하거나, 편집 중이면 현재 섹션(
            <span className="font-medium text-ink-700">
              {draft.sections[activeSectionIdx]?.heading || "섹션"}
            </span>
            )에 붙여넣을 수 있습니다. FC 수정·삭제도 여기서 가능합니다.
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
            const isEditing = editingId === row.item.id;
            const saving = savingId === row.item.id;

            return (
              <div
                key={row.item.id}
                className="rounded-lg border border-ink-100 bg-ink-50/50 p-2.5 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] text-ink-400 font-medium">
                      FC{i + 1} · {badge.mark} {badge.label}
                    </p>
                    <p className="text-sm font-medium text-ink-900 leading-snug mt-0.5">
                      {row.item.statement}
                    </p>
                  </div>
                </div>

                {row.answerText ? (
                  <p className="text-xs text-ink-700 whitespace-pre-wrap leading-relaxed line-clamp-6">
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

                {isEditing ? (
                  <FcInlineEditor
                    row={row}
                    saving={saving || Boolean(busy)}
                    onCancel={() => setEditingId(null)}
                    onSave={(vals) => void saveFcEdit({ itemId: row.item.id, ...vals })}
                  />
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      disabled={!row.answerText}
                      onClick={() =>
                        void copyText(
                          [
                            row.item.statement,
                            row.answerText,
                          ]
                            .filter(Boolean)
                            .join("\n\n"),
                          "FC 텍스트"
                        )
                      }
                      className="inline-flex items-center gap-1 rounded-md border border-ink-200 bg-white px-2 py-1 text-[11px] font-medium disabled:opacity-40"
                    >
                      <ClipboardCopy className="h-3 w-3" />
                      텍스트 복사
                    </button>
                    {editing && (
                      <>
                        <button
                          type="button"
                          disabled={!row.answerText}
                          onClick={() => {
                            const html = textToHtmlParagraphs(
                              [
                                `【FC】 ${row.item.statement}`,
                                row.answerText,
                              ]
                                .filter(Boolean)
                                .join("\n\n")
                            );
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
                              notify("이미지를 현재 섹션에 넣음");
                            }}
                            className="inline-flex items-center gap-1 rounded-md border border-accent/40 bg-accent-muted/40 px-2 py-1 text-[11px] font-medium"
                          >
                            <ImagePlus className="h-3 w-3" />
                            이미지 넣기
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            onLinkToSection(row);
                            notify("섹션에 FC 연결됨");
                          }}
                          className="inline-flex items-center gap-1 rounded-md border border-ink-200 bg-white px-2 py-1 text-[11px] font-medium"
                        >
                          <Link2 className="h-3 w-3" />
                          섹션 연결
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() => setEditingId(row.item.id)}
                      className="inline-flex items-center gap-1 rounded-md border border-ink-200 bg-white px-2 py-1 text-[11px] font-medium"
                    >
                      <Pencil className="h-3 w-3" />
                      수정
                    </button>
                    <button
                      type="button"
                      disabled={saving || Boolean(busy)}
                      onClick={() => void deleteFc(row.item.id)}
                      className="inline-flex items-center gap-1 rounded-md border border-verify-false/40 bg-verify-false/5 px-2 py-1 text-[11px] font-medium text-verify-false"
                    >
                      {saving ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Trash2 className="h-3 w-3" />
                      )}
                      삭제
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}

function FcInlineEditor({
  row,
  saving,
  onCancel,
  onSave,
}: {
  row: ReportFcRow;
  saving: boolean;
  onCancel: () => void;
  onSave: (vals: {
    statement: string;
    detail: string;
    explanation: string;
    verdict: FactCheckVerdict;
  }) => void;
}) {
  const [statement, setStatement] = useState(row.item.statement);
  const [detail, setDetail] = useState(row.item.detail || "");
  const [explanation, setExplanation] = useState(row.answerText);
  const [verdict, setVerdict] = useState<FactCheckVerdict>(
    row.fc?.verdict && row.fc.verdict !== "pending"
      ? row.fc.verdict
      : "unverifiable"
  );

  return (
    <div className="space-y-2 rounded-md border border-accent/30 bg-white p-2">
      <label className="block text-[11px] text-ink-500">
        주장
        <textarea
          value={statement}
          onChange={(e) => setStatement(e.target.value)}
          rows={2}
          className="mt-0.5 w-full rounded-md border border-ink-200 px-2 py-1.5 text-xs outline-none focus:border-accent"
        />
      </label>
      <label className="block text-[11px] text-ink-500">
        상세 (선택)
        <textarea
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          rows={2}
          className="mt-0.5 w-full rounded-md border border-ink-200 px-2 py-1.5 text-xs outline-none focus:border-accent"
        />
      </label>
      <label className="block text-[11px] text-ink-500">
        팩트체크 답변
        <textarea
          value={explanation}
          onChange={(e) => setExplanation(e.target.value)}
          rows={5}
          className="mt-0.5 w-full rounded-md border border-ink-200 px-2 py-1.5 text-xs outline-none focus:border-accent"
        />
      </label>
      <label className="block text-[11px] text-ink-500">
        판정
        <select
          value={verdict}
          onChange={(e) => setVerdict(e.target.value as FactCheckVerdict)}
          className="mt-0.5 w-full rounded-md border border-ink-200 px-2 py-1.5 text-xs outline-none focus:border-accent"
        >
          {VERDICT_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {verdictBadge(v).label}
            </option>
          ))}
        </select>
      </label>
      <div className="flex gap-1.5">
        <button
          type="button"
          disabled={saving}
          onClick={() =>
            onSave({ statement, detail, explanation, verdict })
          }
          className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1.5 text-[11px] font-medium text-white disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          저장
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={onCancel}
          className="rounded-md border border-ink-200 px-2.5 py-1.5 text-[11px] font-medium"
        >
          취소
        </button>
      </div>
    </div>
  );
}
