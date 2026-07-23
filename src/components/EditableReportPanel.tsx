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
  ClipboardCopy,
  ClipboardPaste,
  Home,
  ImagePlus,
  Link2,
  Loader2,
  Minus,
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
  FactCheckResult,
  FactCheckVerdict,
  ReportSectionBlock,
  SummaryItem,
  TypedReport,
  VideoRecord,
} from "@/lib/types";
import { normalizeAiAnswer, isFailedVerdict, verdictBadge } from "@/lib/text-format";
import { verdictLabel } from "@/lib/labels";
import {
  collectFcMarkers,
  collectSectionFcImages,
  sectionBodyWithMarkers,
  type FcMarker,
} from "@/lib/fc-markers";
import { compressImageFiles, extractImageFilesFromDataTransfer, readImagesFromClipboard } from "@/lib/image-client";
import { uploadDataUrls } from "@/lib/media-upload-client";
import { normalizeImageUrls, splitPrimaryImage } from "@/lib/image-urls";
import {
  applyFontSizeInEditor,
  containReportBodyLayout,
  DEFAULT_REPORT_FONT_PX,
  findReportBodyEditor,
  getBlockAtCursor,
  parseFontSizeToPx,
  rangeHasVisibleText,
  resolveFontSizeTarget,
  sanitizePastedHtml,
  selectBlockContents,
  wrapPlainPasteText,
} from "@/lib/report-editor-format";
import { TextToImageModal } from "@/components/TextToImageModal";
import {
  ReportFactCheckToolbox,
  type ReportFcRow,
} from "@/components/ReportFactCheckToolbox";
import { resolveAnswerParts } from "@/lib/answer-parts";

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

function stepFontSize(current: number, delta: number): number {
  const sizes = [...FONT_SIZES];
  let idx = sizes.findIndex((s) => s >= current);
  if (idx === -1) idx = sizes.length - 1;
  const next = Math.min(sizes.length - 1, Math.max(0, idx + delta));
  return sizes[next]!;
}

