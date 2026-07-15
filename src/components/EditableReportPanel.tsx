"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Save, ChevronDown, ChevronUp } from "lucide-react";
import type { FactCheckVerdict, TypedReport, VideoRecord } from "@/lib/types";
import { isFailedVerdict, verdictBadge } from "@/lib/text-format";

export function EditableReportPanel({ video }: { video: VideoRecord }) {
  const router = useRouter();
  const report = video.report;
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<TypedReport | null>(report);
  const [openFc, setOpenFc] = useState<string | null>(null);

  if (!report || !draft) return null;

  const fcByItem = new Map(
    draft.factChecks
      .filter((f) => f.itemId)
      .map((f) => [f.itemId!, f])
  );

  async function saveReport() {
    setSaving(true);
    try {
      const res = await fetch(`/api/videos/${video.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updateReport: draft }),
      });
      const data = (await res.json()) as { error?: string; video?: VideoRecord };
      if (!res.ok) throw new Error(data.error || "저장 실패");
      if (data.video?.report) setDraft(data.video.report);
      setEditing(false);
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  }

  function patchSection(idx: number, body: string) {
    setDraft((prev) => {
      if (!prev) return prev;
      const sections = [...prev.sections];
      sections[idx] = { ...sections[idx], body };
      return { ...prev, sections };
    });
  }

  function factCheckForEntry(itemId?: string) {
    if (!itemId) return undefined;
    return fcByItem.get(itemId);
  }

  return (
    <section className="rounded-2xl border border-ink-200 bg-white/80 p-4 sm:p-5 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg sm:text-xl">
          3. 보고서 ({draft.reportTypeLabel})
        </h2>
        <button
          type="button"
          onClick={() => (editing ? void saveReport() : setEditing(true))}
          disabled={saving}
          className="inline-flex items-center gap-1.5 min-h-10 rounded-lg border border-ink-200 bg-white px-3 text-sm font-medium hover:border-accent"
        >
          {editing ? (
            <>
              <Save className="h-4 w-4" />
              {saving ? "저장 중…" : "저장"}
            </>
          ) : (
            <>
              <Pencil className="h-4 w-4" />
              수정
            </>
          )}
        </button>
      </div>

      <div className="rounded-xl bg-ink-50 border border-ink-100 p-3 text-sm space-y-1">
        <p>
          <span className="text-ink-500">영상 제목</span> · {draft.meta.title}
        </p>
        <p>
          <span className="text-ink-500">채널명</span> · {draft.meta.channel}
        </p>
        <p className="break-all">
          <span className="text-ink-500">링크</span> · {draft.meta.url}
        </p>
        <p>
          <span className="text-ink-500">작성일자</span> · {draft.meta.writtenAt}
        </p>
      </div>

      {draft.sections.map((sec, idx) => (
        <div key={sec.heading} className="space-y-3">
          <h3 className="font-medium text-accent">{sec.heading}</h3>

          {sec.imageUrl && (
            <div className="overflow-hidden rounded-xl border border-ink-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={sec.imageUrl}
                alt=""
                className="w-full max-h-64 object-cover"
              />
            </div>
          )}

          {editing ? (
            <textarea
              value={sec.body}
              onChange={(e) => patchSection(idx, e.target.value)}
              rows={6}
              className="w-full rounded-xl border border-ink-200 px-3 py-2 text-sm outline-none focus:border-accent"
            />
          ) : (
            sec.body && (
              <pre className="whitespace-pre-wrap text-sm text-ink-700 font-sans leading-relaxed">
                {sec.body}
              </pre>
            )
          )}

          {sec.entries?.map((entry) => {
            const fc = factCheckForEntry(entry.itemId);
            const verdict = (fc?.verdict ?? "pending") as FactCheckVerdict;
            const badge = verdictBadge(verdict);
            const open = openFc === entry.itemId;
            const failed = isFailedVerdict(verdict);

            return (
              <div
                key={entry.itemId ?? entry.text}
                className="rounded-xl border border-ink-100 overflow-hidden"
              >
                {entry.imageUrl && (
                  <div className="border-b border-ink-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={entry.imageUrl}
                      alt=""
                      className="w-full max-h-48 object-cover"
                    />
                  </div>
                )}
                <div className="p-3 space-y-2">
                  <p className="font-medium text-ink-900 leading-snug">
                    {entry.text}
                  </p>

                  {fc && (
                    <div className="border-t border-ink-100 pt-2">
                      <button
                        type="button"
                        onClick={() =>
                          setOpenFc(open ? null : (entry.itemId ?? null))
                        }
                        className={`w-full flex items-center justify-between gap-2 min-h-10 rounded-lg px-3 text-sm font-medium border ${
                          failed
                            ? "border-verify-false/40 bg-verify-false/10 text-verify-false"
                            : badge.ok
                              ? "border-verify-true/30 bg-verify-true/10 text-verify-true"
                              : "border-ink-200 bg-ink-50 text-ink-700"
                        }`}
                      >
                        <span>
                          FACT CHECK {badge.mark}{" "}
                          {badge.label !== "대기" ? badge.label : "결과 보기"}
                        </span>
                        {open ? (
                          <ChevronUp className="h-4 w-4 shrink-0" />
                        ) : (
                          <ChevronDown className="h-4 w-4 shrink-0" />
                        )}
                      </button>

                      {open && fc.checkGuide && (
                        <div className="mt-2 rounded-lg bg-white border border-ink-100 p-3 text-sm text-ink-700 whitespace-pre-wrap leading-relaxed">
                          {failed && (
                            <p className="text-verify-false font-bold text-lg mb-2">
                              ✗ 사실과 다름
                            </p>
                          )}
                          {fc.checkGuide}
                          {fc.answerImageUrl &&
                            fc.answerImageUrl !== entry.imageUrl && (
                              <div className="mt-3 overflow-hidden rounded-lg border border-ink-100">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={fc.answerImageUrl}
                                  alt=""
                                  className="w-full max-h-40 object-cover"
                                />
                              </div>
                            )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}

      {editing && (
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="text-sm text-ink-500 underline"
        >
          취소
        </button>
      )}
    </section>
  );
}
