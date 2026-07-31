"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { FolderPlus, Loader2 } from "lucide-react";
import type { ReportType } from "@/lib/types";
import { REPORT_TYPE_LABELS } from "@/lib/types";
import { themeTagFromTitle } from "@/lib/tags";

export function TopicCreateForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [themeTag, setThemeTag] = useState("");
  const [reportType, setReportType] = useState<ReportType>("H");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewTag = themeTag.trim() || themeTagFromTitle(title) || "…";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("주제 제목을 입력해 주세요.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/topics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          themeTag: themeTag.trim() || undefined,
          reportType,
        }),
      });
      const data = (await res.json()) as { topic?: { id: string }; error?: string };
      if (!res.ok || !data.topic) {
        throw new Error(data.error || "주제 생성 실패");
      }
      router.push(`/topics/${data.topic.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "주제 생성 실패");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      id="topic-create"
      onSubmit={onSubmit}
      className="rounded-2xl border border-ink-200 bg-white/90 p-4 sm:p-6 space-y-4 shadow-sm"
    >
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-ink-900 text-white p-2.5 shrink-0">
          <FolderPlus className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl text-ink-900">주제 만들기</h2>
          <details className="mt-1.5">
            <summary className="cursor-pointer select-none text-xs text-ink-500 hover:text-ink-800">
              사용 방법 보기
            </summary>
            <p className="text-sm text-ink-500 mt-1.5 leading-relaxed">
              예: <strong>역사 팩트 체크</strong> — 항목을 수시로 추가·태그
              저장한 뒤, <strong>#태그</strong>로 골라 통합 보고서를 만듭니다.
            </p>
          </details>
        </div>
      </div>

      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-ink-600">주제 제목</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="역사 팩트 체크"
          className="w-full min-h-11 rounded-xl border border-ink-200 bg-white px-3 text-sm"
          required
        />
      </label>

      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-ink-600">
          주제 태그 (#) — 비우면 제목에서 자동
        </span>
        <input
          value={themeTag}
          onChange={(e) => setThemeTag(e.target.value)}
          placeholder="#역사팩트체크"
          className="w-full min-h-11 rounded-xl border border-ink-200 bg-white px-3 text-sm"
        />
        <span className="text-[11px] text-ink-400">
          항목 연결 시 기본으로 <strong>#{previewTag}</strong> 가 붙습니다.
        </span>
      </label>

      <details className="rounded-xl border border-ink-200 bg-white px-3 py-2">
        <summary className="cursor-pointer select-none text-xs font-medium text-ink-600 py-1">
          설명 추가 (선택)
        </summary>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="이 주제에 모을 내용 안내"
          className="mt-2 w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm"
        />
      </details>

      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-ink-600">기본 유형</span>
        <select
          value={reportType}
          onChange={(e) => setReportType(e.target.value as ReportType)}
          className="w-full min-h-11 rounded-xl border border-ink-200 bg-white px-3 text-sm"
        >
          {(Object.keys(REPORT_TYPE_LABELS) as ReportType[]).map((k) => (
            <option key={k} value={k}>
              {REPORT_TYPE_LABELS[k]}
            </option>
          ))}
        </select>
      </label>

      {error && (
        <p className="text-sm text-verify-false bg-verify-false/10 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="inline-flex items-center justify-center gap-2 min-h-12 w-full sm:w-auto rounded-xl bg-ink-900 text-white px-5 font-medium hover:bg-accent disabled:opacity-60"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <FolderPlus className="h-4 w-4" />
        )}
        주제 만들고 열기
      </button>
    </form>
  );
}
