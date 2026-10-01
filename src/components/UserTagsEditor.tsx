"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Hash } from "lucide-react";
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
  const rawRef = useRef(raw);
  const savedRef = useRef(formatTagList(initialTags));
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    rawRef.current = raw;
  }, [raw]);

  const saveTags = useCallback(async () => {
    const next = formatTagList(parseTagInput(rawRef.current));
    if (next === savedRef.current) return;
    setError(null);
    try {
      const tags = parseTagInput(rawRef.current);
      const res = await fetch(`/api/videos/${videoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updateUserTags: { tags } }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "태그를 넣지 못했습니다.");
      const formatted = formatTagList(tags);
      setRaw(formatted);
      rawRef.current = formatted;
      savedRef.current = formatted;
      setStatus("태그를 반영했습니다.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "태그를 넣지 못했습니다.");
    }
  }, [router, videoId]);

  useEffect(() => {
    function onFlush(e: Event) {
      const id = (e as CustomEvent<string>).detail;
      if (id && id !== videoId) return;
      void saveTags();
    }
    window.addEventListener("yfc-flush-tags", onFlush);
    return () => window.removeEventListener("yfc-flush-tags", onFlush);
  }, [saveTags, videoId]);

  return (
    <div className="rounded-xl border border-ink-200 bg-white px-3 py-3 space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium text-ink-800">
        <Hash className="h-4 w-4 text-accent" />
        분류 태그
      </div>
      <p className="text-[11px] text-ink-500">
        공백·쉼표로 구분. 칸에서 나가거나 완료하면 반영됩니다. 예:{" "}
        <code className="text-ink-700">
          #{themeHint || "역사팩트체크"} #조선
        </code>
      </p>
      <input
        value={raw}
        onChange={(e) => {
          setRaw(e.target.value);
          setStatus(null);
        }}
        onBlur={() => void saveTags()}
        placeholder="#태그1 #태그2"
        className="w-full min-h-10 rounded-lg border border-ink-200 px-3 text-sm"
      />
      {status && <p className="text-xs text-verify-true">{status}</p>}
      {error && <p className="text-xs text-verify-false">{error}</p>}
    </div>
  );
}
