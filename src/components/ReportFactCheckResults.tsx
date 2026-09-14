"use client";

import type { TypedReport, VideoRecord } from "@/lib/types";
import type { FcMarker } from "@/lib/fc-markers";
import { factCheckResultPlain } from "@/lib/factcheck-result-text";
import { verdictBadge } from "@/lib/text-format";
import { FactCheckDetailPanel } from "@/components/FactCheckDetailPanel";

/** 보기·인쇄·PDF: 보고서 본문 아래에 팩트체크 결과 */
export function ReportFactCheckResults({
  markers,
  fcByItem,
  video,
  openKey,
  onToggleKey,
  onVideoUpdate,
}: {
  markers: FcMarker[];
  fcByItem: Map<string, TypedReport["factChecks"][number]>;
  video: VideoRecord;
  openKey: string | null;
  onToggleKey: (key: string | null) => void;
  onVideoUpdate: (video: VideoRecord) => void;
}) {
  if (!markers.length) return null;

  return (
    <section
      id="report-fc-results"
      className="space-y-3 mt-8 pt-6 border-t-2 border-ink-900 print:mt-6"
    >
      <h2 className="font-display text-xl text-ink-900 border-b-2 border-ink-900 pb-2">
        팩트체크 결과
      </h2>
      <p className="text-xs text-ink-500 -mt-1 print:hidden">
        보고서에서 검증한 항목의 판정과 결과입니다. 번호를 누르면 상세를
        펼칩니다.
      </p>
      <ol className="space-y-3">
        {markers.map((m) => {
          const reportFc = m.entry.itemId
            ? fcByItem.get(m.entry.itemId)
            : undefined;
          const videoFc = m.entry.itemId
            ? video.factChecks.find((f) => f.itemId === m.entry.itemId)
            : undefined;
          const item = m.entry.itemId
            ? video.items.find((i) => i.id === m.entry.itemId)
            : undefined;
          const verdict = reportFc?.verdict ?? videoFc?.verdict ?? "pending";
          const badge = verdictBadge(verdict);
          const result = factCheckResultPlain({
            entry: m.entry,
            reportFc,
            videoFc,
            item,
          });
          const isOpen = openKey === m.key;
          return (
            <li key={m.key} className="break-inside-avoid">
              <button
                type="button"
                className="w-full text-left rounded-xl border border-ink-200 bg-white px-3 py-2.5 hover:border-accent print:hover:border-ink-200 print:cursor-default"
                onClick={() =>
                  onToggleKey(isOpen ? null : m.key)
                }
              >
                <div className="flex items-start gap-2">
                  <span className="fc-badge shrink-0 mt-0.5 print:hidden">
                    F{m.n}
                  </span>
                  <span className="fc-badge-print mr-2 hidden print:inline">
                    F{m.n}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink-900 leading-relaxed">
                      {m.entry.text}
                      <span
                        className={`ml-2 text-xs font-semibold ${
                          badge.ok
                            ? "text-verify-true"
                            : "text-verify-false"
                        }`}
                      >
                        {badge.mark} {badge.label}
                      </span>
                    </p>
                    {result ? (
                      <p className="mt-1 text-sm text-ink-700 leading-relaxed whitespace-pre-wrap">
                        {result}
                      </p>
                    ) : null}
                  </div>
                </div>
              </button>
              {isOpen && (
                <div className="mt-2 ml-1 print:hidden">
                  <FactCheckDetailPanel
                    presentation="inline"
                    label={`F${m.n}`}
                    statementFallback={m.entry.text}
                    itemId={m.entry.itemId}
                    item={item}
                    videoFc={videoFc}
                    reportFc={reportFc}
                    entry={m.entry}
                    videoId={video.id}
                    capabilities={{
                      edit: false,
                      clearDetail: true,
                      deleteAll: true,
                    }}
                    onClose={() => onToggleKey(null)}
                    onVideoUpdate={onVideoUpdate}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
