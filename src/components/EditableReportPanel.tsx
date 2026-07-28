"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Home,
  Loader2,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import type {
  ReportSectionBlock,
  TypedReport,
  VideoRecord,
} from "@/lib/types";
import { normalizeAiAnswer } from "@/lib/text-format";
import {
  collectFcMarkers,
  collectSectionFcImages,
  sectionBodyWithMarkers,
  stabilizeReportFcAnchors,
  stabilizeSectionFcAnchors,
} from "@/lib/fc-markers";
import { compressImageFiles, extractImageFilesFromDataTransfer, readImagesFromClipboard } from "@/lib/image-client";
import { uploadDataUrls } from "@/lib/media-upload-client";
import { normalizeImageUrls, splitPrimaryImage } from "@/lib/image-urls";
import {
  DEFAULT_REPORT_FONT_PX,
  findReportBodyEditor,
  parseFontSizeToPx,
} from "@/lib/report-editor-format";
import {
  getActiveReportEditor,
  getReportEditor,
} from "@/lib/report-editor-registry";
import {
  cloneReport,
  collectSectionImages,
  HISTORY_DEBOUNCE_MS,
  HISTORY_LIMIT,
  newSectionId,
  sectionEditKey,
  sectionSnapshot,
  stepFontSize,
} from "@/lib/report-editor-utils";
import { TextToImageModal } from "@/components/TextToImageModal";
import {
  ReportFactCheckToolbox,
  type ReportFcRow,
} from "@/components/ReportFactCheckToolbox";
import { FactCheckDetailPanel } from "@/components/FactCheckDetailPanel";
import { FactCheckAppendix } from "@/components/FactCheckAppendix";
import { FormatToolbar } from "@/components/ReportFormatToolbar";
import { RichBody } from "@/components/ReportRichBody";
import { HandwritingModal } from "@/components/HandwritingModal";
import { ReopenAsDraftButton } from "@/components/ReopenAsDraftButton";
import { resolveAnswerParts } from "@/lib/answer-parts";
import {
  formatFactChecksText,
  formatSectionText,
  importReportText,
  inspectImportedReportText,
} from "@/lib/report";

type ReportWorkMode = "view" | "body" | "factcheck";
type RoomImageItem = { url: string; tag?: string; note?: string };
const ROOM_TAGS = ["도입", "핵심", "근거", "결론", "F1", "F2", "F3", "기타"] as const;

function normalizeRoomItems(raw: TypedReport["imageRoom"]): RoomImageItem[] {
  const out: RoomImageItem[] = [];
  const seen = new Set<string>();
  for (const entry of raw ?? []) {
    const item =
      typeof entry === "string"
        ? { url: entry }
        : { url: entry.url, tag: entry.tag, note: entry.note };
    const url = item.url?.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ ...item, url });
  }
  return out;
}

