"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy } from "lucide-react";
import type {
  FactCheckResult,
  FactCheckVerdict,
  SummaryItem,
} from "@/lib/types";

function promptOf(item: SummaryItem, fc?: FactCheckResult): string {
  return (
    item.evidence.find((e) => e.sourceHint === "factcheck-guide")?.text ||
    (fc?.explanation && /^다음 주장을/.test(fc.explanation)
      ? fc.explanation
      : "") ||
    `다음 주장을 팩트체크해 주세요: 「${item.statement}」 — 수치·시기·지명·사료 근거와 반론을 출처와 함께 검증해 주세요.`
  );
}

export function FactCheckPanel({
  videoId,
  items,
  factChecks,
}: {
  videoId: string;
  items: SummaryItem[];
  factChecks: FactCheckResult[];
}) {
  const router = useRouter();
  const map = new Map(factChecks.map((f) => [f.itemId, f]));
  const [saving, setSaving] = useState<string | null>(null);

  async function saveManual(
    itemId: string,
    explanation: string,
    verdict: FactCheckVerdict
  ) {
    setSaving(itemId);
    try {
      await fetch(`/api/videos/${videoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          factCheck: {
            itemId,
            verdict,
            explanation,
            sources: [],
          },
          rebuild: true,
        }),
      });
      router.refresh();
    } finally {
      setSaving(null);
    }
  }

  const targets = items.filter((i) => i.needsFactCheck);

  return (
    <div className="space-y-4">
      {targets.map((item) => {
        const fc = map.get(item.id);
        return (
          <EditCard
            key={item.id}
            item={item}
            fc={fc}
            saving={saving === item.id}
            onSave={saveManual}
          />
        );
      })}
    </div>
  );
}

function EditCard({
  item,
  fc,
  saving,
  onSave,
}: {
  item: SummaryItem;
  fc?: FactCheckResult;
  saving: boolean;
  onSave: (
    itemId: string,
    explanation: string,
    verdict: FactCheckVerdict
  ) => Promise<void>;
}) {
  const prompt = promptOf(item, fc);
  const existingAnswer =
    fc?.explanation && !/^다음 주장을/.test(fc.explanation)
      ? fc.explanation
      : "";
  const [answer, setAnswer] = useState(existingAnswer);
  const [verdict, setVerdict] = useState<FactCheckVerdict>(
    fc?.verdict && fc.verdict !== "pending" ? fc.verdict : "unverifiable"
  );
  const [copied, setCopied] = useState(false);

  return (
    <article className="rounded-xl border border-ink-200 bg-white p-4 space-y-3">
      <div>
        <p className="text-xs text-accent font-medium mb-1">팩트체크 대상</p>
        <p className="text-ink-900 font-medium leading-snug">{item.statement}</p>
      </div>
      {item.detail && (
        <div className="rounded-lg border border-ink-100 bg-ink-50/80 px-3 py-2.5">
          <p className="text-xs text-ink-500 font-medium mb-1">
            왜 확인해야 하나
          </p>
          <p className="text-sm text-ink-700 leading-relaxed">{item.detail}</p>
        </div>
      )}

      <div className="rounded-lg border border-accent/20 bg-accent-muted/30 px-3 py-2.5 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-accent font-medium">AI에게 물어볼 내용</p>
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(prompt);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {
                /* ignore */
              }
            }}
            className="inline-flex items-center gap-1 rounded-md border border-ink-200 bg-white px-2 py-1 text-xs"
          >
            <Copy className="h-3 w-3" />
            {copied ? "복사됨" : "복사"}
          </button>
        </div>
        <p className="text-sm text-ink-700 leading-relaxed">{prompt}</p>
      </div>

      <label className="block text-sm text-ink-700">
        AI 답변 · 팩트체크 결과 입력
        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          rows={5}
          className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-base"
          placeholder="제미나이 등에서 받은 답변을 붙여넣으세요."
        />
      </label>

      <div className="flex flex-wrap gap-1.5">
        {(
          [
            ["true", "사실"],
            ["mostly_true", "대체로 사실"],
            ["mixed", "일부 사실"],
            ["mostly_false", "대체로 거짓"],
            ["false", "거짓"],
            ["unverifiable", "검증 불가"],
          ] as Array<[FactCheckVerdict, string]>
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            onClick={() => setVerdict(v)}
            className={`min-h-9 rounded-lg border px-2.5 text-xs ${
              verdict === v
                ? "border-accent bg-accent-muted"
                : "border-ink-200 bg-white text-ink-600"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <button
        type="button"
        disabled={saving || answer.trim().length < 20}
        onClick={() => onSave(item.id, answer, verdict)}
        className="w-full sm:w-auto min-h-11 rounded-lg bg-ink-900 text-white text-sm px-4 py-2.5 hover:bg-accent disabled:opacity-60"
      >
        {saving ? "저장 중…" : "저장 · 보고서 갱신"}
      </button>
    </article>
  );
}
