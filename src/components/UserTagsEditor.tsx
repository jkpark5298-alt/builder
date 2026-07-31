"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Hash, Loader2, Save } from "lucide-react";
import { formatTagList, parseTagInput } from "@/lib/tags";

export function UserTagsEditor({
  videoId,
  initialTags,
  themeHint,
}: {
  videoId: string;
  initialTags?: string[];
  /** 예: 역사팩트체크 — 입력 힌트 */
  themeHint?: string;
}) {
  const router = useRouter();
  const [raw, setRaw] = useState(formatTagList(initialTags));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const tags = parseTagInput(raw);
      const res = await fetch(`/api/videos/${videoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updateUserTags: { tags } }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "태그 저장 실패");
      setRaw(formatTagList(tags));
      setStatus("태그를 저장했습니다.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "태그 저장 실패");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-xl border border-ink-200 bg-white px-3 py-3 space-y-2"
    >
      <div className="flex items-center gap-2 text-sm font-medium text-ink-800">
        <Hash className="h-4 w-4 text-accent" />
        분류 태그
      </div>
      <p className="text-[11px] text-ink-500">
        공백·쉼표로 구분. 예:{" "}
        <code className="text-ink-700">
          #{themeHint || "역사팩트체크"} #조선 #임진왜란
        </code>
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="#태그1 #태그2"
          className="flex-1 min-h-10 rounded-lg border border-ink-200 px-3 text-sm"
        />
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center justify-center gap-1.5 min-h-10 rounded-lg bg-ink-900 text-white px-3 text-sm font-medium hover:bg-accent disabled:opacity-60"
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          저장
        </button>
      </div>
      {status && <p className="text-xs text-verify-true">{status}</p>}
      {error && <p className="text-xs text-verify-false">{error}</p>}
    </form>
  );
}