export function EditableReportPanel({
  video,
}: {
  video: VideoRecord;
}) {
  const router = useRouter();
  const report = video.report;
  const [localVideo, setLocalVideo] = useState(video);
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
  const savedSelectionRef = useRef<Range | null>(null);
  const [historyUi, setHistoryUi] = useState({ canUndo: false, canRedo: false });
  const [formatHint, setFormatHint] = useState<string | null>(null);
  const [formatTarget, setFormatTarget] = useState<
    "none" | "selection" | "paragraph"
  >("none");
  const formatHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    const serverTs = new Date(video.updatedAt).getTime();
    const localTs = new Date(localVideo.updatedAt).getTime();
    if (serverTs >= localTs) {
      setLocalVideo(video);
    }
  }, [video, localVideo.updatedAt]);

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

  const saveEditorSelection = useCallback(() => {
    const sel = window.getSelection();
    if (!sel?.rangeCount) {
      // 툴바 클릭 등으로 선택이 비어도 저장된 Range는 유지
      return;
    }
    const range = sel.getRangeAt(0);
    const editor = findReportBodyEditor(range.commonAncestorContainer);
    if (!editor) {
      // 본문 밖(셀렉트·버튼)으로 포커스가 가도 이전 선택 유지
      return;
    }

    if (!range.collapsed && rangeHasVisibleText(range)) {
      savedSelectionRef.current = range.cloneRange();
      setFormatTarget("selection");
      return;
    }

    const block = getBlockAtCursor(editor);
    if (block?.textContent?.replace(/\u00a0/g, " ").trim()) {
      // 커서가 문단에만 있을 때도 문단 Range를 저장해 크기 적용 가능하게
      const blockRange = selectBlockContents(block);
      if (blockRange) {
        savedSelectionRef.current = blockRange;
      }
      setFormatTarget("paragraph");
      return;
    }
    setFormatTarget("none");
  }, []);

  const showFormatHint = useCallback((hint: string) => {
    setFormatHint(hint);
    if (formatHintTimerRef.current) {
      clearTimeout(formatHintTimerRef.current);
    }
    formatHintTimerRef.current = setTimeout(() => {
      setFormatHint(null);
      formatHintTimerRef.current = null;
    }, 2800);
  }, []);

  const applyFontSize = useCallback(
    (px: number) => {
      const editors = document.querySelectorAll<HTMLElement>(
        "#report .report-body[contenteditable]"
      );
      let editor =
        focusActiveBodyEditor() ||
        (window.getSelection() &&
          findReportBodyEditor(window.getSelection()!.anchorNode)) ||
        null;

      // 저장된 선택이 어느 본문에 속하는지 우선
      const saved = savedSelectionRef.current;
      if (saved) {
        const fromSaved = findReportBodyEditor(saved.commonAncestorContainer);
        if (fromSaved) editor = fromSaved;
      }
      if (!editor) {
        editor =
          document.querySelector<HTMLElement>(
            `#sec-body-${draftRef.current?.sections[activeSectionIdx]?.sectionId ?? ""}`
          ) ||
          editors[activeSectionIdx] ||
          editors[0] ||
          null;
      }

      if (!editor) {
        showFormatHint("본문 편집 칸을 먼저 클릭해 주세요.");
        return;
      }

      // RichBody가 blur 상태로 html을 덮어쓰지 않도록 포커스 유지
      editor.focus();

      const result = applyFontSizeInEditor(
        editor,
        px,
        savedSelectionRef.current
      );
      if (!result.ok) {
        showFormatHint(result.hint);
        return;
      }

      const html = result.editor.innerHTML;
      // 어느 섹션인지 찾기
      let idx = activeSectionIdx;
      editors.forEach((el, i) => {
        if (el === result.editor) idx = i;
      });
      const id = result.editor.id?.replace(/^sec-body-/, "");
      if (id) {
        const found = draftRef.current?.sections.findIndex(
          (s) => s.sectionId === id
        );
        if (found !== undefined && found >= 0) idx = found;
      }

      patchSection(idx, { body: html, rich: true }, "immediate");
      showFormatHint(
        result.mode === "paragraph"
          ? `${px}px — 현재 문단 전체에 적용했습니다.`
          : `${px}px — 선택한 글자에 적용했습니다.`
      );
      saveEditorSelection();
    },
    [showFormatHint, saveEditorSelection, activeSectionIdx]
  );

  const stepActiveFontSize = useCallback(
    (delta: number) => {
      const editor =
        focusActiveBodyEditor() ||
        (window.getSelection() &&
          findReportBodyEditor(window.getSelection()!.anchorNode));
      if (!editor) {
        showFormatHint("본문 편집 칸을 먼저 클릭해 주세요.");
        return;
      }
      const target = resolveFontSizeTarget(editor, savedSelectionRef.current);
      if (!target) {
        showFormatHint("크기를 조절할 글자를 선택하거나 문단 안에 커서를 두세요.");
        return;
      }
      const node = target.range.startContainer;
      const el =
        node.nodeType === Node.TEXT_NODE
          ? node.parentElement
          : (node as HTMLElement);
      const current = el
        ? parseFontSizeToPx(window.getComputedStyle(el).fontSize) ??
          DEFAULT_REPORT_FONT_PX
        : DEFAULT_REPORT_FONT_PX;
      applyFontSize(stepFontSize(current, delta));
    },
    [applyFontSize, showFormatHint]
  );

  useEffect(() => {
    if (!editing) return;
    document.addEventListener("selectionchange", saveEditorSelection);
    return () =>
      document.removeEventListener("selectionchange", saveEditorSelection);
  }, [editing, saveEditorSelection]);

  useEffect(() => {
    return () => {
      if (formatHintTimerRef.current) {
        clearTimeout(formatHintTimerRef.current);
      }
    };
  }, []);

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

  function pasteFcHtmlToActiveSection(html: string) {
    if (!draft || !html.trim()) return;
    if (!editing) setEditing(true);
    const idx = Math.min(
      Math.max(0, activeSectionIdx),
      Math.max(0, draft.sections.length - 1)
    );

    const editor = focusActiveBodyEditor();
    if (editor && findReportBodyEditor(editor)) {
      try {
        document.execCommand("insertHTML", false, html);
        patchSection(idx, { body: editor.innerHTML, rich: true });
        return;
      } catch {
        /* append below */
      }
    }

    const sec = draft.sections[idx];
    const body = (sec?.body || "").trim();
    patchSection(idx, {
      body: body ? `${body}${html}` : html,
      rich: true,
    });
  }

  function pasteFcImagesToActiveSection(urls: string[]) {
    if (!draft || !urls.length) return;
    if (!editing) setEditing(true);
    const idx = Math.min(
      Math.max(0, activeSectionIdx),
      Math.max(0, draft.sections.length - 1)
    );
    updateDraft((prev) => {
      const sections = [...prev.sections];
      const sec = sections[idx];
      const merged = Array.from(new Set([...(sec.images ?? []), ...urls]));
      sections[idx] = { ...sec, images: merged };
      return { ...prev, sections };
    });
  }

  function linkFcToActiveSection(row: ReportFcRow) {
    if (!draft) return;
    if (!editing) setEditing(true);
    const idx = Math.min(
      Math.max(0, activeSectionIdx),
      Math.max(0, draft.sections.length - 1)
    );
    const parts = resolveAnswerParts({
      explanation: row.answerText,
      answerImageUrl: row.fc?.answerImageUrl,
      answerImageUrls: row.fc?.answerImageUrls,
      answerParts: row.fc?.answerParts,
    });
    const flat = parts.flatMap((p) => p.imageUrls ?? []);
    const split = splitPrimaryImage(flat.length ? flat : row.images);

    updateDraft((prev) => {
      const sections = [...prev.sections];
      const sec = sections[idx];
      const entries = [...(sec.entries ?? [])];
      if (entries.some((e) => e.itemId === row.item.id)) {
        return prev;
      }
      entries.push({
        itemId: row.item.id,
        text: row.item.statement,
        answerImageUrl: split.imageUrl,
        answerImageUrls: split.imageUrls,
        answerParts: parts.length ? parts : undefined,
      });
      sections[idx] = { ...sec, entries };

      const factChecks = [...(prev.factChecks ?? [])];
      if (!factChecks.some((f) => f.itemId === row.item.id)) {
        factChecks.push({
          itemId: row.item.id,
          statement: row.item.statement,
          checkGuide: row.answerText,
          verdict: row.fc?.verdict,
          answerImageUrl: split.imageUrl,
          answerImageUrls: split.imageUrls,
          answerParts: parts.length ? parts : undefined,
        });
      }

      return { ...prev, sections, factChecks };
    });
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

  async function pasteImagesToSection(idx: number) {
    if (!editing) return;
    setActiveSectionIdx(idx);
    focusActiveBodyEditor();
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
      "먼저 사진 앱에서 이미지를 복사한 뒤, 다시 「붙여넣기」를 누르거나 본문 상자를 탭한 뒤 붙여넣기하세요."
    );
  }

  function handleSectionPaste(idx: number, e: React.ClipboardEvent) {
    if (!editing) return;
    // 섹션 래퍼가 아니라 본문 상자에만 붙여넣기
    const inBody = findReportBodyEditor(e.target as Node);
    if (!inBody) {
      e.preventDefault();
      setActiveSectionIdx(idx);
      focusActiveBodyEditor();
      return;
    }
    const files = extractImageFilesFromDataTransfer(e.clipboardData);
    if (!files.length) return;
    e.preventDefault();
    void addImagesToSection(idx, files);
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
    const t = (e.target as HTMLElement).closest("[data-fc-key]") as HTMLElement | null;
    if (!t) return;
    e.preventDefault();
    e.stopPropagation();
    const key = t.getAttribute("data-fc-key");
    if (!key) return;
    // 같은 F 다시 선택 → DETAIL 닫기
    setOpenFcKey((prev) => (prev === key ? null : key));
  }

  function focusActiveBodyEditor(): HTMLElement | null {
    const sec = draft?.sections[activeSectionIdx];
    const byId = sec?.sectionId
      ? document.getElementById(`sec-body-${sec.sectionId}`)
      : null;
    const editors = document.querySelectorAll<HTMLElement>(
      "#report .report-body[contenteditable]"
    );
    const el =
      (byId as HTMLElement | null) ||
      editors[activeSectionIdx] ||
      editors[0] ||
      null;
    if (!el) return null;
    el.focus();
    const saved = savedSelectionRef.current;
    if (saved) {
      try {
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(saved);
      } catch {
        /* ignore stale range */
      }
    }
    return el;
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
              href="#cover"
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
            편집을 마칠 수 있습니다. 오른쪽(또는 아래) 팩트체크 자료에서 내용·사진을
            복사·붙여넣기·수정·삭제할 수 있습니다. 글자 크기 Ctrl+Z / Ctrl+Y
          </p>
        )}

        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)] lg:gap-4 lg:items-start">
          <div className="min-w-0 space-y-5">
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
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-ink-500">
                  편집 중 ·{" "}
                  <span className="font-medium text-ink-800">
                    {draft.sections[activeSectionIdx]?.heading || "섹션"}
                  </span>
                  {formatTarget === "selection" && (
                    <span className="ml-2 text-accent">· 글자 선택됨</span>
                  )}
                  {formatTarget === "paragraph" && (
                    <span className="ml-2 text-accent">· 문단 전체</span>
                  )}
                </p>
                {formatHint && (
                  <p className="text-xs text-ink-600 bg-amber-50 border border-amber-200 rounded-md px-2 py-1">
                    {formatHint}
                  </p>
                )}
              </div>
              <FormatToolbar
                canUndo={historyUi.canUndo}
                canRedo={historyUi.canRedo}
                onUndo={undoEdit}
                onRedo={redoEdit}
                onFontSize={applyFontSize}
                onFontSizeStep={stepActiveFontSize}
                onBold={() => document.execCommand("bold")}
                onUnderline={() => document.execCommand("underline")}
                onColor={(c) => document.execCommand("foreColor", false, c)}
                onHighlight={(c) =>
                  document.execCommand("hiliteColor", false, c)
                }
                onImage={() => {
                  focusActiveBodyEditor();
                  const input = document.getElementById(
                    `sec-img-${activeSectionIdx}`
                  ) as HTMLInputElement | null;
                  input?.click();
                }}
                onPasteImage={() => {
                  focusActiveBodyEditor();
                  void pasteImagesToSection(activeSectionIdx);
                }}
                onTextImage={() => {
                  focusActiveBodyEditor();
                  setTextImageFor(activeSectionIdx);
                }}
                onHandwriting={() => {
                  focusActiveBodyEditor();
                  setHandwritingFor(activeSectionIdx);
                }}
                onBeforeFontSizeSelect={() => {
                  saveEditorSelection();
                }}
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
                      onSaveSelection={saveEditorSelection}
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
                          연결된 팩트체크 — 클릭하면 내용 확인·수정
                        </p>
                        {sectionMarkers.map((m) => (
                          <div
                            key={m.key}
                            className="flex flex-wrap items-start justify-between gap-2 text-sm"
                          >
                            <button
                              type="button"
                              onClick={() =>
                                setOpenFcKey((prev) =>
                                  prev === m.key ? null : m.key
                                )
                              }
                              className="flex-1 min-w-0 text-left rounded-lg px-1 py-0.5 hover:bg-white hover:text-accent"
                            >
                              <p className="flex items-start gap-1.5">
                                <span className="fc-badge mr-0.5 shrink-0 mt-0.5">
                                  F{m.n}
                                </span>
                                <span className="underline decoration-accent/50 underline-offset-2">
                                  {m.entry.text}
                                </span>
                              </p>
                            </button>
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
                  <ul className="space-y-2 print:hidden">
                    {unmatched.map((m) => {
                      const isOpen = openFcKey === m.key;
                      return (
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
                          {isOpen && (
                            <div className="mt-2 ml-8">
                              <InlineFcDetailPanel
                                marker={m}
                                item={
                                  m.entry.itemId
                                    ? localVideo.items.find(
                                        (i) => i.id === m.entry.itemId
                                      )
                                    : undefined
                                }
                                videoFc={
                                  m.entry.itemId
                                    ? localVideo.factChecks.find(
                                        (f) => f.itemId === m.entry.itemId
                                      )
                                    : undefined
                                }
                                reportFc={
                                  m.entry.itemId
                                    ? fcByItem.get(m.entry.itemId)
                                    : undefined
                                }
                                videoId={localVideo.id}
                                onClose={() => setOpenFcKey(null)}
                                onVideoUpdate={(v) => {
                                  setLocalVideo(v);
                                  if (v.report) setDraft(v.report);
                                  router.refresh();
                                }}
                              />
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}

                {openMarker &&
                  openMarker.sectionIdx === idx &&
                  !unmatched.some((m) => m.key === openMarker.key) && (
                    <div className="print:hidden">
                      <InlineFcDetailPanel
                        marker={openMarker}
                        item={
                          openMarker.entry.itemId
                            ? localVideo.items.find(
                                (i) => i.id === openMarker.entry.itemId
                              )
                            : undefined
                        }
                        videoFc={
                          openMarker.entry.itemId
                            ? localVideo.factChecks.find(
                                (f) => f.itemId === openMarker.entry.itemId
                              )
                            : undefined
                        }
                        reportFc={
                          openMarker.entry.itemId
                            ? fcByItem.get(openMarker.entry.itemId)
                            : undefined
                        }
                        videoId={localVideo.id}
                        onClose={() => setOpenFcKey(null)}
                        onVideoUpdate={(v) => {
                          setLocalVideo(v);
                          if (v.report) setDraft(v.report);
                          router.refresh();
                        }}
                      />
                    </div>
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

        {/* 편집 모드: F 상세 모달 / 보기 모드는 인라인 DETAIL */}
        {openMarker && editing && (
          <FcDetailModal
            marker={openMarker}
            editing={editing}
            item={
              openMarker.entry.itemId
                ? localVideo.items.find((i) => i.id === openMarker.entry.itemId)
                : undefined
            }
            videoFc={
              openMarker.entry.itemId
                ? localVideo.factChecks.find(
                    (f) => f.itemId === openMarker.entry.itemId
                  )
                : undefined
            }
            reportFc={
              openMarker.entry.itemId
                ? fcByItem.get(openMarker.entry.itemId)
                : undefined
            }
            busy={saving || rebuilding}
            onClose={() => setOpenFcKey(null)}
            onPasteText={(html) => {
              pasteFcHtmlToActiveSection(html);
              setOpenFcKey(null);
            }}
            onPasteImages={(urls) => {
              pasteFcImagesToActiveSection(urls);
              setOpenFcKey(null);
            }}
            onUnlink={() => {
              deleteEntry(openMarker.sectionIdx, openMarker.entryIdx);
            }}
            onVideoUpdate={(v) => {
              setLocalVideo(v);
              if (v.report) setDraft(v.report);
              router.refresh();
            }}
            videoId={localVideo.id}
          />
        )}
          </div>

          <div className="mt-4 lg:mt-0 lg:sticky lg:top-[calc(env(safe-area-inset-top,0px)+5rem)] print:hidden">
            <ReportFactCheckToolbox
              video={localVideo}
              draft={draft}
              editing={editing}
              activeSectionIdx={activeSectionIdx}
              busy={saving || rebuilding}
              onVideoUpdate={(v) => {
                setLocalVideo(v);
                router.refresh();
              }}
              onDraftUpdate={(r) => {
                setDraft(r);
              }}
              onPasteTextToSection={pasteFcHtmlToActiveSection}
              onPasteImagesToSection={pasteFcImagesToActiveSection}
              onLinkToSection={linkFcToActiveSection}
            />
          </div>
        </div>
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

function InlineFcDetailPanel({
  marker,
  item,
  videoFc,
  reportFc,
  videoId,
  onClose,
  onVideoUpdate,
}: {
  marker: FcMarker;
  item?: SummaryItem;
  videoFc?: FactCheckResult;
  reportFc?: TypedReport["factChecks"][number];
  videoId: string;
  onClose: () => void;
  onVideoUpdate: (video: VideoRecord) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const answerFromVideo = !isPromptOnly(videoFc?.explanation)
    ? normalizeAiAnswer(videoFc?.explanation || "")
    : "";
  const answerText =
    answerFromVideo ||
    (reportFc?.checkGuide || "").trim() ||
    marker.entry.answerParts?.map((p) => `${p.number}. ${p.text}`).join("\n") ||
    marker.entry.html?.replace(/<[^>]+>/g, "") ||
    "";
  const verdict = (videoFc?.verdict ??
    reportFc?.verdict ??
    "pending") as FactCheckVerdict;
  const badge = verdictBadge(verdict);
  const images = Array.from(
    new Set(
      [
        ...normalizeImageUrls(
          marker.entry.answerImageUrl,
          marker.entry.answerImageUrls
        ),
        ...normalizeImageUrls(videoFc?.answerImageUrl, videoFc?.answerImageUrls),
        ...(marker.entry.answerParts ?? []).flatMap((p) => p.imageUrls ?? []),
        ...(videoFc?.answerParts ?? []).flatMap((p) => p.imageUrls ?? []),
      ].filter((u) => Boolean(u) && !/i\.ytimg\.com|ytimg\.com\/vi\//i.test(u))
    )
  );

  async function clearDetail() {
    const itemId = marker.entry.itemId;
    if (!itemId) {
      setError("이 항목은 DETAIL만 비울 수 없습니다.");
      return;
    }
    if (!window.confirm("팩트체크 제목은 남기고 DETAIL(답변·이미지)만 삭제할까요?")) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/videos/${videoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clearFactCheckDetail: { itemId },
          preserveReadyStatus: true,
        }),
      });
      const data = (await res.json()) as { error?: string; video?: VideoRecord };
      if (!res.ok) throw new Error(data.error || "DETAIL 삭제 실패");
      if (data.video) onVideoUpdate(data.video);
    } catch (e) {
      setError(e instanceof Error ? e.message : "DETAIL 삭제 실패");
    } finally {
      setBusy(false);
    }
  }

  async function deleteAll() {
    const itemId = marker.entry.itemId;
    if (!itemId) {
      onClose();
      return;
    }
    if (
      !window.confirm(
        "팩트체크 제목과 DETAIL을 모두 삭제할까요? 보고서 연결도 제거됩니다."
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/videos/${videoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deleteItem: { itemId },
          preserveReadyStatus: true,
        }),
      });
      const data = (await res.json()) as { error?: string; video?: VideoRecord };
      if (!res.ok) throw new Error(data.error || "전체 삭제 실패");
      if (data.video) onVideoUpdate(data.video);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "전체 삭제 실패");
    } finally {
      setBusy(false);
    }
  }

  async function copyText() {
    const text = [item?.statement || marker.entry.text, answerText]
      .filter(Boolean)
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      setError("복사 실패");
    }
  }

  return (
    <div className="rounded-xl border border-accent/30 bg-white p-3 space-y-2 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-ink-500">
          F{marker.n} DETAIL · {badge.mark} {badge.label}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-ink-500 underline"
        >
          닫기
        </button>
      </div>
      <p className="text-sm font-medium text-ink-900">
        {item?.statement || marker.entry.text}
      </p>
      {answerText ? (
        <p className="text-sm text-ink-700 whitespace-pre-wrap leading-relaxed">
          {answerText}
        </p>
      ) : (
        <p className="text-xs text-ink-400">DETAIL 없음</p>
      )}
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((src) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={src.slice(0, 48)}
              src={src}
              alt=""
              className="h-20 w-auto rounded-lg border border-ink-100 object-cover"
            />
          ))}
        </div>
      )}
      {error && <p className="text-xs text-verify-false">{error}</p>}
      <div className="flex flex-wrap gap-1.5 pt-1">
        <button
          type="button"
          onClick={() => void copyText()}
          className="inline-flex items-center gap-1 rounded-lg border border-ink-200 px-2 py-1 text-[11px] font-medium"
        >
          <ClipboardCopy className="h-3 w-3" />
          복사
        </button>
        <button
          type="button"
          disabled={busy || !answerText}
          onClick={() => void clearDetail()}
          className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-900 disabled:opacity-40"
        >
          DETAIL 삭제
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void deleteAll()}
          className="inline-flex items-center gap-1 rounded-lg border border-verify-false/40 bg-verify-false/5 px-2 py-1 text-[11px] font-medium text-verify-false disabled:opacity-40"
        >
          <Trash2 className="h-3 w-3" />
          전체 삭제
        </button>
      </div>
    </div>
  );
}

