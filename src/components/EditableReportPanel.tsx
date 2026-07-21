"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  Bold,
  Check,
  ClipboardPaste,
  Home,
  ImagePlus,
  PenLine,
  Pencil,
  Plus,
  Redo2,
  Save,
  Trash2,
  Type,
  Underline,
  Undo2,
  X,
} from "lucide-react";
import type {
  FactCheckVerdict,
  ReportSectionBlock,
  TypedReport,
  VideoRecord,
} from "@/lib/types";
import {
  collectFcMarkers,
  collectSectionFcImages,
  sectionBodyWithMarkers,
  type FcMarker,
} from "@/lib/fc-markers";
import { compressImageFiles, extractImageFilesFromDataTransfer, readImagesFromClipboard } from "@/lib/image-client";
import { uploadDataUrls } from "@/lib/media-upload-client";
import { normalizeImageUrls } from "@/lib/image-urls";
import { isFailedVerdict, verdictBadge } from "@/lib/text-format";
import { TextToImageModal } from "@/components/TextToImageModal";

const TEXT_COLORS = [
  { id: "black", label: "검정", color: "#1a2430" },
  { id: "yellow", label: "노랑", color: "#b45309" },
  { id: "blue", label: "파랑", color: "#1d4ed8" },
  { id: "red", label: "빨강", color: "#b91c1c" },
  { id: "green", label: "녹색", color: "#15803d" },
] as const;

const HIGHLIGHT_COLORS = [
  { id: "yellow", label: "노랑", bg: "#fef08a" },
  { id: "blue", label: "파랑", bg: "#bfdbfe" },
  { id: "red", label: "빨강", bg: "#fecaca" },
  { id: "green", label: "녹색", bg: "#bbf7d0" },
] as const;

const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28] as const;

const HISTORY_LIMIT = 40;
const HISTORY_DEBOUNCE_MS = 450;

function cloneReport(report: TypedReport): TypedReport {
  return JSON.parse(JSON.stringify(report)) as TypedReport;
}

function sectionSnapshot(sec: ReportSectionBlock): string {
  return JSON.stringify(sec);
}