export function EditableReportPanel({
  video,
  draftPhase = false,
}: {
  video: VideoRecord;
  /** FC 단계 골격 보고서 미리보기 */
  draftPhase?: boolean;
}) {
  const router = useRouter();
  const report = video.report;
  const [localVideo, setLocalVideo] = useState(video);
  const [mode, setMode] = useState<ReportWorkMode>("view");
  const editing = mode === "body";
  const factcheckMode = mode === "factcheck";
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<TypedReport | null>(report);
  const [openFcKey, setOpenFcKey] = useState<string | null>(null);
  const [handwritingFor, setHandwritingFor] = useState<number | null>(null);
  const [textImageFor, setTextImageFor] = useState<number | null>(null);
  const [activeSectionIdx, setActiveSectionIdx] = useState(0);
  const [rebuilding, setRebuilding] = useState(false);
  const [imageRoomBusy, setImageRoomBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
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
  const [formatHint, setFormatHint] = useState<string | null>(null);
  const [formatTarget, setFormatTarget] = useState<
    "none" | "selection" | "paragraph"
  >("none");
  const formatHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [autoSaveStatus, setAutoSaveStatus] = useState<
    "idle" | "pending" | "saving" | "saved" | "error"
  >("idle");
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedSnapRef = useRef<string>("");

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
      const stabilized = stabilizeReportFcAnchors(cloneReport(report));
      setDraft(stabilized);
      setSavedSections(report.sections.map(sectionSnapshot));
      setSectionSavedFlash({});
      lastSavedSnapRef.current = JSON.stringify(report);
      setAutoSaveStatus("idle");
      resetHistory();
    }
    wasEditingRef.current = editing;
  }, [editing, report, resetHistory]);

  useEffect(() => {
    if (mode !== "body" || !draft) return;
    const snap = JSON.stringify(draft);
    if (snap === lastSavedSnapRef.current) return;

    setAutoSaveStatus("pending");
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      void (async () => {
        const current = draftRef.current;
        if (!current) return;
        setAutoSaveStatus("saving");
        try {
          const toSave = stabilizeReportFcAnchors(current);
          const res = await fetch(`/api/videos/${video.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ updateReport: toSave }),
          });
          const data = (await res.json()) as {
            error?: string;
            video?: VideoRecord;
          };
          if (!res.ok) throw new Error(data.error || "자동 저장 실패");
          if (data.video?.report) {
            lastSavedSnapRef.current = JSON.stringify(data.video.report);
            setDraft(data.video.report);
            setSavedSections(data.video.report.sections.map(sectionSnapshot));
            setLocalVideo(data.video);
          }
          setAutoSaveStatus("saved");
          router.refresh();
        } catch {
          setAutoSaveStatus("error");
        }
      })();
    }, 1600);

    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [draft, mode, video.id, router]);

  useEffect(() => {
    function enterBody() {
      setMode("body");
      document.getElementById("report")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }

    function enterFactcheck() {
      setMode("factcheck");
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
          enterBody();
          return;
        }
        const fcKey = `edit-fc:${video.id}`;
        if (sessionStorage.getItem(fcKey) === "1") {
          sessionStorage.removeItem(fcKey);
          enterFactcheck();
          return;
        }
      } catch {
        /* ignore */
      }
      if (typeof window !== "undefined") {
        if (window.location.hash === "#report-edit") enterBody();
        if (window.location.hash === "#report-fc") enterFactcheck();
      }
    }

    fromStorageOrHash();

    function onCustom(e: Event) {
      const detail = (e as CustomEvent<{ id?: string; mode?: string }>).detail;
      if (detail?.id && detail.id !== video.id) return;
      if (detail?.mode === "factcheck") enterFactcheck();
      else enterBody();
    }
    function onHash() {
      if (window.location.hash === "#report-edit") enterBody();
      if (window.location.hash === "#report-fc") enterFactcheck();
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

  useEffect(() => {
    if (!draft) return;
    if ((draft.imageRoom?.length ?? 0) > 0) return;
    const seed = normalizeImageUrls(
      undefined,
      draft.sections.flatMap((sec) => [
        ...collectSectionImages(sec),
        ...collectSectionFcImages(sec, fcByItem),
      ])
    );
    if (!seed.length) return;
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            imageRoom: seed.map((url) => ({ url })),
          }
        : prev
    );
  }, [draft, fcByItem]);

  const openMarker = markers.find((m) => m.key === openFcKey) ?? null;
  const imageRoom = useMemo(
    () => normalizeRoomItems(draft?.imageRoom),
    [draft?.imageRoom]
  );

  const saveEditorSelection = useCallback(() => {
    const editor = getActiveReportEditor();
    if (!editor) {
      return;
    }
    const { empty } = editor.state.selection;
    if (!empty) {
      setFormatTarget("selection");
      return;
    }
    const text = editor.state.selection.$from.parent.textContent
      ?.replace(/\u00a0/g, " ")
      .trim();
    setFormatTarget(text ? "paragraph" : "none");
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

  async function copyToClipboard(text: string, label: string) {
    if (!text.trim()) {
      alert(`복사할 ${label} 텍스트가 없습니다.`);
      return;
    }
    await navigator.clipboard.writeText(text);
    alert(`${label} 텍스트를 복사했습니다.`);
  }

  function applyImportedReportText() {
    const current = draftRef.current;
    if (!current) return;
    const next = importReportText(current, importText);
    if (next === current) {
      const info = inspectImportedReportText(importText);
      const parsed =
        info.count > 0
          ? `읽은 섹션 ${info.count}개: ${info.headings.join(" / ")}`
          : "읽은 섹션이 없습니다. `##`, `■`, `제 N 장.` 형식을 확인해 주세요.";
      alert(`붙여넣은 텍스트를 반영하지 못했습니다.\n\n${parsed}`);
      return;
    }
    setDraft(next);
    setImportOpen(false);
    setImportText("");
    setMode("body");
    alert("정리본을 반영했습니다. 이미지와 팩트체크는 유지됩니다.");
  }

  const resolveActiveTipTap = useCallback(() => {
    const sec = draftRef.current?.sections[activeSectionIdx];
    if (sec) {
      const key = sectionEditKey(sec, activeSectionIdx);
      const byKey = getReportEditor(key);
      if (byKey) return { editor: byKey, idx: activeSectionIdx };
    }
    const active = getActiveReportEditor();
    if (active) {
      const sections = draftRef.current?.sections ?? [];
      for (let i = 0; i < sections.length; i++) {
        const s = sections[i]!;
        if (getReportEditor(sectionEditKey(s, i)) === active) {
          return { editor: active, idx: i };
        }
      }
      return { editor: active, idx: activeSectionIdx };
    }
    return null;
  }, [activeSectionIdx]);

  /** 선택이 비어 있으면 현재 문단 전체를 대상으로 지정 */
  const ensureFormatSelection = useCallback(
    (editor: NonNullable<ReturnType<typeof getActiveReportEditor>>) => {
      const { empty, $from } = editor.state.selection;
      if (!empty) return "selection" as const;
      const from = $from.start();
      const to = $from.end();
      if (from >= to) return "none" as const;
      editor.chain().focus().setTextSelection({ from, to }).run();
      return "paragraph" as const;
    },
    []
  );

  const applyFontSize = useCallback(
    (px: number) => {
      const resolved = resolveActiveTipTap();
      if (!resolved) {
        showFormatHint("본문 편집 칸을 먼저 클릭해 주세요.");
        return;
      }
      const { editor, idx } = resolved;
      editor.chain().focus().run();
      const mode = ensureFormatSelection(editor);
      if (mode === "none") {
        showFormatHint("크기를 조절할 글자를 선택하거나 문단 안에 커서를 두세요.");
        return;
      }
      const { to } = editor.state.selection;
      editor.chain().focus().setFontSize(`${px}px`).run();
      // 문단 전체 적용 후 커서를 끝으로 되돌려 선택 잔상 방지
      if (mode === "paragraph") {
        editor.chain().focus().setTextSelection(to).run();
      }
      patchSection(idx, { body: editor.getHTML(), rich: true }, "immediate");
      showFormatHint(
        mode === "paragraph"
          ? `${px}px — 현재 문단 전체에 적용했습니다.`
          : `${px}px — 선택한 글자에 적용했습니다.`
      );
      saveEditorSelection();
    },
    [
      resolveActiveTipTap,
      ensureFormatSelection,
      showFormatHint,
      saveEditorSelection,
    ]
  );

  const stepActiveFontSize = useCallback(
    (delta: number) => {
      const resolved = resolveActiveTipTap();
      if (!resolved) {
        showFormatHint("본문 편집 칸을 먼저 클릭해 주세요.");
        return;
      }
      const { editor } = resolved;
      editor.chain().focus().run();
      const attrs = editor.getAttributes("textStyle");
      const current =
        parseFontSizeToPx(String(attrs.fontSize || "")) ??
        DEFAULT_REPORT_FONT_PX;
      applyFontSize(stepFontSize(current, delta));
    },
    [resolveActiveTipTap, applyFontSize, showFormatHint]
  );

  const runFormatCommand = useCallback(
    (fn: (editor: NonNullable<ReturnType<typeof getActiveReportEditor>>) => void) => {
      const resolved = resolveActiveTipTap();
      if (!resolved) {
        showFormatHint("본문 편집 칸을 먼저 클릭해 주세요.");
        return;
      }
      const { editor, idx } = resolved;
      editor.chain().focus().run();
      fn(editor);
      patchSection(idx, { body: editor.getHTML(), rich: true }, "immediate");
      saveEditorSelection();
    },
    [resolveActiveTipTap, showFormatHint, saveEditorSelection]
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
      const toSave = stabilizeReportFcAnchors(draft);
      const res = await fetch(`/api/videos/${video.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updateReport: toSave }),
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
        setMode("view");
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
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    await persistReport({ exit: !draftPhase });
    if (draftPhase) {
      setMode("view");
    }
    setAutoSaveStatus("idle");
  }

  async function saveSection(idx: number) {
    await persistReport({ sectionIdx: idx });
  }

  function cancelEdit() {
    flushDebouncedHistory();
    setDraft(report);
    setMode("view");
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

  function patchImageRoom(urls: string[], history: "immediate" | "debounced" | "none" = "immediate") {
    updateDraft((prev) => {
      const current = normalizeRoomItems(prev.imageRoom);
      const seen = new Set(current.map((x) => x.url));
      const appended = urls
        .map((u) => u.trim())
        .filter((u) => u && !seen.has(u))
        .map((url) => ({ url }));
      if (!appended.length) return prev;
      return { ...prev, imageRoom: [...current, ...appended] };
    }, { history });
  }

  async function addImagesToRoom(files: File[]) {
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    if (!imageFiles.length) return;
    setImageRoomBusy(true);
    try {
      const dataUrls = await compressImageFiles(imageFiles);
      if (!dataUrls.length) return;
      const uploaded = await uploadDataUrls(
        dataUrls,
        `videos/${video.id}/report-room`
      );
      patchImageRoom(uploaded, "immediate");
    } catch (e) {
      alert(e instanceof Error ? e.message : "이미지 룸 추가에 실패했습니다.");
    } finally {
      setImageRoomBusy(false);
    }
  }

  function removeImageFromRoom(src: string) {
    updateDraft((prev) => ({
      ...prev,
      imageRoom: normalizeRoomItems(prev.imageRoom).filter((u) => u.url !== src),
    }));
  }

  function updateRoomMeta(src: string, patch: Partial<Pick<RoomImageItem, "tag" | "note">>) {
    updateDraft((prev) => ({
      ...prev,
      imageRoom: normalizeRoomItems(prev.imageRoom).map((it) =>
        it.url === src
          ? {
              ...it,
              tag: patch.tag !== undefined ? patch.tag || undefined : it.tag,
              note: patch.note !== undefined ? patch.note || undefined : it.note,
            }
          : it
      ),
    }), { history: "debounced" });
  }

  function addRoomImageToActiveSection(src: string) {
    const idx = Math.min(
      Math.max(0, activeSectionIdx),
      Math.max(0, (draft?.sections.length ?? 1) - 1)
    );
    patchSection(
      idx,
      {
        images: normalizeImageUrls(
          undefined,
          [...(draft?.sections[idx]?.images ?? []), src]
        ),
      },
      "immediate"
    );
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

  function addSection(
    preset?: { heading?: string; body?: string }
  ) {
    const sectionId = newSectionId();
    updateDraft((prev) => {
      const newIdx = prev.sections.length;
      queueMicrotask(() => {
        setActiveSectionIdx(newIdx);
        window.setTimeout(() => {
          const tip = getReportEditor(sectionId);
          if (tip) {
            tip.chain().focus().run();
            tip.view.dom.scrollIntoView({
              behavior: "smooth",
              block: "center",
            });
            return;
          }
          const el = document.getElementById(`sec-body-${sectionId}`);
          el?.focus();
          el?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 40);
      });
      return {
        ...prev,
        sections: [
          ...prev.sections,
          {
            sectionId,
            heading: preset?.heading ?? "새 소주제",
            body: preset?.body ?? "<p><br></p>",
            rich: true,
            entries: [],
          },
        ],
      };
    });
  }

  function addFlowSection() {
    addSection({
      heading: "핵심 설명",
      body: "<p>핵심 메시지를 2~4문장으로 먼저 요약해 주세요.</p><p>아래 대표 이미지를 근거로 핵심 포인트를 짧게 정리하면 읽기 흐름이 좋아집니다.</p>",
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
    if (!editing) setMode("body");
    const idx = Math.min(
      Math.max(0, activeSectionIdx),
      Math.max(0, draft.sections.length - 1)
    );

    const editor = focusActiveBodyEditor();
    if (editor) {
      try {
        editor.chain().focus().insertContent(html).run();
        patchSection(idx, { body: editor.getHTML(), rich: true });
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
    if (!editing) setMode("body");
    const idx = Math.min(
      Math.max(0, activeSectionIdx),
      Math.max(0, draft.sections.length - 1)
    );
    updateDraft((prev) => {
      const sections = [...prev.sections];
      const sec = sections[idx];
      const merged = Array.from(new Set([...(sec.images ?? []), ...urls]));
      sections[idx] = { ...sec, images: merged };
      return {
        ...prev,
        sections,
        imageRoom: [
          ...normalizeRoomItems(prev.imageRoom),
          ...urls
            .filter((u) => !normalizeRoomItems(prev.imageRoom).some((x) => x.url === u))
            .map((url) => ({ url })),
        ],
      };
    });
  }

  function linkFcToActiveSection(row: ReportFcRow) {
    if (!draft) return;
    if (!editing) setMode("body");
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
      sections[idx] = {
        ...sec,
        entries,
        body: stabilizeSectionFcAnchors(sec.body || "", entries),
      };

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
        return {
          ...prev,
          sections,
          imageRoom: [
            ...normalizeRoomItems(prev.imageRoom),
            ...uploaded
              .filter((u) => !normalizeRoomItems(prev.imageRoom).some((x) => x.url === u))
              .map((url) => ({ url })),
          ],
        };
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
        return {
          ...prev,
          sections,
          imageRoom: normalizeRoomItems(prev.imageRoom).some((x) => x.url === url)
            ? normalizeRoomItems(prev.imageRoom)
            : [...normalizeRoomItems(prev.imageRoom), { url }],
        };
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
        return {
          ...prev,
          sections,
          imageRoom: normalizeRoomItems(prev.imageRoom).some((x) => x.url === url)
            ? normalizeRoomItems(prev.imageRoom)
            : [...normalizeRoomItems(prev.imageRoom), { url }],
        };
      });
    } catch (e) {
      alert(e instanceof Error ? e.message : "텍스트 이미지 저장 실패");
    } finally {
      setTextImageFor(null);
    }
  }

  function onBodyClick(e: React.MouseEvent) {
    const t = (e.target as HTMLElement).closest(
      "[data-fc-key], [data-fc-item]"
    ) as HTMLElement | null;
    if (!t) return;
    e.preventDefault();
    e.stopPropagation();
    const key =
      t.getAttribute("data-fc-key") || t.getAttribute("data-fc-item");
    if (!key) return;
    // 같은 F 다시 선택 → DETAIL 닫기
    setOpenFcKey((prev) => (prev === key ? null : key));
  }

  function focusActiveBodyEditor() {
    const sec = draft?.sections[activeSectionIdx];
    const key = sec
      ? sectionEditKey(sec, activeSectionIdx)
      : null;
    const editor =
      (key ? getReportEditor(key) : null) ||
      getActiveReportEditor() ||
      null;
    if (!editor) return null;
    editor.chain().focus().run();
    return editor;
  }

  return (
    <>
      <section
        id="report"
        className="rounded-2xl border border-ink-200 bg-white/80 p-4 sm:p-5 space-y-5 scroll-mt-20"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
          <h2 className="font-display text-lg sm:text-xl">
            {draftPhase ? "3. 보고서 초안" : "3. 보고서"}
          </h2>
          <div className="flex flex-wrap gap-2">
            <a
              href="#cover"
              className="inline-flex items-center gap-1.5 min-h-10 rounded-lg border border-ink-200 bg-white px-3 text-sm font-medium hover:border-accent"
            >
              <Home className="h-4 w-4" />
              표지
            </a>
            {editing && (
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
                  disabled={saving || rebuilding || savingSectionIdx !== null || autoSaveStatus === "saving"}
                  className="inline-flex items-center gap-1.5 min-h-10 rounded-lg border border-accent/40 bg-accent text-white px-3 text-sm font-medium hover:opacity-95"
                >
                  <Save className="h-4 w-4" />
                  {saving || autoSaveStatus === "saving"
                    ? "저장 중…"
                    : draftPhase
                      ? "미리보기로"
                      : "편집 끝내기"}
                </button>
              </>
            )}
          </div>
        </div>

        <div
          className="flex flex-wrap gap-1 rounded-xl border border-ink-200 bg-ink-50 p-1 print:hidden"
          role="tablist"
          aria-label="보고서 작업 모드"
        >
          {(
            [
              { id: "view" as const, label: "보기" },
              { id: "body" as const, label: "본문" },
              { id: "factcheck" as const, label: "팩트체크" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={mode === tab.id}
              disabled={saving || rebuilding}
              onClick={() => {
                if (tab.id === "view" && editing) {
                  cancelEdit();
                  return;
                }
                if (tab.id !== "body" && editing) {
                  // 본문 편집 중 다른 탭 → 변경 버림 후 이동
                  flushDebouncedHistory();
                  setDraft(report);
                  resetHistory();
                  setSavedSections([]);
                  setSectionSavedFlash({});
                }
                setOpenFcKey(null);
                setMode(tab.id);
                if (tab.id === "body" && report) {
                  setSavedSections(report.sections.map(sectionSnapshot));
                }
              }}
              className={`min-h-10 flex-1 sm:flex-none rounded-lg px-4 text-sm font-medium transition-colors ${
                mode === tab.id
                  ? "bg-white text-ink-900 shadow-sm border border-ink-200"
                  : "text-ink-600 hover:text-ink-900"
              }`}
            >
              {tab.label}
            </button>
          ))}
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
          <p className="text-xs text-ink-500 print:hidden rounded-lg bg-ink-50 border border-ink-100 px-3 py-2 flex flex-wrap items-center gap-2">
            <span>
              {draftPhase
                ? "본문 탭 · 자동 저장됩니다. 수정한 본문은 팩트체크 완료 후 「보고서 만들기」 시 유지됩니다."
                : "본문 탭 · 입력 후 자동 저장됩니다. 「편집 끝내기」로 보기 탭으로 돌아갑니다."}
            </span>
            {autoSaveStatus === "pending" && (
              <span className="text-ink-400">저장 대기…</span>
            )}
            {autoSaveStatus === "saving" && (
              <span className="inline-flex items-center gap-1 text-ink-600">
                <Loader2 className="h-3 w-3 animate-spin" />
                자동 저장 중…
              </span>
            )}
            {autoSaveStatus === "saved" && (
              <span className="text-verify-true">자동 저장됨</span>
            )}
            {autoSaveStatus === "error" && (
              <span className="text-verify-false">자동 저장 실패 · 다시 입력하거나 편집 끝내기를 누르세요</span>
            )}
          </p>
        )}
        {factcheckMode && (
          <div className="print:hidden space-y-3">
            <p className="text-xs text-ink-500 rounded-lg bg-ink-50 border border-ink-100 px-3 py-2">
              팩트체크 탭입니다. DETAIL을 열어 답변·판정을 고칠 수 있습니다.
              {draftPhase
                ? " 여러 항목을 처음부터 다시 하려면 팩트체크 위저드에서 이어서 진행하세요."
                : " 여러 항목을 처음부터 다시 하려면 아래 「팩트체크 다시하기」를 쓰세요."}
            </p>
            {!draftPhase && <ReopenAsDraftButton videoId={localVideo.id} />}
          </div>
        )}

        <div
          className={`lg:grid lg:gap-4 lg:items-start ${
            mode === "view"
              ? ""
              : factcheckMode
                ? "lg:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)]"
                : "lg:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)]"
          }`}
        >
          {factcheckMode && (
            <div className="mt-0 lg:sticky lg:top-[calc(env(safe-area-inset-top,0px)+5rem)] print:hidden order-1">
              <ReportFactCheckToolbox
                video={localVideo}
                draft={draft}
                editing={false}
                activeSectionIdx={activeSectionIdx}
                busy={saving || rebuilding}
                onVideoUpdate={(v) => {
                  setLocalVideo(v);
                  if (v.report) setDraft(v.report);
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
          )}
          <div className={`min-w-0 space-y-5 ${factcheckMode ? "order-2" : ""}`}>
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
                <button
                  type="button"
                  onClick={() => {
                    setImportOpen((prev) => !prev);
                    setMode("body");
                  }}
                  className="inline-flex items-center gap-1 rounded-md border border-ink-200 bg-white px-2 py-1 text-xs font-medium text-ink-700 hover:border-accent hover:text-accent"
                >
                  정리본 붙여넣기
                </button>
              </div>
              <FormatToolbar
                canUndo={historyUi.canUndo}
                canRedo={historyUi.canRedo}
                onUndo={undoEdit}
                onRedo={redoEdit}
                onFontSize={applyFontSize}
                onFontSizeStep={stepActiveFontSize}
                onBold={() =>
                  runFormatCommand((ed) => {
                    ed.chain().focus().toggleBold().run();
                  })
                }
                onUnderline={() =>
                  runFormatCommand((ed) => {
                    ed.chain().focus().toggleUnderline().run();
                  })
                }
                onColor={(c) =>
                  runFormatCommand((ed) => {
                    ed.chain().focus().setColor(c).run();
                  })
                }
                onHighlight={(c) =>
                  runFormatCommand((ed) => {
                    ed.chain().focus().setHighlight({ color: c }).run();
                  })
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
                  focusActiveBodyEditor();
                  saveEditorSelection();
                }}
              />
            </div>

            {importOpen && (
              <div className="border-b border-ink-100 bg-amber-50/40 px-3 py-3 space-y-2">
                <p className="text-xs text-ink-700">
                  AI 정리본을 붙여넣으면 본문만 교체합니다.{" "}
                  <strong>`## 섹션 제목`</strong>,{" "}
                  <strong>`■ 총괄 요약`</strong>,{" "}
                  <strong>`제 N 장.`</strong> 형식을 인식합니다. 총괄 요약·1장·5장은
                  결론, 2~4장은 본문 섹션에 맞춰 반영됩니다. 이미지·팩트체크는
                  유지됩니다.
                </p>
                <textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  rows={10}
                  placeholder={
                    "## Executive Summary (총괄 요약)\n정리된 본문...\n\n## 제 2 장. 고지혈증과 콜레스테롤의 오해\n정리된 본문..."
                  }
                  className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-800 outline-none focus:border-accent"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={applyImportedReportText}
                    className="inline-flex items-center gap-1 rounded-md border border-accent/40 bg-accent px-3 py-1.5 text-sm font-medium text-white"
                  >
                    보고서에 반영
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setImportOpen(false);
                      setImportText("");
                    }}
                    className="inline-flex items-center gap-1 rounded-md border border-ink-200 bg-white px-3 py-1.5 text-sm font-medium text-ink-700"
                  >
                    닫기
                  </button>
                </div>
              </div>
            )}

            <div className="border-b border-ink-100 bg-ink-50/60 px-3 py-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-ink-700">
                  이미지 룸 · 재사용 보관함
                </p>
                <button
                  type="button"
                  onClick={() =>
                    (
                      document.getElementById("report-room-upload") as
                        | HTMLInputElement
                        | null
                    )?.click()
                  }
                  disabled={imageRoomBusy}
                  className="inline-flex items-center gap-1 rounded-md border border-ink-200 bg-white px-2 py-1 text-xs font-medium text-ink-700 disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {imageRoomBusy ? "업로드 중…" : "이미지 룸에 추가"}
                </button>
              </div>
              <input
                id="report-room-upload"
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  void addImagesToRoom(Array.from(e.target.files ?? []));
                  e.target.value = "";
                }}
              />
              {imageRoom.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {imageRoom.map((room) => (
                    <div
                      key={`room-${room.url.slice(0, 64)}`}
                      className="rounded-lg border border-ink-200 bg-white p-1.5 space-y-1"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={room.url}
                        alt=""
                        className="h-20 w-full rounded-md object-cover bg-ink-100"
                      />
                      <div className="space-y-1">
                        <select
                          value={room.tag ?? ""}
                          onChange={(e) =>
                            updateRoomMeta(room.url, { tag: e.target.value || undefined })
                          }
                          className="w-full rounded-md border border-ink-200 px-1.5 py-1 text-[11px] text-ink-700"
                        >
                          <option value="">태그 없음</option>
                          {ROOM_TAGS.map((tag) => (
                            <option key={tag} value={tag}>
                              {tag}
                            </option>
                          ))}
                        </select>
                        <input
                          value={room.note ?? ""}
                          onChange={(e) =>
                            updateRoomMeta(room.url, { note: e.target.value })
                          }
                          placeholder="메모"
                          className="w-full rounded-md border border-ink-200 px-1.5 py-1 text-[11px] text-ink-700"
                        />
                      </div>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => addRoomImageToActiveSection(room.url)}
                          className="flex-1 rounded-md border border-accent/40 bg-accent-muted/40 px-1.5 py-1 text-[11px] font-medium text-accent"
                        >
                          현재 섹션에 넣기
                        </button>
                        <button
                          type="button"
                          onClick={() => removeImageFromRoom(room.url)}
                          className="rounded-md border border-ink-200 px-1.5 py-1 text-[11px] text-ink-500"
                          title="룸에서 제거"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-ink-500">
                  본문/팩트체크에서 사용한 이미지가 자동으로 모이며, 여기서 현재
                  섹션으로 다시 넣을 수 있습니다.
                </p>
              )}
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
                      editorKey={sectionEditKey(sec, idx)}
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

            <div className="border-t border-ink-100 p-3 space-y-2">
              <button
                type="button"
                onClick={addFlowSection}
                className="inline-flex items-center gap-1.5 min-h-11 w-full justify-center rounded-xl border border-accent/40 bg-accent-muted/40 text-sm font-medium text-accent hover:bg-accent-muted"
              >
                <Plus className="h-4 w-4" />
                본문 흐름용 섹션 추가 (핵심 설명 + 대표 이미지)
              </button>
              <button
                type="button"
                onClick={() => addSection()}
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
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-medium text-accent text-lg">{sec.heading}</h3>
                  <div className="flex flex-wrap gap-1 print:hidden">
                    <button
                      type="button"
                      onClick={() =>
                        void copyToClipboard(
                          formatSectionText(draft, idx),
                          "현재 섹션"
                        )
                      }
                      className="rounded-md border border-ink-200 bg-white px-2 py-1 text-xs font-medium text-ink-600 hover:border-accent hover:text-accent"
                    >
                      섹션 text 복사
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void copyToClipboard(
                          [formatSectionText(draft, idx), formatFactChecksText(draft)]
                            .filter(Boolean)
                            .join("\n\n"),
                          "섹션+팩트체크"
                        )
                      }
                      className="rounded-md border border-ink-200 bg-white px-2 py-1 text-xs font-medium text-ink-600 hover:border-accent hover:text-accent"
                    >
                      섹션+FC 복사
                    </button>
                  </div>
                </div>

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
                          {isOpen && mode === "view" && (
                            <div className="mt-2 ml-8">
                              <FactCheckDetailPanel
                                presentation="inline"
                                label={`F${m.n}`}
                                statementFallback={m.entry.text}
                                itemId={m.entry.itemId}
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
                                entry={m.entry}
                                videoId={localVideo.id}
                                capabilities={{
                                  edit: false,
                                  clearDetail: true,
                                  deleteAll: true,
                                }}
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
                  mode === "view" &&
                  openMarker.sectionIdx === idx &&
                  !unmatched.some((m) => m.key === openMarker.key) && (
                    <div className="print:hidden">
                      <FactCheckDetailPanel
                        presentation="inline"
                        label={`F${openMarker.n}`}
                        statementFallback={openMarker.entry.text}
                        itemId={openMarker.entry.itemId}
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
                        entry={openMarker.entry}
                        videoId={localVideo.id}
                        capabilities={{
                          edit: false,
                          clearDetail: true,
                          deleteAll: true,
                        }}
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
                  <details className="space-y-2 print:hidden">
                    <summary className="cursor-pointer select-none text-xs text-ink-500 rounded-md border border-ink-200 bg-ink-50 px-2.5 py-1.5 hover:border-accent">
                      관련 이미지 {reportFcImages.length}장
                    </summary>
                    <div className="space-y-2 pt-1">
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
                  </details>
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
        {openMarker && (editing || factcheckMode) && (
          <FactCheckDetailPanel
            presentation="modal"
            label={`F${openMarker.n}`}
            statementFallback={openMarker.entry.text}
            itemId={openMarker.entry.itemId}
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
            entry={openMarker.entry}
            videoId={localVideo.id}
            busy={saving || rebuilding}
            capabilities={{
              edit: true,
              pasteToSection: editing,
              unlink: editing,
              clearDetail: true,
              deleteAll: true,
            }}
            onClose={() => setOpenFcKey(null)}
            onPasteText={
              editing
                ? (html) => {
                    pasteFcHtmlToActiveSection(html);
                    setOpenFcKey(null);
                  }
                : undefined
            }
            onPasteImages={
              editing
                ? (urls) => {
                    pasteFcImagesToActiveSection(urls);
                    setOpenFcKey(null);
                  }
                : undefined
            }
            onUnlink={
              editing
                ? () => {
                    deleteEntry(openMarker.sectionIdx, openMarker.entryIdx);
                  }
                : undefined
            }
            onVideoUpdate={(v) => {
              setLocalVideo(v);
              if (v.report) setDraft(v.report);
              router.refresh();
            }}
          />
        )}
          </div>

          {editing && (
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
          )}
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