function isPromptOnly(text: string | undefined): boolean {
  const t = (text ?? "").trim();
  if (!t) return true;
  return /^다음 주장을/.test(t) && /팩트체크/.test(t);
}

function escapeHtmlLocal(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function textToReportHtml(text: string): string {
  const clean = normalizeAiAnswer(text).trim();
  if (!clean) return "";
  return clean
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtmlLocal(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

const VERDICT_OPTIONS: FactCheckVerdict[] = [
  "true",
  "mostly_true",
  "mixed",
  "mostly_false",
  "false",
  "unverifiable",
];

function FcDetailModal({
  marker,
  editing,
  item,
  videoFc,
  reportFc,
  busy,
  videoId,
  onClose,
  onPasteText,
  onPasteImages,
  onUnlink,
  onVideoUpdate,
}: {
  marker: FcMarker;
  editing: boolean;
  item?: SummaryItem;
  videoFc?: FactCheckResult;
  reportFc?: TypedReport["factChecks"][number];
  busy?: boolean;
  videoId: string;
  onClose: () => void;
  onPasteText: (html: string) => void;
  onPasteImages: (urls: string[]) => void;
  onUnlink: () => void;
  onVideoUpdate: (video: VideoRecord) => void;
}) {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const answerFromVideo = !isPromptOnly(videoFc?.explanation)
    ? normalizeAiAnswer(videoFc?.explanation || "")
    : "";
  const answerFromReport = (reportFc?.checkGuide || "").trim();
  const parts =
    marker.entry.answerParts?.length
      ? marker.entry.answerParts
      : videoFc?.answerParts?.length
        ? videoFc.answerParts
        : reportFc?.answerParts?.length
          ? reportFc.answerParts
          : null;
  const partsText = parts?.map((p) => `${p.number}. ${p.text}`).join("\n") || "";
  const answerText =
    answerFromVideo ||
    answerFromReport ||
    partsText ||
    marker.entry.html?.replace(/<[^>]+>/g, "") ||
    "";

  const verdict = (videoFc?.verdict ??
    reportFc?.verdict ??
    "pending") as FactCheckVerdict;
  const badge = verdictBadge(verdict);
  const failed = isFailedVerdict(verdict);
  const images = Array.from(
    new Set(
      [
        ...normalizeImageUrls(
          marker.entry.answerImageUrl,
          marker.entry.answerImageUrls
        ),
        ...normalizeImageUrls(videoFc?.answerImageUrl, videoFc?.answerImageUrls),
        ...normalizeImageUrls(
          reportFc?.answerImageUrl,
          reportFc?.answerImageUrls
        ),
        ...(parts ?? []).flatMap((p) => p.imageUrls ?? []),
        ...(item ? normalizeImageUrls(item.imageUrl, item.imageUrls) : []),
      ].filter((u) => Boolean(u) && !/i\.ytimg\.com|ytimg\.com\/vi\//i.test(u))
    )
  );

  const [statement, setStatement] = useState(
    item?.statement || marker.entry.text
  );
  const [detail, setDetail] = useState(item?.detail || "");
  const [explanation, setExplanation] = useState(answerText);
  const [editVerdict, setEditVerdict] = useState<FactCheckVerdict>(
    verdict !== "pending" ? verdict : "unverifiable"
  );

  useEffect(() => {
    setStatement(item?.statement || marker.entry.text);
    setDetail(item?.detail || "");
    setExplanation(answerText);
    setEditVerdict(verdict !== "pending" ? verdict : "unverifiable");
    setMode("view");
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when marker changes
  }, [marker.key]);

  function notify(msg: string) {
    setFlash(msg);
    window.setTimeout(() => setFlash(null), 2000);
  }

  async function copyText() {
    const text = [statement || marker.entry.text, answerText]
      .filter(Boolean)
      .join("\n\n");
    if (!text.trim()) {
      setError("복사할 내용이 없습니다.");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      notify("텍스트 복사됨");
      setError(null);
    } catch {
      setError("클립보드 복사에 실패했습니다.");
    }
  }

  async function clearDetailOnly() {
    const itemId = marker.entry.itemId;
    if (!itemId) {
      setError("이 항목은 DETAIL만 비울 수 없습니다.");
      return;
    }
    if (
      !window.confirm(
        "팩트체크 제목은 남기고 DETAIL(답변·이미지)만 삭제할까요?"
      )
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/videos/${videoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clearFactCheckDetail: { itemId },
          preserveReadyStatus: true,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        video?: VideoRecord;
      };
      if (!res.ok) throw new Error(data.error || "DETAIL 삭제 실패");
      if (data.video) onVideoUpdate(data.video);
      notify("DETAIL 삭제됨 (제목 유지)");
      setMode("view");
    } catch (e) {
      setError(e instanceof Error ? e.message : "DETAIL 삭제 실패");
    } finally {
      setSaving(false);
    }
  }

  async function deleteFc() {
    const itemId = marker.entry.itemId;
    if (!itemId) {
      onUnlink();
      return;
    }
    if (
      !window.confirm(
        "팩트체크 제목과 DETAIL을 모두 삭제할까요? 보고서 연결도 제거됩니다."
      )
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/videos/${videoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deleteItem: { itemId },
          preserveReadyStatus: true,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        video?: VideoRecord;
      };
      if (!res.ok) throw new Error(data.error || "삭제 실패");
      if (data.video) onVideoUpdate(data.video);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "삭제 실패");
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit() {
    const itemId = marker.entry.itemId;
    if (!itemId) {
      setError("이 항목은 보고서 연결만 있습니다. 원본 FC ID가 없어 수정할 수 없습니다.");
      return;
    }
    const nextExplanation = normalizeAiAnswer(explanation.trim());
    if (nextExplanation.length < 20) {
      setError("팩트체크 답변을 20자 이상 입력해 주세요.");
      return;
    }
    if (!statement.trim()) {
      setError("주장을 입력해 주세요.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const itemRes = await fetch(`/api/videos/${videoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updateItem: {
            itemId,
            statement: statement.trim(),
            detail: detail.trim() || null,
          },
          preserveReadyStatus: true,
        }),
      });
      const itemData = (await itemRes.json()) as {
        error?: string;
        video?: VideoRecord;
      };
      if (!itemRes.ok) throw new Error(itemData.error || "주장 수정 실패");

      const prev = (itemData.video?.factChecks ?? []).find(
        (f) => f.itemId === itemId
      );
      const nextParts = resolveAnswerParts({
        explanation: nextExplanation,
        answerImageUrl: prev?.answerImageUrl ?? videoFc?.answerImageUrl,
        answerImageUrls: prev?.answerImageUrls ?? videoFc?.answerImageUrls,
        answerParts: prev?.answerParts ?? videoFc?.answerParts,
      });

      const fcRes = await fetch(`/api/videos/${videoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          factCheck: {
            itemId,
            verdict:
              editVerdict === "pending" ? "unverifiable" : editVerdict,
            explanation: nextExplanation,
            sources: prev?.sources ?? videoFc?.sources ?? [],
            answerParts: nextParts,
          },
          preserveReadyStatus: true,
        }),
      });
      const fcData = (await fcRes.json()) as {
        error?: string;
        video?: VideoRecord;
      };
      if (!fcRes.ok) throw new Error(fcData.error || "답변 저장 실패");
      if (fcData.video) onVideoUpdate(fcData.video);
      setMode("view");
      notify("저장됨");
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-ink-900/50 p-3 print:hidden"
      role="dialog"
      aria-modal="true"
      aria-label={`팩트체크 F${marker.n}`}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[90vh] overflow-auto rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 px-4 py-3 border-b border-ink-100 bg-white">
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
          {flash && (
            <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5">
              <Check className="h-3.5 w-3.5" />
              {flash}
            </p>
          )}
          {error && (
            <p className="text-xs text-verify-false" role="alert">
              {error}
            </p>
          )}

          {mode === "edit" ? (
            <div className="space-y-2">
              <label className="block text-xs text-ink-500">
                주장
                <textarea
                  value={statement}
                  onChange={(e) => setStatement(e.target.value)}
                  rows={2}
                  className="mt-0.5 w-full rounded-lg border border-ink-200 px-2.5 py-2 text-sm outline-none focus:border-accent"
                />
              </label>
              <label className="block text-xs text-ink-500">
                상세 (선택)
                <textarea
                  value={detail}
                  onChange={(e) => setDetail(e.target.value)}
                  rows={2}
                  className="mt-0.5 w-full rounded-lg border border-ink-200 px-2.5 py-2 text-sm outline-none focus:border-accent"
                />
              </label>
              <label className="block text-xs text-ink-500">
                팩트체크 답변
                <textarea
                  value={explanation}
                  onChange={(e) => setExplanation(e.target.value)}
                  rows={6}
                  className="mt-0.5 w-full rounded-lg border border-ink-200 px-2.5 py-2 text-sm outline-none focus:border-accent"
                />
              </label>
              <label className="block text-xs text-ink-500">
                판정
                <select
                  value={editVerdict}
                  onChange={(e) =>
                    setEditVerdict(e.target.value as FactCheckVerdict)
                  }
                  className="mt-0.5 w-full rounded-lg border border-ink-200 px-2.5 py-2 text-sm outline-none focus:border-accent"
                >
                  {VERDICT_OPTIONS.map((v) => (
                    <option key={v} value={v}>
                      {verdictLabel(v)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  disabled={saving || busy}
                  onClick={() => void saveEdit()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
                >
                  {saving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  저장
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    setMode("view");
                    setError(null);
                  }}
                  className="rounded-lg border border-ink-200 px-3 py-2 text-xs font-medium"
                >
                  취소
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="font-medium text-ink-900 leading-snug">
                <u className="decoration-accent/70 underline-offset-2">
                  {item?.statement || marker.entry.text}
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
              ) : answerText ? (
                <div className="rounded-lg bg-ink-50 border border-ink-100 p-3 text-ink-700 whitespace-pre-wrap leading-relaxed">
                  {failed && (
                    <p className="text-verify-false font-bold mb-2">
                      ✗ 사실과 다름
                    </p>
                  )}
                  {answerText}
                </div>
              ) : (
                <p className="text-ink-500">
                  저장된 팩트체크 세부 내용이 없습니다.
                </p>
              )}

              {!parts?.length &&
                images.map((src) => (
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

              <div className="flex flex-wrap gap-1.5 pt-1 border-t border-ink-100">
                <button
                  type="button"
                  onClick={() => void copyText()}
                  className="inline-flex items-center gap-1 rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-xs font-medium"
                >
                  <ClipboardCopy className="h-3.5 w-3.5" />
                  텍스트 복사
                </button>
                {editing && (
                  <>
                    <button
                      type="button"
                      disabled={!answerText}
                      onClick={() => {
                        const html = textToReportHtml(
                          [
                            `【F${marker.n}】 ${item?.statement || marker.entry.text}`,
                            answerText,
                          ]
                            .filter(Boolean)
                            .join("\n\n")
                        );
                        if (html) onPasteText(html);
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border border-accent/40 bg-accent-muted/40 px-2.5 py-1.5 text-xs font-medium disabled:opacity-40"
                    >
                      <ClipboardPaste className="h-3.5 w-3.5" />
                      본문에 넣기
                    </button>
                    {images.length > 0 && (
                      <button
                        type="button"
                        onClick={() => onPasteImages(images)}
                        className="inline-flex items-center gap-1 rounded-lg border border-accent/40 bg-accent-muted/40 px-2.5 py-1.5 text-xs font-medium"
                      >
                        <ImagePlus className="h-3.5 w-3.5" />
                        이미지 넣기
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={onUnlink}
                      className="inline-flex items-center gap-1 rounded-lg border border-ink-200 px-2.5 py-1.5 text-xs font-medium"
                    >
                      <Link2 className="h-3.5 w-3.5" />
                      연결 제거
                    </button>
                  </>
                )}
                <button
                  type="button"
                  disabled={busy || saving || !marker.entry.itemId}
                  onClick={() => setMode("edit")}
                  className="inline-flex items-center gap-1 rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-xs font-medium disabled:opacity-40"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  수정
                </button>
                <button
                  type="button"
                  disabled={busy || saving || !marker.entry.itemId || !answerText}
                  onClick={() => void clearDetailOnly()}
                  className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-900 disabled:opacity-40"
                >
                  DETAIL 삭제
                </button>
                <button
                  type="button"
                  disabled={busy || saving}
                  onClick={() => void deleteFc()}
                  className="inline-flex items-center gap-1 rounded-lg border border-verify-false/40 bg-verify-false/5 px-2.5 py-1.5 text-xs font-medium text-verify-false disabled:opacity-40"
                >
                  {saving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                  전체 삭제
                </button>
              </div>
            </>
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
  onFontSizeStep,
  onBold,
  onUnderline,
  onColor,
  onHighlight,
  onImage,
  onPasteImage,
  onTextImage,
  onHandwriting,
  onBeforeFontSizeSelect,
}: {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onFontSize: (px: number) => void;
  onFontSizeStep: (delta: number) => void;
  onBold: () => void;
  onUnderline: () => void;
  onColor: (c: string) => void;
  onHighlight: (c: string) => void;
  onImage: () => void;
  onPasteImage: () => void;
  onTextImage: () => void;
  onHandwriting: () => void;
  onBeforeFontSizeSelect?: () => void;
}) {
  const keepSelection = (e: React.MouseEvent) => {
    e.preventDefault();
  };

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
      <ToolBtn onClick={onBold} title="굵게" onMouseDown={keepSelection}>
        <Bold className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn onClick={onUnderline} title="밑줄" onMouseDown={keepSelection}>
        <Underline className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn
        onClick={() => onFontSizeStep(-1)}
        title="글자 작게"
        onMouseDown={keepSelection}
      >
        <Minus className="h-4 w-4" />
      </ToolBtn>
      <div className="inline-flex flex-wrap items-center gap-0.5 rounded-lg border border-ink-200 bg-white px-1 py-0.5">
        <span className="text-[10px] text-ink-400 px-1">크기</span>
        {FONT_SIZES.map((size) => (
          <button
            key={size}
            type="button"
            title={`${size}px`}
            onMouseDown={(e) => {
              e.preventDefault();
              onBeforeFontSizeSelect?.();
            }}
            onClick={() => onFontSize(size)}
            className="min-h-7 min-w-7 rounded-md px-1.5 text-[11px] font-medium text-ink-700 hover:bg-accent-muted hover:text-ink-900"
          >
            {size}
          </button>
        ))}
      </div>
      <ToolBtn
        onClick={() => onFontSizeStep(1)}
        title="글자 크게"
        onMouseDown={keepSelection}
      >
        <Plus className="h-4 w-4" />
      </ToolBtn>
      <span className="text-xs text-ink-400 px-1">글자</span>
      {TEXT_COLORS.map((c) => (
        <button
          key={c.id}
          type="button"
          title={c.label}
          onMouseDown={keepSelection}
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
          onMouseDown={keepSelection}
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
  onMouseDown,
}: {
  children: ReactNode;
  onClick: () => void;
  title: string;
  disabled?: boolean;
  onMouseDown?: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      onMouseDown={onMouseDown}
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
  onSaveSelection,
}: {
  id?: string;
  html: string;
  onChange: (html: string) => void;
  onFocus?: () => void;
  onSaveSelection?: () => void;
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
    if (ref.current) {
      containReportBodyLayout(ref.current);
    }
    onChange(ref.current?.innerHTML ?? "");
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const files = e.clipboardData.files;
    if (files.length && Array.from(files).some((f) => f.type.startsWith("image/"))) {
      return;
    }

    const html = e.clipboardData.getData("text/html");
    const text = e.clipboardData.getData("text/plain");

    if (html?.trim()) {
      e.preventDefault();
      const clean = sanitizePastedHtml(html);
      if (clean) {
        document.execCommand("insertHTML", false, clean);
      } else if (text) {
        document.execCommand("insertHTML", false, wrapPlainPasteText(text));
      }
      if (ref.current) containReportBodyLayout(ref.current);
      syncChange();
      return;
    }

    if (text) {
      e.preventDefault();
      document.execCommand("insertHTML", false, wrapPlainPasteText(text));
      if (ref.current) containReportBodyLayout(ref.current);
      syncChange();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Enter 시 브라우저가 들여쓰기·div를 물려주지 않도록 새 문단만 삽입
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    document.execCommand("insertHTML", false, "<p><br></p>");
    if (ref.current) containReportBodyLayout(ref.current);
    syncChange();
  };

  return (
    <div
      id={id}
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      className="report-body min-h-[120px] w-full max-w-full overflow-x-hidden rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 leading-relaxed"
      onFocus={() => {
        focusedRef.current = true;
        onFocus?.();
      }}
      onBlur={() => {
        focusedRef.current = false;
        syncChange();
      }}
      onMouseUp={onSaveSelection}
      onKeyUp={onSaveSelection}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
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
