"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  FileText,
  Link2,
  Loader2,
  Plus,
  Trash2,
  Unlink,
} from "lucide-react";
import type { Topic, VideoRecord } from "@/lib/types";
import { formatTag, formatTagList, selectEntriesByTags } from "@/lib/tags";
import { collectSectionImages } from "@/lib/report-images";

export function TopicWorkspace({
  topic: initialTopic,
  entries: initialEntries,
  availableTags: initialTags,
  libraryCandidates,
}: {
  topic: Topic;
  entries: VideoRecord[];
  availableTags: string[];
  /** 주제에 아직 없는 라이브러리 항목 */
  libraryCandidates: VideoRecord[];
}) {
  const router = useRouter();
  const [topic, setTopic] = useState(initialTopic);
  const [entries, setEntries] = useState(initialEntries);
  const [availableTags, setAvailableTags] = useState(initialTags);
  const [selectedTags, setSelectedTags] = useState<string[]>(
    initialTopic.selectedComposeTags?.length
      ? initialTopic.selectedComposeTags
      : initialTopic.themeTag
        ? [initialTopic.themeTag]
        : []
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkId, setLinkId] = useState(libraryCandidates[0]?.id ?? "");
  const [extraTags, setExtraTags] = useState("");

  const matched = useMemo(
    () => selectEntriesByTags(entries, selectedTags),
    [entries, selectedTags]
  );

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/topics/${topic.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as {
        topic?: Topic;
        entries?: VideoRecord[];
        availableTags?: string[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || "저장 실패");
      if (data.topic) setTopic(data.topic);
      if (data.entries) setEntries(data.entries);
      if (data.availableTags) setAvailableTags(data.availableTags);
      router.refresh();
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장 실패");
      return null;
    } finally {
      setBusy(false);
    }
  }

  function toggleTag(tag: string) {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }

  async function compose() {
    const data = await patch({
      selectedComposeTags: selectedTags,
      composeReport: true,
    });
    if (data?.topic?.report) {
      document.getElementById("topic-report")?.scrollIntoView({
        behavior: "smooth",
      });
    }
  }

  async function linkEntry() {
    if (!linkId) return;
    const tags = extraTags
      .split(/[,，\s]+/)
      .map((t) => t.replace(/^#+/, "").trim())
      .filter(Boolean);
    await patch({
      linkEntry: { entryId: linkId, userTags: tags },
    });
    setExtraTags("");
  }

  async function unlink(entryId: string) {
    if (!confirm("이 항목을 주제에서 제거할까요? (항목 자체는 삭제되지 않습니다)"))
      return;
    await patch({ removeEntryIds: [entryId] });
  }

  async function removeTopic() {
    if (!confirm(`주제 「${topic.title}」을(를) 삭제할까요?`)) return;
    setBusy(true);
    try {
      await fetch(`/api/topics/${topic.id}`, { method: "DELETE" });
      router.push("/#topics");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const candidates = libraryCandidates.filter(
    (v) => !entries.some((e) => e.id === v.id)
  );

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <p className="text-sm text-accent font-medium">주제</p>
        <h1 className="font-display text-2xl sm:text-3xl text-ink-900">
          {topic.title}
        </h1>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-md border border-ink-200 bg-white px-2 py-1">
            {formatTag(topic.themeTag)}
          </span>
          <span className="rounded-md border border-ink-200 bg-white px-2 py-1">
            항목 {entries.length}건
          </span>
          <span className="rounded-md border border-ink-200 bg-white px-2 py-1">
            {topic.status === "ready" ? "통합 보고서 있음" : "작성 중"}
          </span>
        </div>
        {topic.description ? (
          <details className="rounded-xl border border-ink-200 bg-white px-3 py-2">
            <summary className="cursor-pointer select-none text-xs font-medium text-ink-600">
              설명 보기
            </summary>
            <p className="text-sm text-ink-600 mt-2 whitespace-pre-wrap">
              {topic.description}
            </p>
          </details>
        ) : null}
        <button
          type="button"
          onClick={removeTopic}
          disabled={busy}
          className="inline-flex items-center gap-1.5 text-xs text-verify-false hover:underline"
        >
          <Trash2 className="h-3.5 w-3.5" />
          주제 삭제
        </button>
      </header>

      {error && (
        <p className="text-sm text-verify-false bg-verify-false/10 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <section className="rounded-2xl border border-ink-200 bg-white p-4 sm:p-5 space-y-4">
        <h2 className="font-display text-lg text-ink-900 flex items-center gap-2">
          <Link2 className="h-4 w-4" />
          항목 연결
        </h2>
        <p className="text-sm text-ink-500">
          이미 만든 요약·팩트체크 항목을 이 주제에 넣고, 분류 태그를 붙입니다.
          새 내용은 홈에서 팩트체크보고서/유튜브로 만든 뒤 여기서 연결하세요.
        </p>
        {candidates.length === 0 ? (
          <p className="text-sm text-ink-400">
            연결 가능한 라이브러리 항목이 없습니다. 홈에서 항목을 먼저 만드세요.
          </p>
        ) : (
          <div className="flex flex-col sm:flex-row gap-2">
            <select
              value={linkId}
              onChange={(e) => setLinkId(e.target.value)}
              className="flex-1 min-h-11 rounded-xl border border-ink-200 px-3 text-sm"
            >
              {candidates.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.title.slice(0, 60)}
                  {formatTagList(v.userTags)
                    ? ` · ${formatTagList(v.userTags)}`
                    : ""}
                </option>
              ))}
            </select>
            <input
              value={extraTags}
              onChange={(e) => setExtraTags(e.target.value)}
              placeholder={`추가 태그 (예: #조선) · 기본 ${formatTag(topic.themeTag)}`}
              className="sm:w-56 min-h-11 rounded-xl border border-ink-200 px-3 text-sm"
            />
            <button
              type="button"
              disabled={busy || !linkId}
              onClick={linkEntry}
              className="inline-flex items-center justify-center gap-1.5 min-h-11 rounded-xl bg-ink-900 text-white px-4 text-sm font-medium hover:bg-accent disabled:opacity-60"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              연결
            </button>
          </div>
        )}

        <ul className="divide-y divide-ink-100 border border-ink-100 rounded-xl overflow-hidden">
          {entries.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-ink-400">
              아직 연결된 항목이 없습니다.
            </li>
          )}
          {entries.map((e) => (
            <li
              key={e.id}
              className="flex flex-col sm:flex-row sm:items-center gap-2 px-4 py-3 bg-white"
            >
              <div className="min-w-0 flex-1">
                <a
                  href={`/videos/${e.id}`}
                  className="font-medium text-ink-900 hover:text-accent break-words"
                >
                  {e.title}
                </a>
                <p className="text-xs text-ink-500 mt-0.5">
                  {new Date(e.createdAt).toLocaleDateString("ko-KR")} ·{" "}
                  {formatTagList(e.userTags) || "태그 없음"}
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => unlink(e.id)}
                className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-verify-false"
              >
                <Unlink className="h-3.5 w-3.5" />
                제거
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-accent/30 bg-accent-muted/20 p-4 sm:p-5 space-y-4">
        <h2 className="font-display text-lg text-ink-900 flex items-center gap-2">
          <FileText className="h-4 w-4" />
          #태그로 통합 보고서
        </h2>
        <p className="text-sm text-ink-600">
          태그를 선택하면 해당 태그가 달린 항목이 <strong>자동으로</strong>{" "}
          묶입니다. 현재 매칭: <strong>{matched.length}</strong>건
        </p>
        <div className="flex flex-wrap gap-2">
          {(availableTags.length
            ? availableTags
            : topic.themeTag
              ? [topic.themeTag]
              : []
          ).map((tag) => {
            const on = selectedTags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() => toggleTag(tag)}
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                  on
                    ? "border-accent bg-accent text-white"
                    : "border-ink-200 bg-white text-ink-700 hover:border-accent"
                }`}
              >
                {formatTag(tag)}
              </button>
            );
          })}
        </div>
        {matched.length > 0 && (
          <ul className="text-sm text-ink-600 list-disc pl-5 space-y-1">
            {matched.map((e) => (
              <li key={e.id}>
                {e.title}{" "}
                <span className="text-ink-400">
                  ({formatTagList(e.userTags)})
                </span>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          disabled={busy || matched.length === 0}
          onClick={compose}
          className="inline-flex items-center justify-center gap-2 min-h-12 rounded-xl bg-accent text-white px-5 font-medium hover:bg-ink-900 disabled:opacity-60"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <FileText className="h-4 w-4" />
          )}
          선택 태그로 보고서 만들기
        </button>
      </section>

      {topic.report && (
        <section
          id="topic-report"
          className="rounded-2xl border border-ink-200 bg-white shadow-sm overflow-hidden scroll-mt-24"
        >
          <div className="bg-ink-900 px-4 sm:px-5 py-3.5">
            <h2 className="font-display text-xl text-white">
              통합 보고서 · {topic.report.meta.title}
            </h2>
            <p className="text-xs text-white/70 mt-1">
              {topic.report.meta.writtenAt} · {topic.report.factChecks?.length ?? 0}
              건 팩트체크
            </p>
          </div>
          <div className="p-4 sm:p-6 space-y-6">
            {topic.report.sections.map((sec, idx) => (
              <article key={sec.sectionId ?? `${sec.heading}-${idx}`} className="space-y-2">
                <h3 className="font-display text-lg text-ink-900 border-b border-ink-100 pb-1">
                  {sec.heading}
                </h3>
                {sec.rich ? (
                  <div
                    className="prose prose-sm max-w-none text-ink-800 report-body"
                    dangerouslySetInnerHTML={{ __html: sec.body }}
                  />
                ) : (
                  <p className="text-sm text-ink-800 whitespace-pre-wrap">
                    {sec.body}
                  </p>
                )}
                {(() => {
                  const imgs = collectSectionImages(sec, topic.report?.imageRoom);
                  if (!imgs.length) return null;
                  return (
                    <div className="flex flex-wrap gap-2">
                      {imgs.map((src) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={src}
                          src={src}
                          alt=""
                          className="max-h-40 rounded-lg border border-ink-200 object-contain"
                        />
                      ))}
                    </div>
                  );
                })()}
                {!!sec.entries?.length && (
                  <div className="space-y-3 mt-2 pl-3 border-l-2 border-accent/40">
                    {sec.entries.map((en, ei) => (
                      <div key={`${en.itemId ?? ei}`} className="text-sm space-y-1">
                        <p className="font-medium text-ink-800">{en.text}</p>
                        {en.answerParts?.map((p) => (
                          <div key={p.number} className="text-ink-600">
                            <p>
                              {p.number}. {p.text}
                            </p>
                            <div className="flex flex-wrap gap-2 mt-1">
                              {p.imageUrls?.map((u) => (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  key={u}
                                  src={u}
                                  alt=""
                                  className="max-h-28 rounded border border-ink-200 object-contain"
                                />
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
