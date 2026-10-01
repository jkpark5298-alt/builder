"use client";

import { ClipboardPaste, Loader2, Save } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { VideoRecord } from "@/lib/types";
import { RichTextEditor } from "@/components/RichTextEditor";
import { cacheVideoSnapshot } from "./VideoNotFoundRecovery";
import {
  archiveDateLabel,
  plainForArchive,
  tempTitleFromPlain,
} from "@/lib/archive-input";
import { ARCHIVE_FLOW, archiveFlowLabel } from "@/lib/flow-steps";
import { copyTextToClipboard } from "@/lib/clipboard";
import { tidyReportPasteSpacing, normalizePastedText } from "@/lib/paste";
import {
  createInlineImage,
  htmlToPlainText,
  plainToHtml,
} from "@/lib/rich-text";

const LEAVE_EVENT = "yfc-archive-leave";
const LEAVE_CONTINUE = "yfc-archive-leave-continue";

type LeaveMode = "leave" | "report";

export type ReportFormValues = {
  title: string;
  bodyHtml: string;
  sourceUrl?: string;
};

function imageSrcs(html: string): string[] {
  return [...html.matchAll(/<img\b[^>]*src=["']([^"']+)["']/gi)].map((m) => m[1]);
}

function withSpacing(html: string): string {
  const plain = plainForArchive(htmlToPlainText(html));
  const tidied = tidyReportPasteSpacing(plain);
  let next = plainToHtml(tidied);
  if (typeof document === "undefined") return next;
  for (const src of imageSrcs(html)) {
    next += createInlineImage(src, "이미지").outerHTML;
  }
  return next;
}

async function uploadImages(files: File[]): Promise<string[]> {
  const urls: string[] = [];
  for (const file of files) {
    const form = new FormData();
    form.append("file", file);
    form.append("prefix", "videos/archive");
    const res = await fetch("/api/media/upload", { method: "POST", body: form });
    const data = (await res.json().catch(() => ({}))) as {
      url?: string;
      error?: string;
    };
    if (!res.ok || !data.url) {
      throw new Error(data.error || "이미지 업로드 실패");
    }
    urls.push(data.url);
  }
  return urls;
}

