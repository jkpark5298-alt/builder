"use client";

import type { FactCheckVerdict, TypedReport } from "@/lib/types";
import { verdictBadge } from "@/lib/text-format";
import { normalizeImageUrls } from "@/lib/image-urls";
import type { FcMarker } from "@/lib/fc-markers";

export function FactCheckAppendix({
  markers,
  draft,
  fcByItem,
}: {
  markers: FcMarker[];
  draft: TypedReport;
  fcByItem: Map<
    string,
    (typeof draft.factChecks)[number]
  >;
}) {
  if (!markers.length) return null;

  return (
    <section
      id="fc-appendix"
      className="hidden print:block rounded-none border-0 bg-white p-0 space-y-5"
    >
      <h2 className="font-display text-xl text-ink-900 border-b-2 border-ink-900 pb-2 mb-4">
        팩트 체크 내용
      </h2>
      <p className="text-sm text-ink-500 -mt-2 mb-4">
        보고서 본문의 F 번호에 대응하는 검증 상세입니다.
      </p>
      {markers.map((m) => {
        const fc = m.entry.itemId ? fcByItem.get(m.entry.itemId) : undefined;
        const verdict = (fc?.verdict ?? "pending") as FactCheckVerdict;
        const badge = verdictBadge(verdict);
        const parts =
          m.entry.answerParts?.length
            ? m.entry.answerParts
            : fc?.answerParts?.length
              ? fc.answerParts
              : null;
        const imgs = Array.from(
          new Set(
            [
              ...normalizeImageUrls(
                m.entry.answerImageUrl,
                m.entry.answerImageUrls
              ),
              ...normalizeImageUrls(fc?.answerImageUrl, fc?.answerImageUrls),
              ...(parts ?? []).flatMap((p) => p.imageUrls ?? []),
            ].filter((u) => !/i\.ytimg\.com|ytimg\.com\/vi\//i.test(u))
          )
        );

        return (
          <div key={m.key} className="space-y-2 break-inside-avoid">
            <p className="font-medium text-ink-900">
              <span className="fc-badge-print mr-2">F{m.n}</span>
              {m.entry.text}
              <span className="ml-2 text-sm font-normal text-ink-500">
                ({badge.label})
              </span>
            </p>
            {parts?.length ? (
              parts.map((part) => (
                <div key={part.number} className="pl-2 text-sm space-y-1">
                  <p className="whitespace-pre-wrap">
                    {part.number}. {part.text}
                  </p>
                  {(part.imageUrls ?? [])
                    .filter(
                      (u) => !/i\.ytimg\.com|ytimg\.com\/vi\//i.test(u)
                    )
                    .map((src) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={src.slice(0, 40)}
                        src={src}
                        alt=""
                        className="max-h-48 object-contain border border-ink-100"
                      />
                    ))}
                </div>
              ))
            ) : (
              <>
                {(fc?.checkGuide || m.entry.html) && (
                  <p className="text-sm text-ink-700 whitespace-pre-wrap pl-2">
                    {fc?.checkGuide ||
                      m.entry.html?.replace(/<[^>]+>/g, "")}
                  </p>
                )}
                {imgs.map((src) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={src.slice(0, 40)}
                    src={src}
                    alt=""
                    className="max-h-48 object-contain border border-ink-100 ml-2"
                  />
                ))}
              </>
            )}
          </div>
        );
      })}
    </section>
  );
}