function newSectionId(): string {
  return `sec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function sectionEditKey(sec: ReportSectionBlock, idx: number): string {
  return sec.sectionId ?? `legacy-${idx}`;
}

function applySelectionFontSize(px: number) {
  const sel = window.getSelection();
  if (!sel?.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (range.collapsed) return;
  const span = document.createElement("span");
  span.style.fontSize = `${px}px`;
  try {
    range.surroundContents(span);
  } catch {
    const contents = range.extractContents();
    span.appendChild(contents);
    range.insertNode(span);
  }
  const active = document.activeElement as HTMLElement | null;
  active?.dispatchEvent(new Event("input", { bubbles: true }));
}

export function EditableReportPanel({
  video,
}: {
  video: VideoRecord;
}) {
  const router = useRouter();
  const report = video.report;
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<TypedReport | null>(report);
  const [openFcKey, setOpenFcKey] = useState<string | null>(null);
  const [handwritingFor, setHandwritingFor] = useState<number | null>(null);
  const [textImageFor, setTextImageFor] = useState<number | null>(null);
  const [activeSectionIdx, setActiveSectionIdx] = useState(0);
  const [rebuilding, setRebuilding] = useState(false);
  const [savingSectionIdx, setSavingSectionIdx] = useState<number | null>(null);
  const [savedSections, setSavedSections] = useState<string[]>([]);
  const [sectionSavedFlash, setSectionSavedFlash] = useState<
    Record<number, boolean>
  >({});
  const wasEditingRef = useRef(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const historyPastRef = useRef<TypedReport[]>([]);
  const historyFutureRef = useRef<TypedReport[]>([]);
  const pendingHistoryBaseRef = useRef<TypedReport | null>(null);
  const historyDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [historyUi, setHistoryUi] = useState({ canUndo: false, canRedo: false });

  const syncHistoryUi = useCallback(() => {
    setHistoryUi({
      canUndo: historyPastRef.current.length > 0,
      canRedo: historyFutureRef.current.length > 0,
    });
  }, []);

  const resetHistory = useCallback(() => {
    historyPastRef.current = [];
    historyFutureRef.current = [];
    pendingHistoryBaseRef.current = null;
    if (historyDebounceRef.current) {
      clearTimeout(historyDebounceRef.current);
      historyDebounceRef.current = null;
    }
    syncHistoryUi();
  }, [syncHistoryUi]);

  const pushHistorySnapshot = useCallback(
    (snapshot: TypedReport) => {
      historyPastRef.current = [
        ...historyPastRef.current,
        cloneReport(snapshot),
      ];
      if (historyPastRef.current.length > HISTORY_LIMIT) {
        historyPastRef.current.shift();
      }
      historyFutureRef.current = [];
      syncHistoryUi();
    },
    [syncHistoryUi]
  );

  const flushDebouncedHistory = useCallback(() => {
    if (historyDebounceRef.current) {
      clearTimeout(historyDebounceRef.current);
      historyDebounceRef.current = null;
    }
    if (pendingHistoryBaseRef.current) {
      pushHistorySnapshot(pendingHistoryBaseRef.current);
      pendingHistoryBaseRef.current = null;
    }
  }, [pushHistorySnapshot]);

  const scheduleDebouncedHistory = useCallback(
    (beforeChange: TypedReport) => {
      if (!pendingHistoryBaseRef.current) {
        pendingHistoryBaseRef.current = cloneReport(beforeChange);
      }
      if (historyDebounceRef.current) {
        clearTimeout(historyDebounceRef.current);
      }
      historyDebounceRef.current = setTimeout(() => {
        historyDebounceRef.current = null;
        if (pendingHistoryBaseRef.current) {
          pushHistorySnapshot(pendingHistoryBaseRef.current);
          pendingHistoryBaseRef.current = null;
        }
      }, HISTORY_DEBOUNCE_MS);
    },
    [pushHistorySnapshot]
  );

  const updateDraft = useCallback(
    (
      updater: (prev: TypedReport) => TypedReport,
      opts?: { history?: "immediate" | "debounced" | "none" }
    ) => {
      setDraft((prev) => {
        if (!prev) return prev;
        const mode = opts?.history ?? "immediate";
        if (mode === "immediate") {
          pushHistorySnapshot(prev);
        } else if (mode === "debounced") {
          scheduleDebouncedHistory(prev);
        }
        return updater(prev);
      });
    },
    [pushHistorySnapshot, scheduleDebouncedHistory]
  );

  const undoEdit = useCallback(() => {
    flushDebouncedHistory();
    const past = historyPastRef.current;
    const current = draftRef.current;
    if (!past.length || !current) return;
    (document.activeElement as HTMLElement | null)?.blur?.();
    const previous = past[past.length - 1]!;
    historyPastRef.current = past.slice(0, -1);
    historyFutureRef.current = [
      cloneReport(current),
      ...historyFutureRef.current,
    ];
    setDraft(cloneReport(previous));
    syncHistoryUi();
  }, [flushDebouncedHistory, syncHistoryUi]);

  const redoEdit = useCallback(() => {
    flushDebouncedHistory();
    const future = historyFutureRef.current;
    const current = draftRef.current;
    if (!future.length || !current) return;
    (document.activeElement as HTMLElement | null)?.blur?.();
    const next = future[0]!;
    historyFutureRef.current = future.slice(1);
    historyPastRef.current = [
      ...historyPastRef.current,
      cloneReport(current),
    ];
    setDraft(cloneReport(next));
    syncHistoryUi();
  }, [flushDebouncedHistory, syncHistoryUi]);

  useEffect(() => {
    return () => {
      if (historyDebounceRef.current) {
        clearTimeout(historyDebounceRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!editing) return;
    function onKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        undoEdit();
      } else if (key === "y" || (key === "z" && e.shiftKey)) {
        e.preventDefault();
        redoEdit();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editing, undoEdit, redoEdit]);

  useEffect(() => {
    setDraft(report);
  }, [report]);

  useEffect(() => {
    if (editing && !wasEditingRef.current && report) {
      setSavedSections(report.sections.map(sectionSnapshot));
      setSectionSavedFlash({});
      resetHistory();
    }
    wasEditingRef.current = editing;
  }, [editing, report, resetHistory]);

  useEffect(() => {
    function enterEdit() {
      setEditing(true);
      document.getElementById("report")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }

    function fromStorageOrHash() {
      try {
        const key = `edit-report:${video.id}`;
        if (sessionStorage.getItem(key) === "1") {
          sessionStorage.removeItem(key);
          enterEdit();
          return;
        }
      } catch {
        /* ignore */
      }
      if (
        typeof window !== "undefined" &&
        window.location.hash === "#report-edit"
      ) {
        enterEdit();
      }
    }

    fromStorageOrHash();

    function onCustom(e: Event) {
      const detail = (e as CustomEvent<{ id?: string }>).detail;
      if (detail?.id && detail.id !== video.id) return;
      enterEdit();
    }
    function onHash() {
      if (window.location.hash === "#report-edit") enterEdit();
    }

    window.addEventListener("factcheck:edit-report", onCustom);
    window.addEventListener("hashchange", onHash);
    return () => {
      window.removeEventListener("factcheck:edit-report", onCustom);
      window.removeEventListener("hashchange", onHash);
    };
  }, [video.id]);

  useEffect(() => {
    if (!video.report || video.report.format === "general_v5") return;
    let cancelled = false;
    (async () => {
      setRebuilding(true);
      try {
        const res = await fetch(`/api/videos/${video.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rebuild: true }),
        });
        const data = (await res.json()) as { video?: VideoRecord };
        if (!cancelled && data.video?.report) {
          setDraft(data.video.report);
          router.refresh();
        }
      } finally {
        if (!cancelled) setRebuilding(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [video.id, video.report, router]);

  const markers = useMemo(
    () => (draft ? collectFcMarkers(draft) : []),
    [draft]
  );

  const fcByItem = useMemo(
    () =>
      new Map(
        (draft?.factChecks ?? [])
          .filter((f) => f.itemId)
          .map((f) => [f.itemId!, f])
      ),
    [draft]
  );

  const openMarker = markers.find((m) => m.key === openFcKey) ?? null;

  if (!report || !draft) return null;

  function isSectionDirty(idx: number): boolean {
    const sec = draft?.sections[idx];
    if (!sec) return false;
    if (idx >= savedSections.length) return true;
    return sectionSnapshot(sec) !== savedSections[idx];
  }

  async function persistReport(opts?: { exit?: boolean; sectionIdx?: number }) {
    if (!draft) return;
    flushDebouncedHistory();
    const sectionIdx = opts?.sectionIdx;
    if (sectionIdx !== undefined) {
      setSavingSectionIdx(sectionIdx);
    } else {
      setSaving(true);
    }
    try {
      const res = await fetch(`/api/videos/${video.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updateReport: draft }),
      });
      const data = (await res.json()) as { error?: string; video?: VideoRecord };
      if (!res.ok) throw new Error(data.error || "저장 실패");
      const saved = data.video?.report;
      if (saved) {
        setDraft(saved);
        if (sectionIdx !== undefined) {
          const snap = saved.sections[sectionIdx];
          if (snap) {
            setSavedSections((prev) => {
              const next = [...prev];
              next[sectionIdx] = sectionSnapshot(snap);
              return next;
            });
            setSectionSavedFlash((prev) => ({ ...prev, [sectionIdx]: true }));
            window.setTimeout(() => {
              setSectionSavedFlash((prev) => ({
                ...prev,
                [sectionIdx]: false,
              }));
            }, 2000);
          }
        } else {
          setSavedSections(saved.sections.map(sectionSnapshot));
        }
      }
      if (opts?.exit) {
        setEditing(false);
        setOpenFcKey(null);
        setActiveSectionIdx(0);
        resetHistory();
      }
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "저장 실패");
    } finally {
      if (sectionIdx !== undefined) {
        setSavingSectionIdx(null);
      } else {
        setSaving(false);
      }
    }
  }

  async function saveReport() {
    await persistReport({ exit: true });
  }

  async function saveSection(idx: number) {
    await persistReport({ sectionIdx: idx });
  }

  function cancelEdit() {
    flushDebouncedHistory();
    setDraft(report);
    setEditing(false);
    setOpenFcKey(null);
    setActiveSectionIdx(0);
    setSavedSections([]);
    setSectionSavedFlash({});
    resetHistory();
  }

  function patchSection(
    idx: number,
    patch: Partial<ReportSectionBlock>,
    history: "immediate" | "debounced" | "none" = "immediate"
  ) {
    updateDraft((prev) => {
      const sections = [...prev.sections];
      sections[idx] = { ...sections[idx], ...patch };
      return { ...prev, sections };
    }, { history });
  }

  function deleteSection(idx: number) {
    const heading = draft?.sections[idx]?.heading || "이 섹션";
    if (!confirm(`「${heading}」을(를) 삭제할까요?`)) return;
    updateDraft((prev) => ({
      ...prev,
      sections: prev.sections.filter((_, i) => i !== idx),
    }));
    setSavedSections((prev) => prev.filter((_, i) => i !== idx));
  }

  function addSection() {
    const sectionId = newSectionId();
    updateDraft((prev) => {
      const newIdx = prev.sections.length;
      queueMicrotask(() => {
        setActiveSectionIdx(newIdx);
        const el = document.getElementById(`sec-body-${sectionId}`);
        el?.focus();
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      return {
        ...prev,
        sections: [
          ...prev.sections,
          {
            sectionId,
            heading: "새 소주제",
            body: "<p><br></p>",
            rich: true,
            entries: [],
          },
        ],
      };
    });
  }

  function deleteEntry(sectionIdx: number, entryIdx: number) {
    if (!confirm("이 팩트체크 연결을 보고서에서 제거할까요?")) return;
    updateDraft((prev) => {
      const sections = [...prev.sections];
      const sec = sections[sectionIdx];
      const entries = (sec.entries ?? []).filter((_, i) => i !== entryIdx);
      sections[sectionIdx] = { ...sec, entries };
      return { ...prev, sections };
    });
    setOpenFcKey(null);
  }

  async function addImagesToSection(idx: number, files: File[]) {
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    if (!imageFiles.length) return;
    try {
      const dataUrls = await compressImageFiles(imageFiles);
      if (!dataUrls.length) return;
      const uploaded = await uploadDataUrls(
        dataUrls,
        `videos/${video.id}/report`
      );
      updateDraft((prev) => {
        const sections = [...prev.sections];
        const sec = sections[idx];
        const images = [...(sec.images ?? []), ...uploaded];
        sections[idx] = { ...sec, images };
        return { ...prev, sections };
      });
    } catch (e) {
      alert(
        e instanceof Error ? e.message : "이미지 추가에 실패했습니다."
      );
    }
  }

  function handleSectionPaste(idx: number, e: React.ClipboardEvent) {
    if (!editing) return;
    const files = extractImageFilesFromDataTransfer(e.clipboardData);
    if (!files.length) return;
    e.preventDefault();
    void addImagesToSection(idx, files);
  }

  async function pasteImagesToSection(idx: number) {
    if (!editing) return;
    try {
      const files = await readImagesFromClipboard();
      if (files.length) {
        await addImagesToSection(idx, files);
        return;
      }
    } catch {
      /* fall through */
    }
    const el = document.getElementById(`sec-paste-${idx}`) as HTMLTextAreaElement | null;
    el?.focus();
    alert(
      "먼저 사진 앱에서 이미지를 복사한 뒤, 다시 「붙여넣기」를 누르거나 입력칸을 길게 눌러 붙여넣기하세요."
    );
  }

  async function insertHandwriting(idx: number, dataUrl: string) {
    try {
      const [url] = await uploadDataUrls(
        [dataUrl],
        `videos/${video.id}/report`
      );
      updateDraft((prev) => {
        const sections = [...prev.sections];
        const sec = sections[idx];
        const images = [...(sec.images ?? []), url];
        sections[idx] = { ...sec, images };
        return { ...prev, sections };
      });
    } catch (e) {
      alert(e instanceof Error ? e.message : "손글씨 이미지 저장 실패");
    } finally {
      setHandwritingFor(null);
    }
  }

  async function insertTextImage(idx: number, dataUrl: string) {
    try {
      const [url] = await uploadDataUrls(
        [dataUrl],
        `videos/${video.id}/report`
      );
      updateDraft((prev) => {
        const sections = [...prev.sections];
        const images = [...(sections[idx].images ?? []), url];
        sections[idx] = { ...sections[idx], images };
        return { ...prev, sections };
      });
    } catch (e) {
      alert(e instanceof Error ? e.message : "텍스트 이미지 저장 실패");
    } finally {
      setTextImageFor(null);
    }
  }

  function onBodyClick(e: React.MouseEvent) {
    const t = (e.target as HTMLElement).closest(".fc-badge") as HTMLElement | null;
    if (!t) return;
    e.preventDefault();
    const key = t.getAttribute("data-fc-key");
    if (!key) return;
    setOpenFcKey((prev) => (prev === key ? null : key));
  }

  return (
    <>
      <section
        id="report"
        className="rounded-2xl border border-ink-200 bg-white/80 p-4 sm:p-5 space-y-5 scroll-mt-20"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
          <h2 className="font-display text-lg sm:text-xl">
            3. 보고서
          </h2>
          <div className="flex flex-wrap gap-2">
            <a
              href="/"
              className="inline-flex items-center gap-1.5 min-h-10 rounded-lg border border-ink-200 bg-white px-3 text-sm font-medium hover:border-accent"
            >
              <Home className="h-4 w-4" />
              초기 화면
            </a>
            {editing ? (
              <>
                <button
                  type="button"
                  onClick={cancelEdit}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 min-h-10 rounded-lg border border-ink-200 bg-white px-3 text-sm font-medium hover:border-ink-400"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={() => void saveReport()}
                  disabled={saving || rebuilding || savingSectionIdx !== null}
                  className="inline-flex items-center gap-1.5 min-h-10 rounded-lg border border-accent/40 bg-accent text-white px-3 text-sm font-medium hover:opacity-95"
                >
                  <Save className="h-4 w-4" />
                  {saving ? "저장 중…" : "전체 저장 후 닫기"}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setEditing(true)}
                disabled={saving || rebuilding}
                className="inline-flex items-center gap-1.5 min-h-10 rounded-lg border border-ink-200 bg-white px-3 text-sm font-medium hover:border-accent"
              >
                <Pencil className="h-4 w-4" />
                수정
              </button>
            )}
          </div>
        </div>

        {rebuilding && (
          <p className="text-sm text-ink-500 print:hidden">
            일반 보고서 형식으로 갱신 중…
          </p>
        )}

        {/* 인쇄·PDF용 보고서 표지 메타 */}
        <div className="print-only space-y-1 mb-6 pb-4 border-b border-ink-200">
          <h1 className="font-display text-xl text-ink-900">
            유튜브 요약 · 팩트체크 보고서
          </h1>
          <p className="text-sm">제목 · {draft.meta.title}</p>
          <p className="text-sm">채널 · {draft.meta.channel}</p>
          <p className="text-sm break-all">링크 · {draft.meta.url}</p>
          <p className="text-sm">작성일 · {draft.meta.writtenAt}</p>
        </div>

        {editing && (
          <p className="text-xs text-ink-500 print:hidden rounded-lg bg-ink-50 border border-ink-100 px-3 py-2">
            단락마다 「이 단락 저장」으로 저장하거나, 상단 「전체 저장 후 닫기」로
            편집을 마칠 수 있습니다. 되돌리기는 Ctrl+Z · 다시 실행은 Ctrl+Y 입니다.
          </p>
        )}

        <div className="rounded-xl bg-ink-50 border border-ink-100 p-3 text-sm space-y-1 print:hidden">
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

        {editing ? (
          <div className="rounded-xl border border-ink-200 bg-white print:hidden">
            <div className="sticky top-[calc(env(safe-area-inset-top,0px)+4.25rem)] z-30 border-b border-ink-100 bg-white/95 backdrop-blur-md px-3 py-2 space-y-2 shadow-sm">
              <p className="text-xs text-ink-500">
                편집 중 ·{" "}
                <span className="font-medium text-ink-800">
                  {draft.sections[activeSectionIdx]?.heading || "섹션"}
                </span>
              </p>
              <FormatToolbar
                canUndo={historyUi.canUndo}
                canRedo={historyUi.canRedo}
                onUndo={undoEdit}
                onRedo={redoEdit}
                onFontSize={applySelectionFontSize}
                onBold={() => document.execCommand("bold")}
                onUnderline={() => document.execCommand("underline")}
                onColor={(c) => document.execCommand("foreColor", false, c)}
                onHighlight={(c) =>
                  document.execCommand("hiliteColor", false, c)
                }
                onImage={() => {
                  const input = document.getElementById(
                    `sec-img-${activeSectionIdx}`
                  ) as HTMLInputElement | null;
                  input?.click();
                }}
                onPasteImage={() => void pasteImagesToSection(activeSectionIdx)}
                onTextImage={() => setTextImageFor(activeSectionIdx)}
                onHandwriting={() => setHandwritingFor(activeSectionIdx)}
              />
            </div>

            <div className="divide-y divide-ink-100">
              {draft.sections.map((sec, idx) => {
                const sectionMarkers = markers.filter(
                  (m) => m.sectionIdx === idx
                );
                const sectionImages = collectSectionImages(sec);
                const dirty = isSectionDirty(idx);
                const savingThis = savingSectionIdx === idx;
                const savedFlash = sectionSavedFlash[idx];

                return (
                  <div
                    key={sectionEditKey(sec, idx)}
                    className={`p-4 sm:p-5 space-y-3 transition-colors ${
                      activeSectionIdx === idx ? "bg-accent-muted/20" : ""
                    }`}
                    tabIndex={0}
                    onPaste={(e) => handleSectionPaste(idx, e)}
                    onFocusCapture={() => setActiveSectionIdx(idx)}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        value={sec.heading}
                        onChange={(e) =>
                          patchSection(
                            idx,
                            { heading: e.target.value },
                            "debounced"
                          )
                        }
                        onFocus={() => setActiveSectionIdx(idx)}
                        className="flex-1 min-w-[12rem] rounded-lg border border-ink-200 px-3 py-2 text-lg font-medium text-accent outline-none focus:border-accent"
                      />
                      {dirty && !savingThis && !savedFlash && (
                        <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1">
                          수정됨
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => void saveSection(idx)}
                        disabled={
                          saving ||
                          savingSectionIdx !== null ||
                          !dirty
                        }
                        className="inline-flex items-center gap-1 min-h-10 rounded-lg border border-accent/40 bg-white px-3 text-sm font-medium text-accent hover:bg-accent-muted/30 disabled:opacity-50"
                      >
                        {savedFlash ? (
                          <Check className="h-4 w-4 text-verify-true" />
                        ) : (
                          <Save className="h-4 w-4" />
                        )}
                        {savingThis
                          ? "저장 중…"
                          : savedFlash
                            ? "저장됨"
                            : "이 단락 저장"}
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteSection(idx)}
                        className="inline-flex items-center gap-1 min-h-10 rounded-lg border border-verify-false/40 bg-verify-false/5 px-3 text-sm text-verify-false"
                      >
                        <Trash2 className="h-4 w-4" />
                        삭제
                      </button>
                    </div>

                    <input
                      id={`sec-img-${idx}`}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        void addImagesToSection(
                          idx,
                          Array.from(e.target.files ?? [])
                        );
                        e.target.value = "";
                      }}
                    />

                    <textarea
                      id={`sec-paste-${idx}`}
                      readOnly
                      aria-label="이미지 붙여넣기"
                      className="sr-only"
                      onPaste={(e) => handleSectionPaste(idx, e)}
                    />

                    <RichBody
                      id={sec.sectionId ? `sec-body-${sec.sectionId}` : undefined}
                      html={sec.body}
                      onFocus={() => setActiveSectionIdx(idx)}
                      onChange={(html) =>
                        patchSection(
                          idx,
                          { body: html, rich: true },
                          "debounced"
                        )
                      }
                    />

                    {sectionImages.length > 0 && (
                      <div className="space-y-2 pt-1">
                        {sectionImages.map((src) => {
                          const imgIdx = (sec.images ?? []).indexOf(src);
                          const isAttached = imgIdx >= 0;
                          const isHero = sec.imageUrl === src;
                          return (
                            <div
                              key={src.slice(0, 64)}
                              className="relative overflow-hidden rounded-xl border border-ink-100"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={src}
                                alt=""
                                className="w-full max-h-72 object-contain bg-white"
                              />
                              {(isAttached || isHero) && (
                                <button
                                  type="button"
                                  className="absolute top-2 right-2 rounded-lg bg-white/90 border border-ink-200 p-1.5"
                                  onClick={() => {
                                    if (isAttached) {
                                      patchSection(idx, {
                                        images: sec.images?.filter(
                                          (_, j) => j !== imgIdx
                                        ),
                                      });
                                    } else if (isHero) {
                                      patchSection(idx, { imageUrl: undefined });
                                    }
                                  }}
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {sectionMarkers.length > 0 && (
                      <div className="rounded-xl border border-dashed border-ink-200 bg-ink-50/80 p-3 space-y-2">
                        <p className="text-xs font-medium text-ink-500">
                          연결된 팩트체크
                        </p>
                        {sectionMarkers.map((m) => (
                          <div
                            key={m.key}
                            className="flex flex-wrap items-start justify-between gap-2 text-sm"
                          >
                            <p className="flex-1 min-w-0">
                              <span className="fc-badge mr-1.5">F{m.n}</span>
                              {m.entry.text}
                            </p>
                            <button
                              type="button"
                              onClick={() => deleteEntry(idx, m.entryIdx)}
                              className="inline-flex items-center gap-1 text-xs text-verify-false border border-verify-false/30 rounded-lg px-2 py-1"
                            >
                              <Trash2 className="h-3 w-3" />
                              연결 제거
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="border-t border-ink-100 p-3">
              <button
                type="button"
                onClick={addSection}
                className="inline-flex items-center gap-1.5 min-h-11 w-full justify-center rounded-xl border border-dashed border-ink-300 bg-ink-50 text-sm font-medium text-ink-700 hover:border-accent"
              >
                <Plus className="h-4 w-4" />
                섹션 추가
              </button>
            </div>
          </div>
        ) : (
          draft.sections.map((sec, idx) => {
            const { html: markedHtml, unmatched } = sectionBodyWithMarkers(
              sec,
              idx,
              markers
            );
            const fcImages = collectSectionFcImages(sec, fcByItem);
            const sectionOwn = new Set(collectSectionImages(sec));
            const reportFcImages = fcImages.filter((u) => !sectionOwn.has(u));
            const sectionImages = collectSectionImages(sec);

            return (
              <div
                key={`${sec.heading}-${idx}`}
                className="space-y-3 report-section"
              >
                <h3 className="font-medium text-accent text-lg">{sec.heading}</h3>

                {sec.body && (
                  <div
                    className="report-body text-sm text-ink-800 leading-relaxed space-y-2"
                    dangerouslySetInnerHTML={{ __html: markedHtml }}
                    onClick={onBodyClick}
                  />
                )}

                {sectionImages.length > 0 && (
                  <div className="space-y-2">
                    {sectionImages.map((src) => (
                      <div
                        key={src.slice(0, 64)}
                        className="overflow-hidden rounded-xl border border-ink-100 bg-white"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={src}
                          alt=""
                          className="w-full max-h-72 object-contain bg-white"
                        />
                      </div>
                    ))}
                  </div>
                )}

                {unmatched.length > 0 && (
                  <ul className="space-y-1.5 print:hidden">
                    {unmatched.map((m) => (
                      <li key={m.key} className="text-sm text-ink-800">
                        <button
                          type="button"
                          className="inline-flex items-start gap-2 text-left hover:text-accent"
                          onClick={() =>
                            setOpenFcKey((prev) =>
                              prev === m.key ? null : m.key
                            )
                          }
                        >
                          <span className="fc-badge shrink-0 mt-0.5" aria-hidden>
                            F{m.n}
                          </span>
                          <u className="leading-relaxed decoration-accent/70 underline-offset-2">
                            {m.entry.text}
                          </u>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {unmatched.length > 0 && (
                  <ul className="hidden print:block space-y-1 text-sm">
                    {unmatched.map((m) => (
                      <li key={`print-${m.key}`}>
                        <u>{m.entry.text}</u>{" "}
                        <span className="fc-badge-print">F{m.n}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {reportFcImages.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs text-ink-500 print:hidden">관련 이미지</p>
                    {reportFcImages.map((src) => (
                      <div
                        key={src.slice(0, 64)}
                        className="overflow-hidden rounded-xl border border-ink-100 bg-white"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={src}
                          alt=""
                          className="w-full max-h-72 object-contain bg-white"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}

        {handwritingFor !== null && (
          <HandwritingModal
            onCancel={() => setHandwritingFor(null)}
            onInsert={(dataUrl) => insertHandwriting(handwritingFor, dataUrl)}
          />
        )}

        {textImageFor !== null && (
          <TextToImageModal
            initialText={
              draft.sections[textImageFor]?.body
                ? draft.sections[textImageFor].body
                    .replace(/<br\s*\/?>/gi, "\n")
                    .replace(/<[^>]+>/g, "")
                    .replace(/&nbsp;/g, " ")
                    .trim()
                    .slice(0, 800)
                : ""
            }
            onCancel={() => setTextImageFor(null)}
            onInsert={(dataUrl) => insertTextImage(textImageFor, dataUrl)}
          />
        )}

        {/* 화면: F 클릭 시 상세 팝업 */}
        {openMarker && !editing && (
          <FcDetailModal
            marker={openMarker}
            fc={
              openMarker.entry.itemId
                ? fcByItem.get(openMarker.entry.itemId)
                : undefined
            }
            onClose={() => setOpenFcKey(null)}
          />
        )}
      </section>

      {/* 인쇄·PDF용 부록 — 화면에서는 숨김 */}
      <FactCheckAppendix
        markers={markers}
        draft={draft}
        fcByItem={fcByItem}
      />
    </>
  );
}

function FcDetailModal({
  marker,
  fc,
  onClose,
}: {
  marker: FcMarker;
  fc:
    | {
        checkGuide: string;
        verdict?: FactCheckVerdict;
        answerImageUrl?: string;
        answerImageUrls?: string[];
        answerParts?: NonNullable<TypedReport["factChecks"][0]["answerParts"]>;
      }
    | undefined;
  onClose: () => void;
}) {
  const verdict = (fc?.verdict ?? "pending") as FactCheckVerdict;
  const badge = verdictBadge(verdict);
  const failed = isFailedVerdict(verdict);
  const parts =
    marker.entry.answerParts?.length
      ? marker.entry.answerParts
      : fc?.answerParts?.length
        ? fc.answerParts
        : null;
  const flatFallback = Array.from(
    new Set(
      [
        ...normalizeImageUrls(
          marker.entry.answerImageUrl,
          marker.entry.answerImageUrls
        ),
        ...normalizeImageUrls(fc?.answerImageUrl, fc?.answerImageUrls),
      ].filter((u) => !/i\.ytimg\.com|ytimg\.com\/vi\//i.test(u))
    )
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink-900/50 p-3 print:hidden"
      role="dialog"
      aria-modal="true"
      aria-label={`팩트체크 F${marker.n}`}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[85vh] overflow-auto rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center justify-between gap-2 px-4 py-3 border-b border-ink-100 bg-white">
          <div className="flex items-center gap-2 min-w-0">
            <span className="fc-badge">F{marker.n}</span>
            <span
              className={`text-sm font-medium truncate ${
                failed
                  ? "text-verify-false"
                  : badge.ok
                    ? "text-verify-true"
                    : "text-ink-700"
              }`}
            >
              {badge.mark} {badge.label}
            </span>
          </div>
          <button type="button" onClick={onClose} className="p-1 shrink-0">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-4 space-y-3 text-sm">
          <p className="font-medium text-ink-900 leading-snug">
            <u className="decoration-accent/70 underline-offset-2">
              {marker.entry.text}
            </u>
          </p>

          {parts?.length ? (
            <div className="space-y-3">
              {parts.map((part) => (
                <div
                  key={part.number}
                  className="rounded-lg border border-ink-100 bg-ink-50/80 p-2.5 space-y-2"
                >
                  <p className="text-ink-800 leading-relaxed whitespace-pre-wrap">
                    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-ink-900 text-[10px] font-bold text-white mr-1.5 align-middle">
                      {part.number}
                    </span>
                    {part.text}
                  </p>
                  {(part.imageUrls ?? [])
                    .filter(
                      (u) => !/i\.ytimg\.com|ytimg\.com\/vi\//i.test(u)
                    )
                    .map((src) => (
                      <div
                        key={src.slice(0, 48)}
                        className="overflow-hidden rounded-lg border border-ink-100 bg-white"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={src}
                          alt={`${part.number}번 이미지`}
                          className="w-full max-h-64 object-contain bg-ink-50"
                        />
                      </div>
                    ))}
                </div>
              ))}
            </div>
          ) : (
            <>
              {(fc?.checkGuide || marker.entry.html) && (
                <div className="rounded-lg bg-ink-50 border border-ink-100 p-3 text-ink-700 whitespace-pre-wrap leading-relaxed">
                  {failed && (
                    <p className="text-verify-false font-bold mb-2">
                      ✗ 사실과 다름
                    </p>
                  )}
                  {fc?.checkGuide ||
                    marker.entry.html?.replace(/<[^>]+>/g, "") ||
                    "저장된 팩트체크 세부 내용이 없습니다."}
                </div>
              )}
              {flatFallback.map((src) => (
                <div
                  key={src.slice(0, 48)}
                  className="overflow-hidden rounded-lg border border-ink-100"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={src}
                    alt=""
                    className="w-full max-h-64 object-contain bg-ink-50"
                  />
                </div>
              ))}
            </>
          )}

          {!parts?.length && !fc?.checkGuide && !flatFallback.length && (
            <p className="text-ink-500">
              저장된 팩트체크 세부 내용이 없습니다.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function FactCheckAppendix({
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

function FormatToolbar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onFontSize,
  onBold,
  onUnderline,
  onColor,
  onHighlight,
  onImage,
  onPasteImage,
  onTextImage,
  onHandwriting,
}: {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onFontSize: (px: number) => void;
  onBold: () => void;
  onUnderline: () => void;
  onColor: (c: string) => void;
  onHighlight: (c: string) => void;
  onImage: () => void;
  onPasteImage: () => void;
  onTextImage: () => void;
  onHandwriting: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5 items-center rounded-xl border border-ink-200 bg-ink-50 p-2 print:hidden">
      <ToolBtn
        onClick={onUndo}
        title="되돌리기 (Ctrl+Z)"
        disabled={!canUndo}
      >
        <Undo2 className="h-4 w-4" />
        <span className="text-xs">되돌리기</span>
      </ToolBtn>
      <ToolBtn
        onClick={onRedo}
        title="다시 실행 (Ctrl+Y)"
        disabled={!canRedo}
      >
        <Redo2 className="h-4 w-4" />
        <span className="text-xs">다시 실행</span>
      </ToolBtn>
      <span className="w-px h-6 bg-ink-200 mx-0.5" aria-hidden />
      <ToolBtn onClick={onBold} title="굵게">
        <Bold className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn onClick={onUnderline} title="밑줄">
        <Underline className="h-4 w-4" />
      </ToolBtn>
      <label className="inline-flex items-center gap-1 text-xs text-ink-500">
        크기
        <select
          className="min-h-8 rounded-lg border border-ink-200 bg-white px-2 text-xs text-ink-800"
          defaultValue=""
          onChange={(e) => {
            const px = Number(e.target.value);
            if (px) onFontSize(px);
            e.currentTarget.value = "";
          }}
          title="글자 크기"
        >
          <option value="" disabled>
            선택
          </option>
          {FONT_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}px
            </option>
          ))}
        </select>
      </label>
      <span className="text-xs text-ink-400 px-1">글자</span>
      {TEXT_COLORS.map((c) => (
        <button
          key={c.id}
          type="button"
          title={c.label}
          onClick={() => onColor(c.color)}
          className={`h-8 w-8 rounded-lg border shadow-sm ${
            c.id === "black" ? "border-ink-300" : "border-ink-200"
          }`}
          style={{ background: c.color }}
        />
      ))}
      <span className="text-xs text-ink-400 px-1">형광</span>
      {HIGHLIGHT_COLORS.map((c) => (
        <button
          key={`hl-${c.id}`}
          type="button"
          title={`${c.label} 형광`}
          onClick={() => onHighlight(c.bg)}
          className="h-8 w-8 rounded-lg border border-ink-200"
          style={{ background: c.bg }}
        />
      ))}
      <ToolBtn onClick={onImage} title="이미지 추가">
        <ImagePlus className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn onClick={onPasteImage} title="클립보드에서 붙여넣기 (아이폰)">
        <ClipboardPaste className="h-4 w-4" />
        <span className="text-xs">붙여넣기</span>
      </ToolBtn>
      <ToolBtn onClick={onTextImage} title="텍스트를 이미지로">
        <Type className="h-4 w-4" />
        <span className="text-xs">텍스트→이미지</span>
      </ToolBtn>
      <ToolBtn onClick={onHandwriting} title="손글씨">
        <PenLine className="h-4 w-4" />
        <span className="text-xs">손글씨</span>
      </ToolBtn>
    </div>
  );
}

function ToolBtn({
  children,
  onClick,
  title,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  title: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 min-h-8 rounded-lg border border-ink-200 bg-white px-2 text-ink-700 hover:border-accent disabled:opacity-40 disabled:pointer-events-none"
    >
      {children}
    </button>
  );
}

function collectSectionImages(sec: ReportSectionBlock): string[] {
  return Array.from(
    new Set(
      [sec.imageUrl, ...(sec.images ?? [])].filter(Boolean) as string[]
    )
  );
}

function RichBody({
  id,
  html,
  onChange,
  onFocus,
}: {
  id?: string;
  html: string;
  onChange: (html: string) => void;
  onFocus?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const focusedRef = useRef(false);
  const composingRef = useRef(false);

  useEffect(() => {
    if (focusedRef.current || composingRef.current) return;
    if (ref.current && ref.current.innerHTML !== html) {
      ref.current.innerHTML = html || "<p><br></p>";
    }
  }, [html]);

  const syncChange = () => {
    if (composingRef.current) return;
    onChange(ref.current?.innerHTML ?? "");
  };

  return (
    <div
      id={id}
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      className="report-body min-h-[120px] w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 leading-relaxed"
      onFocus={() => {
        focusedRef.current = true;
        onFocus?.();
      }}
      onBlur={() => {
        focusedRef.current = false;
        syncChange();
      }}
      onCompositionStart={() => {
        composingRef.current = true;
      }}
      onCompositionEnd={() => {
        composingRef.current = false;
        syncChange();
      }}
      onInput={syncChange}
    />
  );
}

function HandwritingModal({
  onCancel,
  onInsert,
}: {
  onCancel: () => void;
  onInsert: (dataUrl: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [color, setColor] = useState("#1a2430");
  const [size, setSize] = useState(3);

  const pos = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const r = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * canvas.width,
      y: ((e.clientY - r.top) / r.height) * canvas.height,
    };
  }, []);

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    drawing.current = true;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const p = pos(e);
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }

  function end() {
    drawing.current = false;
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  useEffect(() => {
    clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink-900/50 p-3 print:hidden">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-ink-100">
          <p className="font-medium text-ink-900">손글씨 (굿노트 스타일)</p>
          <button type="button" onClick={onCancel} className="p-1">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-3 space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            {["#1a2430", "#b91c1c", "#1d4ed8", "#15803d"].map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`h-8 w-8 rounded-full border-2 ${
                  color === c ? "border-accent" : "border-ink-200"
                }`}
                style={{ background: c }}
              />
            ))}
            <label className="text-xs text-ink-500 flex items-center gap-2">
              굵기
              <input
                type="range"
                min={1}
                max={12}
                value={size}
                onChange={(e) => setSize(Number(e.target.value))}
              />
            </label>
            <button
              type="button"
              onClick={clear}
              className="text-xs rounded-lg border border-ink-200 px-2 py-1"
            >
              지우기
            </button>
          </div>
          <canvas
            ref={canvasRef}
            width={640}
            height={360}
            className="w-full touch-none rounded-xl border border-ink-200 bg-white cursor-crosshair"
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={end}
            onPointerLeave={end}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 min-h-11 rounded-xl border border-ink-200"
            >
              취소
            </button>
            <button
              type="button"
              onClick={() => {
                const url = canvasRef.current?.toDataURL("image/png");
                if (url) onInsert(url);
              }}
              className="flex-1 min-h-11 rounded-xl bg-ink-900 text-white font-medium"
            >
              보고서에 넣기
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