export function ReportCreateForm({
  draftId,
  savedAt,
  initial,
}: {
  draftId?: string;
  savedAt?: string;
  initial?: Partial<ReportFormValues>;
}) {
  const [activeDraftId, setActiveDraftId] = useState(draftId);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [bodyHtml, setBodyHtml] = useState(initial?.bodyHtml ?? "");
  const [sourceUrl, setSourceUrl] = useState(initial?.sourceUrl ?? "");
  const [titleTouched, setTitleTouched] = useState(Boolean(initial?.title));
  const [savedKey, setSavedKey] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [metaBusy, setMetaBusy] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [urlWhenMeta, setUrlWhenMeta] = useState(
    (initial?.sourceUrl ?? "").trim()
  );
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveMode, setLeaveMode] = useState<LeaveMode>("leave");
  const titleTouchedRef = useRef(titleTouched);
  const dirtyRef = useRef(false);
  const pendingHref = useRef<string | null>(null);
  const router = useRouter();
  titleTouchedRef.current = titleTouched;

  function keyOf(next: { title: string; bodyHtml: string; sourceUrl: string }) {
    return JSON.stringify({
      title: next.title.trim(),
      bodyHtml: next.bodyHtml,
      sourceUrl: next.sourceUrl.trim(),
    });
  }

  const currentKey = keyOf({ title, bodyHtml, sourceUrl });
  const dirty = hydrated && currentKey !== savedKey;
  dirtyRef.current = dirty;
  const plain = plainForArchive(htmlToPlainText(bodyHtml));
  const dateLabel = archiveDateLabel(savedAt);
  const hasUrl = sourceUrl.trim().length > 0;
  const hasContent = plain.trim().length > 0 || title.trim().length >= 2;
  const needMeta = hasUrl && urlWhenMeta !== sourceUrl.trim();
  const nextStep: "input" | "meta" | "save" | "report" = !hasContent
    ? "input"
    : needMeta
      ? "meta"
      : dirty || !activeDraftId
        ? "save"
        : "report";
  const visibleSteps = ARCHIVE_FLOW.filter((s) => {
    if (s.id === "instagram" || s.id === "meta") return hasUrl;
    if (s.n >= 6) return false;
    return true;
  });
  const nextBox =
    "rounded-2xl border-2 border-amber-400 bg-amber-50/40 p-2 sm:p-3";
  const nextChip =
    "border-2 border-amber-400 bg-amber-50 text-ink-900";
  const nextBtn =
    "border-2 border-amber-400 bg-amber-50 text-ink-900 shadow-[0_0_0_3px_rgba(251,191,36,0.35)]";

  useEffect(() => {
    const base = {
      title: initial?.title ?? "",
      bodyHtml: initial?.bodyHtml ?? "",
      sourceUrl: initial?.sourceUrl ?? "",
    };
    setSavedKey(keyOf(base));
    setHydrated(true);
    // 최초 서버 값만 기준점으로 잡는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);

  useEffect(() => {
    function onLeave(e: Event) {
      if (!dirtyRef.current) return;
      e.preventDefault();
      setLeaveMode("leave");
      setLeaveOpen(true);
    }
    window.addEventListener(LEAVE_EVENT, onLeave);
    return () => window.removeEventListener(LEAVE_EVENT, onLeave);
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const onBefore = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a) return;
      const href = a.getAttribute("href") || "";
      if (!href || href.startsWith("#")) return;
      e.preventDefault();
      e.stopPropagation();
      pendingHref.current = href;
      setLeaveMode("leave");
      setLeaveOpen(true);
    };
    window.addEventListener("beforeunload", onBefore);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBefore);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  function onBodyChange(html: string) {
    setBodyHtml(html);
    if (!titleTouchedRef.current) {
      const nextTitle = tempTitleFromPlain(plainForArchive(htmlToPlainText(html)));
      if (plainForArchive(htmlToPlainText(html))) setTitle(nextTitle);
    }
  }

  function payload() {
    const text = normalizePastedText(plainForArchive(htmlToPlainText(bodyHtml)));
    const resolvedTitle =
      title.trim().length >= 2
        ? title.trim()
        : tempTitleFromPlain(text);
    return {
      title: resolvedTitle,
      channel: sourceUrl.trim() ? "인스타" : undefined,
      pastedScript: text,
      inputBodyHtml: bodyHtml,
      sourceUrl: sourceUrl.trim() || undefined,
      articleImages: imageSrcs(bodyHtml),
      thumbnailUrl: imageSrcs(bodyHtml)[0],
    };
  }

  async function saveDraft(): Promise<string | null> {
    setError(null);
    const body = payload();
    if (body.title.trim().length < 2 && !body.pastedScript) {
      setError("내용을 붙여넣은 뒤 임시 저장을 선택하세요.");
      return null;
    }
    setSaving(true);
    setStatus(null);
    try {
      if (activeDraftId) {
        const res = await fetch(`/api/videos/${activeDraftId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ updateReportInput: body }),
        });
        const data = (await res.json()) as { error?: string; video?: { id: string } };
        if (!res.ok) throw new Error(data.error || "임시 저장 실패");
        const saved = (data as { video?: VideoRecord }).video;
        if (saved?.id) {
          window.dispatchEvent(
            new CustomEvent("yfc-archive-saved", { detail: saved })
          );
        }
        setTitle(body.title);
        setSavedKey(keyOf({ title: body.title, bodyHtml, sourceUrl }));
      setStatus("임시 저장됨. 아래 이어하기와 처음 화면 목록에 나옵니다.");
      setLeaveOpen(false);
      router.refresh();
      return activeDraftId;
      } else {
        const res = await fetch("/api/videos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "report_draft", ...body }),
        });
        const data = (await res.json()) as {
          error?: string;
          video?: { id: string };
        };
        if (!res.ok || !data.video?.id) {
          throw new Error(data.error || "임시 저장 실패");
        }
        setActiveDraftId(data.video.id);
        cacheVideoSnapshot(data.video);
        window.dispatchEvent(
          new CustomEvent("yfc-archive-saved", { detail: data.video })
        );
        setTitle(body.title);
        setSavedKey(keyOf({ title: body.title, bodyHtml, sourceUrl }));
        setStatus("임시 저장됨. 아래 이어하기와 처음 화면 목록에 나옵니다.");
        setLeaveOpen(false);
        router.refresh();
        return data.video.id;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "임시 저장 실패");
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function copyAll() {
    const text = plainForArchive(htmlToPlainText(bodyHtml));
    if (!text) {
      setError("복사할 내용이 없습니다.");
      return;
    }
    const ok = await copyTextToClipboard(text);
    if (!ok) {
      setError("복사에 실패했습니다. 본문을 길게 눌러 복사해 주세요.");
      return;
    }
    setCopied(true);
    setError(null);
    window.setTimeout(() => setCopied(false), 1600);
  }

  async function loadMeta() {
    const url = sourceUrl.trim();
    if (!url) {
      setError("인스타 URL을 입력하세요.");
      return;
    }
    setMetaBusy(true);
    setError(null);
    setStatus("메타 보는 중…");
    try {
      const res = await fetch("/api/instagram/meta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = (await res.json()) as {
        error?: string;
        title?: string;
        description?: string;
        imageUrl?: string | null;
        warning?: string | null;
      };
      if (!res.ok) throw new Error(data.error || "메타 보기에 실패했습니다.");
      const caption = (data.description || "").trim();
      let html = caption ? plainToHtml(caption) : bodyHtml;
      if (data.imageUrl && typeof document !== "undefined") {
        html += createInlineImage(data.imageUrl, "인스타").outerHTML;
      }
      if (caption || data.imageUrl) setBodyHtml(html);
      if (!titleTouchedRef.current) {
        const fromCaption = tempTitleFromPlain(caption || data.title || "");
        setTitle(fromCaption);
      }
      setUrlWhenMeta(url);
      setStatus(
        data.warning ||
          (caption
            ? "메타 보기를 불러왔습니다. 임시 저장을 선택하면 보관됩니다."
            : "메타를 일부만 가져왔습니다. 캡션은 붙여넣기로 보완하세요.")
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "메타 보기에 실패했습니다.");
      setStatus(null);
    } finally {
      setMetaBusy(false);
    }
  }

  async function openReportFrom(id: string) {
    setReportBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/videos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startReportPipeline: true,
          manualOverview: !sourceUrl.trim(),
          updateReportInput: payload(),
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        video?: { id: string };
      };
      if (!res.ok || !data.video?.id) {
        throw new Error(data.error || "보고서 화면을 열지 못했습니다.");
      }
      dirtyRef.current = false;
      cacheVideoSnapshot(data.video);
      window.location.assign(`/videos/${data.video.id}#report`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "보고서 화면을 열지 못했습니다.");
    } finally {
      setReportBusy(false);
    }
  }

  async function openReport() {
    if (dirty || !activeDraftId) {
      setLeaveMode("report");
      setLeaveOpen(true);
      return;
    }
    await openReportFrom(activeDraftId);
  }

  function discardAndLeave() {
    dirtyRef.current = false;
    setLeaveOpen(false);
    const href = pendingHref.current;
    pendingHref.current = null;
    if (href) {
      window.location.assign(href);
      return;
    }
    window.dispatchEvent(new Event(LEAVE_CONTINUE));
  }

  async function saveThenContinue() {
    const mode = leaveMode;
    const id = await saveDraft();
    if (!id) return;
    if (mode === "report") {
      await openReportFrom(id);
      return;
    }
    discardAndLeave();
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void saveDraft();
  }

  return (
    <form
      id="report-create"
      onSubmit={onSubmit}
      className="relative rounded-2xl border border-ink-200 bg-white/80 p-5 sm:p-6 shadow-sm pb-28 sm:pb-6"
    >
      <div className="space-y-4">
        <div>
          <h2 className="font-display text-2xl text-ink-900">{archiveFlowLabel("input")}</h2>
          <ol className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-ink-600 sm:grid-cols-5">
            {visibleSteps.map((s) => {
              const isNext =
                (s.id === "input" && nextStep === "input") ||
                (s.id === "meta" && nextStep === "meta") ||
                (s.id === "save" && nextStep === "save") ||
                (s.id === "report" && nextStep === "report");
              return (
                <li
                  key={s.id}
                  className={`rounded-md border px-1.5 py-1 ${
                    isNext
                      ? nextChip
                      : s.id === "input"
                        ? "border-ink-200 bg-white text-ink-900"
                        : "border-ink-200 bg-white"
                  }`}
                >
                  {s.n}. {s.short}
                </li>
              );
            })}
          </ol>
          <p className="text-sm text-ink-500 mt-2">
            붙여넣기. 첫 줄이 임시 제목입니다. 일자 {dateLabel}.
          </p>
        </div>

        <div className={nextStep === "input" ? nextBox : ""}>
          <label className="block text-sm text-ink-600">
            임시 제목
            <input
              value={title}
              onChange={(e) => {
                setTitleTouched(true);
                setTitle(e.target.value);
              }}
              placeholder="본문 첫 줄이 들어옵니다"
              className="mt-1.5 w-full rounded-xl border border-ink-200 bg-white px-4 py-3 text-base outline-none focus:border-accent"
            />
          </label>

          <div className="space-y-2 mt-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm text-ink-600">본문</p>
              <button
                type="button"
                onClick={() => void copyAll()}
                className="inline-flex items-center gap-1 rounded-lg border border-ink-200 bg-white px-2.5 py-1 text-xs font-medium"
              >
                <ClipboardPaste className="h-3.5 w-3.5" />
                {copied ? "복사됨" : "전체 복사"}
              </button>
              <button
                type="button"
                onClick={() => setBodyHtml((html) => withSpacing(html))}
                title="1. 제목 아래에 ● 라벨: 설명 으로 나눕니다"
                className="rounded-lg border border-ink-200 bg-white px-2.5 py-1 text-xs font-medium"
              >
                문단 간격만 정리
              </button>
            </div>
            <RichTextEditor
              value={bodyHtml}
              onChange={onBodyChange}
              onUploadImages={uploadImages}
              toolbarMode="full"
              placeholder="제미나이 등에서 복사한 내용을 붙여넣으세요"
              minHeightClass="min-h-[16rem]"
            />
          </div>
        </div>

        <div className={hasUrl && nextStep === "meta" ? nextBox : ""}>
          <label className="block text-sm text-ink-600">
            {hasUrl ? archiveFlowLabel("instagram") : "인스타 주소 (있으면)"}
            <input
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://www.instagram.com/p/…"
              className="mt-1.5 w-full rounded-xl border border-ink-200 bg-white px-4 py-3 text-base outline-none focus:border-accent"
            />
          </label>
          {hasUrl ? (
            <div className="flex flex-wrap gap-2 mt-2">
              <button
                type="button"
                disabled={metaBusy}
                onClick={() => void loadMeta()}
                className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium disabled:opacity-50 ${
                  nextStep === "meta"
                    ? nextBtn
                    : "border border-ink-300 bg-white"
                }`}
              >
                {metaBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {archiveFlowLabel("meta")}
              </button>
              <button
                type="button"
                onClick={() => {
                  const raw = sourceUrl.trim();
                  if (!raw) {
                    setError("원문을 열 URL을 입력하세요.");
                    return;
                  }
                  const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
                  try {
                    const parsed = new URL(href);
                    window.open(parsed.href, "_blank", "noopener,noreferrer");
                    setError(null);
                  } catch {
                    setError("원문 주소가 올바르지 않습니다.");
                  }
                }}
                className="inline-flex items-center rounded-xl border border-ink-300 bg-white px-4 py-2 text-sm font-medium text-accent"
              >
                원문 열기
              </button>
            </div>
          ) : null}
        </div>

        {status && (
          <p className="rounded-xl border border-ink-200 bg-ink-50 px-4 py-3 text-sm text-ink-700" role="status">
            {status}
          </p>
        )}
        {error && (
          <p className="rounded-xl border border-red-600 bg-red-50 px-4 py-3 text-sm font-medium text-red-700" role="alert">
            {error}
          </p>
        )}

        {leaveOpen && (
          <div
            role="alertdialog"
            aria-labelledby="unsaved-title"
            className="rounded-xl border-2 border-red-600 bg-red-50 px-4 py-4 text-red-700"
          >
            <p id="unsaved-title" className="font-semibold">
              임시 저장을 선택하지 않았습니다.
            </p>
            <p className="mt-1 text-sm">
              {leaveMode === "report"
                ? "저장하지 않으면 입력한 내용이 보고서 화면에 넘어가지 않습니다. 임시 저장을 선택하세요."
                : "저장하지 않으면 입력한 내용이 보관되지 않습니다. 임시 저장을 선택하세요."}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => void saveThenContinue()}
                className="rounded-lg bg-red-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                임시 저장
              </button>
              {leaveMode === "leave" && (
                <button
                  type="button"
                  onClick={discardAndLeave}
                  className="rounded-lg border border-red-600 bg-white px-3 py-2 text-sm font-medium text-red-700"
                >
                  저장하지 않고 나가기
                </button>
              )}
              <button
                type="button"
                onClick={() => setLeaveOpen(false)}
                className="rounded-lg border border-red-300 bg-white px-3 py-2 text-sm text-red-700"
              >
                취소
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-col sm:flex-row gap-2">
        <div className={`flex-1 ${nextStep === "save" ? nextBox : ""}`}>
          <button
            type="submit"
            disabled={saving || reportBusy}
            className={`inline-flex w-full items-center justify-center gap-2 rounded-xl min-h-12 px-5 py-3 font-medium disabled:opacity-50 ${
              nextStep === "save"
                ? nextBtn
                : "border border-ink-300 bg-white"
            }`}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {archiveFlowLabel("save")}
          </button>
        </div>
        <div className={`flex-1 ${nextStep === "report" ? nextBox : ""}`}>
          <button
            type="button"
            disabled={saving || reportBusy}
            onClick={() => void openReport()}
            className={`inline-flex w-full items-center justify-center gap-2 rounded-xl min-h-12 px-5 py-3 font-medium disabled:opacity-50 ${
              nextStep === "report"
                ? nextBtn
                : "bg-accent text-white"
            }`}
          >
            {reportBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {archiveFlowLabel("report")}
          </button>
        </div>
      </div>
    </form>
  );
}
