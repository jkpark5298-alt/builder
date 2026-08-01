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
  ClipboardPaste,
  Home,
  ImagePlus,
  Loader2,
  Plus,
  Save,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type {
  LibraryImage,
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
  collectSectionImages as collectSectionImagesFromRoom,
  normalizeRoomItems,
  normalizeReportImageRefs,
  upsertRoomUrls,
} from "@/lib/report-images";
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
import { ImageLibraryPicker } from "@/components/ImageLibraryPicker";
import { ReopenAsDraftButton } from "@/components/ReopenAsDraftButton";
import { resolveAnswerParts } from "@/lib/answer-parts";
import {
  formatFactChecksText,
  formatSectionText,
  importReportText,
  inspectImportedReportText,
  mergeReportSectionsToSingleBody,
  normalizeAiReportPaste,
  replaceAllReportBodies,
  sanitizeAiPasteText,
} from "@/lib/report";
import {
  appendTrailingSMarker,
  countTrailingSMarkers,
  htmlWithSImages,
  parseBodySImageSlots,
} from "@/lib/report-body-s-slots";

type ReportWorkMode = "view" | "body" | "factcheck";
type RoomImageItem = ReturnType<typeof normalizeRoomItems>[number];
const ROOM_TAGS = ["도입", "핵심", "근거", "결론", "F1", "F2", "F3", "기타"] as const;

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
  const [draft, setDraft] = useState<TypedReport | null>(
    report ? normalizeReportImageRefs(report) : report
  );
  const [openFcKey, setOpenFcKey] = useState<string | null>(null);
  const [handwritingFor, setHandwritingFor] = useState<number | null>(null);
  const [textImageFor, setTextImageFor] = useState<number | null>(null);
  const [activeSectionIdx, setActiveSectionIdx] = useState(0);
  const [rebuilding, setRebuilding] = useState(false);
  const [imageRoomBusy, setImageRoomBusy] = useState(false);
  const [libraryPickerOpen, setLibraryPickerOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  /** 툴바·S슬롯 Ctrl+V 대기: 섹션 + S 슬롯 인덱스 */
  const [armedSSlot, setArmedSSlot] = useState<{
    secIdx: number;
    slotIdx: number;
  } | null>(null);
  const [imagePasteHint, setImagePasteHint] = useState<string | null>(null);
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

  useEffect(() => {
    setDraft(report ? normalizeReportImageRefs(report) : report);
  }, [report]);

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
    // 본문 편집 중에는 서버 report 로 draft 를 덮지 않음
    // (TipTap 포커스 중 화면과 draft 가 어긋나 S 슬롯이 안 뜨는 문제 방지)
    if (mode === "body") return;
    setDraft(report ? normalizeReportImageRefs(report) : report);
  }, [report, mode]);

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
        const toSave = stabilizeReportFcAnchors(current);
        const sentSnap = JSON.stringify(toSave);
        setAutoSaveStatus("saving");
        try {
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
            // 저장 요청 보낸 뒤 사용자가 더 타이핑했으면 draft 유지
            const stillSame =
              JSON.stringify(draftRef.current) === sentSnap;
            if (stillSame) {
              setDraft(data.video.report);
              setSavedSections(
                data.video.report.sections.map(sectionSnapshot)
              );
            }
            setLocalVideo(data.video);
          }
          setAutoSaveStatus("saved");
        } catch {
          setAutoSaveStatus("error");
        }
      })();
    }, 1600);

    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [draft, mode, video.id]);

  function goBodyMode() {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = mergeReportSectionsToSingleBody(prev);
      queueMicrotask(() => {
        setSavedSections(next.sections.map(sectionSnapshot));
        setActiveSectionIdx(0);
      });
      return next;
    });
    setActiveSectionIdx(0);
    setMode("body");
  }

  useEffect(() => {
    function enterBody() {
      goBodyMode();
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
          ...collectSectionImagesFromRoom(sec, draft.imageRoom),
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

  function applyImportedReportText(mode: "merge" | "replaceAll" = "merge") {
    const current = draftRef.current;
    if (!current) return;
    let text = sanitizeAiPasteText(importText);
    if (text !== importText.trim()) setImportText(text);
    let cleanedTried = false;
    const run = (src: string) =>
      mode === "replaceAll"
        ? replaceAllReportBodies(current, src)
        : importReportText(current, src);

    let next = run(text);
    if (next === current) {
      const cleaned = normalizeAiReportPaste(text);
      if (cleaned && cleaned !== text.trim()) {
        cleanedTried = true;
        text = cleaned;
        setImportText(cleaned);
        next = run(cleaned);
      }
    }
    if (next === current) {
      const info = inspectImportedReportText(text);
      const parsed =
        info.count > 0
          ? `읽은 섹션 ${info.count}개: ${info.headings.join(" / ")}`
          : "읽은 섹션이 없습니다. 「AI 답변 정리」 후 `##` 형식을 확인해 주세요.";
      alert(`붙여넣은 텍스트를 반영하지 못했습니다.\n\n${parsed}`);
      return;
    }
    setDraft(mergeReportSectionsToSingleBody(next));
    setImportOpen(false);
    setImportText("");
    setActiveSectionIdx(0);
    setMode("body");
    alert(
      mode === "replaceAll"
        ? "본문을 반영했습니다. 팩트체크·이미지룸은 유지됩니다."
        : cleanedTried
          ? "AI 정리 후 본문에 반영했습니다. 이미지와 팩트체크는 유지됩니다."
          : "본문에 반영했습니다. 이미지와 팩트체크는 유지됩니다."
    );
  }

  function normalizeImportPaste() {
    const cleaned = normalizeAiReportPaste(importText);
    if (!cleaned.trim()) {
      alert("정리할 내용이 없습니다.");
      return;
    }
    setImportText(cleaned);
    const info = inspectImportedReportText(cleaned);
    alert(
      info.count > 0
        ? `AI 답변 정리 완료 · 섹션 ${info.count}개 인식: ${info.headings.join(" / ")}`
        : "정리했습니다. `## 섹션 제목`이 보이는지 확인한 뒤 반영하세요."
    );
  }

  /** 본문 S 슬롯(0-based)에 이미지 설정 — 섹션 분할 없음 */
  async function addImagesToSSlot(
    secIdx: number,
    slotIdx: number,
    files: File[]
  ) {
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    if (!imageFiles.length) return;
    try {
      const dataUrls = await compressImageFiles(imageFiles);
      if (!dataUrls.length) return;
      const uploaded = await uploadDataUrls(
        dataUrls,
        `videos/${video.id}/report-s${secIdx}-${slotIdx}`
      );
      if (!uploaded.length) return;
      updateDraft((prev) => {
        const sec = prev.sections[secIdx];
        if (!sec) return prev;
        const slotCount = Math.max(
          slotIdx + 1,
          countTrailingSMarkers(sec.body || "")
        );
        const ordered = slotUrlsForSectionFrom(sec, prev.imageRoom, slotCount);
        ordered[slotIdx] = uploaded[0]!;
        const filled = ordered.filter(Boolean);
        const { room } = upsertRoomUrls(prev.imageRoom, filled);
        const refByUrl = new Map(
          normalizeRoomItems(room).map((it) => [it.url, it.id])
        );
        const imageRefs = ordered
          .map((u) => (u ? refByUrl.get(u) : undefined))
          .filter(Boolean) as string[];
        const sections = [...prev.sections];
        sections[secIdx] = {
          ...sec,
          imageUrl: undefined,
          images: ordered,
          imageRefs: imageRefs.length ? imageRefs : undefined,
        };
        return { ...prev, imageRoom: room, sections };
      }, { history: "immediate" });
      setArmedSSlot(null);
      setImagePasteHint(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "이미지 추가에 실패했습니다.");
    }
  }

  function clearSSlotImage(secIdx: number, slotIdx: number) {
    updateDraft((prev) => {
      const sec = prev.sections[secIdx];
      if (!sec) return prev;
      const slotCount = countTrailingSMarkers(sec.body || "");
      if (!slotCount) return prev;
      const ordered = slotUrlsForSectionFrom(sec, prev.imageRoom, slotCount);
      ordered[slotIdx] = "";
      const filled = ordered.filter(Boolean);
      const { room } = upsertRoomUrls(prev.imageRoom, filled);
      const refByUrl = new Map(
        normalizeRoomItems(room).map((it) => [it.url, it.id])
      );
      const imageRefs = ordered
        .map((u) => (u ? refByUrl.get(u) : undefined))
        .filter(Boolean) as string[];
      const sections = [...prev.sections];
      sections[secIdx] = {
        ...sec,
        imageUrl: undefined,
        images: ordered,
        imageRefs: imageRefs.length ? imageRefs : undefined,
      };
      return { ...prev, imageRoom: room, sections };
    }, { history: "immediate" });
  }

  function slotUrlsForSectionFrom(
    sec: ReportSectionBlock,
    room: TypedReport["imageRoom"] | undefined,
    slotCount: number
  ): string[] {
    const out: string[] = Array.from({ length: slotCount }, () => "");
    const stored = sec.images;
    if (stored && stored.length) {
      for (let i = 0; i < slotCount; i++) {
        out[i] = (stored[i] || "").trim();
      }
      return out;
    }
    const items = normalizeRoomItems(room);
    const byId = new Map(items.map((it) => [it.id, it.url]));
    const refs = sec.imageRefs ?? [];
    for (let i = 0; i < slotCount; i++) {
      const id = refs[i];
      out[i] = (id && byId.get(id)) || "";
    }
    return out;
  }

  function slotUrlsForSection(
    sec: ReportSectionBlock,
    slotCount: number
  ): string[] {
    return slotUrlsForSectionFrom(sec, draft?.imageRoom, slotCount);
  }

  const resolveActiveTipTap = useCallback(() => {
    const sec = draftRef.current?.sections[activeSectionIdx];
    if (sec) {
      const key = sectionEditKey(sec, activeSectionIdx);
      const byKey = getReportEditor(key);
      if (byKey) return { editor: byKey, idx: activeSectionIdx };
      const segLen = Math.max(
        1,
        parseBodySImageSlots(sec.body || "").segments.length
      );
      for (let g = 0; g < segLen + 2; g++) {
        const segEd = getReportEditor(`${key}-seg-${g}`);
        if (segEd?.isFocused) {
          return { editor: segEd, idx: activeSectionIdx };
        }
      }
    }
    const active = getActiveReportEditor();
    if (active) {
      const sections = draftRef.current?.sections ?? [];
      for (let i = 0; i < sections.length; i++) {
        const s = sections[i]!;
        const base = sectionEditKey(s, i);
        if (getReportEditor(base) === active) {
          return { editor: active, idx: i };
        }
        const segLen = Math.max(
          1,
          parseBodySImageSlots(s.body || "").segments.length
        );
        for (let g = 0; g < segLen + 2; g++) {
          if (getReportEditor(`${base}-seg-${g}`) === active) {
            return { editor: active, idx: i };
          }
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
      let working = draft;
      // S 는 섹션 분할이 아니라 본문 이미지 위치 표시 — 자동 분할하지 않음
      const toSave = stabilizeReportFcAnchors(working);
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
      const { room } = upsertRoomUrls(prev.imageRoom, urls);
      if (room.length === normalizeRoomItems(prev.imageRoom).length) return prev;
      return { ...prev, imageRoom: room };
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
    updateDraft((prev) => {
      const room = normalizeRoomItems(prev.imageRoom);
      const removed = room.find((u) => u.url === src);
      if (!removed) return prev;
      return {
        ...prev,
        imageRoom: room.filter((u) => u.url !== src),
        sections: prev.sections.map((sec) => ({
          ...sec,
          imageRefs: sec.imageRefs?.filter((ref) => ref !== removed.id),
        })),
      };
    });
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
    const sec = draft?.sections[idx];
    if (!countTrailingSMarkers(sec?.body || "")) {
      setImagePasteHint(
        "이미지 넣을 문장 끝에 S 를 붙인 뒤 「현재 섹션에 넣기」를 누르세요. (예: …이다.S)"
      );
      return;
    }
    applyUrlsToSSlots(idx, [src]);
  }

  function pickLibraryImageIntoReport(img: LibraryImage) {
    updateDraft((prev) => {
      const { room, refs } = upsertRoomUrls(prev.imageRoom, [img.url]);
      const withMeta = room.map((it) =>
        it.url === img.url
          ? {
              ...it,
              note: img.memo || it.note,
              tag: img.tag || it.tag,
            }
          : it
      );
      const idx = Math.min(
        Math.max(0, activeSectionIdx),
        Math.max(0, prev.sections.length - 1)
      );
      return {
        ...prev,
        imageRoom: withMeta,
        sections: prev.sections.map((sec, i) =>
          i === idx
            ? {
                ...sec,
                imageRefs: Array.from(
                  new Set([...(sec.imageRefs ?? []), ...refs])
                ),
              }
            : sec
        ),
      };
    }, { history: "immediate" });
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

  function applyUrlsToSSlots(secIdx: number, urls: string[]) {
    if (!urls.length) return;
    updateDraft((prev) => {
      const sec = prev.sections[secIdx];
      if (!sec) return prev;
      const slotCount = countTrailingSMarkers(sec.body || "");
      if (!slotCount) {
        return prev;
      }
      const ordered = slotUrlsForSectionFrom(sec, prev.imageRoom, slotCount);
      let ui = 0;
      for (let i = 0; i < slotCount && ui < urls.length; i++) {
        if (!ordered[i]) {
          ordered[i] = urls[ui++]!;
        }
      }
      // 남은 URL은 마지막 슬롯부터 덮어쓰지 않고, 빈 칸이 없으면 끝 슬롯에 추가 표시용으로 images 뒤에
      while (ui < urls.length) {
        ordered.push(urls[ui++]!);
      }
      const filled = ordered.filter(Boolean);
      const { room } = upsertRoomUrls(prev.imageRoom, filled);
      const refByUrl = new Map(
        normalizeRoomItems(room).map((it) => [it.url, it.id])
      );
      const imageRefs = ordered
        .map((u) => (u ? refByUrl.get(u) : undefined))
        .filter(Boolean) as string[];
      const sections = [...prev.sections];
      sections[secIdx] = {
        ...sec,
        imageUrl: undefined,
        images: ordered,
        imageRefs: imageRefs.length ? imageRefs : undefined,
      };
      return { ...prev, imageRoom: room, sections };
    }, { history: "immediate" });
  }

  function pasteFcImagesToActiveSection(urls: string[]) {
    if (!draft || !urls.length) return;
    if (!editing) setMode("body");
    const idx = Math.min(
      Math.max(0, activeSectionIdx),
      Math.max(0, draft.sections.length - 1)
    );
    const sec = draft.sections[idx];
    if (!countTrailingSMarkers(sec?.body || "")) {
      setImagePasteHint(
        "이미지 넣을 문장 끝에 S 를 붙인 뒤 다시 붙여넣으세요."
      );
      return;
    }
    applyUrlsToSSlots(idx, urls);
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

  async function pasteImagesToSection(idx: number) {
    if (!editing) {
      setMode("body");
    }
    setActiveSectionIdx(idx);
    const sec = draftRef.current?.sections[idx];
    const slotCount = countTrailingSMarkers(sec?.body || "");
    if (!slotCount) {
      setImagePasteHint(
        "이미지 넣을 문장 끝에 S 를 붙이세요. 예: …이다. S  → 아래에 칸이 열립니다"
      );
      return;
    }
    const urls = slotUrlsForSection(sec!, slotCount);
    const emptyIdx = urls.findIndex((u) => !u);
    const slotIdx = emptyIdx >= 0 ? emptyIdx : 0;
    setArmedSSlot({ secIdx: idx, slotIdx });
    setImagePasteHint(
      "이미지를 복사한 뒤 지금 Ctrl+V 하세요. 또는 파일 버튼을 누르세요."
    );
    window.setTimeout(() => {
      (
        document.getElementById(
          "s-slot-paste-" + idx + "-" + slotIdx
        ) as HTMLTextAreaElement | null
      )?.focus();
    }, 50);
    try {
      const files = await readImagesFromClipboard();
      if (files.length) {
        await addImagesToSSlot(idx, slotIdx, files);
      }
    } catch {
      /* Ctrl+V 대기 */
    }
  }

  function handleSectionPaste(idx: number, e: React.ClipboardEvent) {
    if (!editing) return;
    const files = extractImageFilesFromDataTransfer(e.clipboardData);
    if (files.length) {
      e.preventDefault();
      e.stopPropagation();
      const slotCount = countTrailingSMarkers(
        draftRef.current?.sections[idx]?.body || ""
      );
      if (!slotCount) {
        setImagePasteHint(
          "문장 끝에 S 를 붙인 뒤에만 이미지를 넣을 수 있습니다."
        );
        return;
      }
      const slotIdx =
        armedSSlot?.secIdx === idx ? armedSSlot.slotIdx : 0;
      void addImagesToSSlot(idx, Math.min(slotIdx, slotCount - 1), files);
      return;
    }

    const target = e.target as HTMLElement | null;
    const isPasteCapture =
      target instanceof HTMLTextAreaElement &&
      target.id.startsWith("s-slot-paste-" + idx + "-");
    if (isPasteCapture) return;

    const isPlainTextField =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target?.closest("input, textarea");
    if (isPlainTextField) return;

    const inBody = findReportBodyEditor(target as Node);
    if (!inBody) {
      e.preventDefault();
      setActiveSectionIdx(idx);
      focusActiveBodyEditor();
    }
  }

  useEffect(() => {
    if (!armedSSlot) return;
    const { secIdx, slotIdx } = armedSSlot;
    const onWin = (e: ClipboardEvent) => {
      if (!e.clipboardData) return;
      const files = extractImageFilesFromDataTransfer(e.clipboardData);
      if (!files.length) return;
      e.preventDefault();
      void addImagesToSSlot(secIdx, slotIdx, files);
    };
    window.addEventListener("paste", onWin, true);
    return () => window.removeEventListener("paste", onWin, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armedSSlot]);

  async function insertHandwriting(idx: number, dataUrl: string) {
    try {
      const [url] = await uploadDataUrls(
        [dataUrl],
        `videos/${video.id}/report`
      );
      if (!url) return;
      if (!countTrailingSMarkers(draftRef.current?.sections[idx]?.body || "")) {
        alert("이미지 넣을 문장 끝에 S 를 붙인 뒤 손글씨를 넣으세요.");
        return;
      }
      applyUrlsToSSlots(idx, [url]);
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
      if (!url) return;
      if (!countTrailingSMarkers(draftRef.current?.sections[idx]?.body || "")) {
        alert("이미지 넣을 문장 끝에 S 를 붙인 뒤 텍스트 이미지를 넣으세요.");
        return;
      }
      applyUrlsToSSlots(idx, [url]);
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
    let editor =
      (key ? getReportEditor(key) : null) ||
      getActiveReportEditor() ||
      null;
    if (!editor && key && sec) {
      const segLen = Math.max(
        1,
        parseBodySImageSlots(sec.body || "").segments.length
      );
      for (let g = 0; g < segLen; g++) {
        const segEd = getReportEditor(`${key}-seg-${g}`);
        if (segEd) {
          editor = segEd;
          break;
        }
      }
    }
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
                if (tab.id === "body") {
                  goBodyMode();
                  return;
                }
                setMode(tab.id);
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
                ? "본문 탭 · 자동 저장됩니다. 수정한 본문은 팩트체크 완료 후 「보고서 만들기」 시 유지됩니다. 이미지 필요 문장 끝에 S 를 붙이면 칸이 열립니다."
                : "본문 탭 · 입력 후 자동 저장됩니다. 이미지 필요 문장 끝에 S 를 붙이면 칸이 열리고, 없으면 텍스트만 보입니다."}
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
                  const sec = draftRef.current?.sections[activeSectionIdx];
                  const slotCount = countTrailingSMarkers(sec?.body || "");
                  if (!slotCount) {
                    setImagePasteHint(
                      "이미지 넣을 문장 끝에 S 를 붙이세요. 예: …이다. S"
                    );
                    return;
                  }
                  const urls = slotUrlsForSection(sec!, slotCount);
                  const slotIdx = Math.max(
                    0,
                    urls.findIndex((u) => !u)
                  );
                  const emptyIdx = urls.findIndex((u) => !u);
                  const target =
                    emptyIdx >= 0 ? emptyIdx : Math.min(slotIdx, slotCount - 1);
                  setArmedSSlot({
                    secIdx: activeSectionIdx,
                    slotIdx: target,
                  });
                  (
                    document.getElementById(
                      `s-slot-img-${activeSectionIdx}-${target}`
                    ) as HTMLInputElement | null
                  )?.click();
                }}
                onPasteImage={() => {
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
              {imagePasteHint && (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                  {imagePasteHint}
                </p>
              )}
            </div>

            {importOpen && (
              <div className="border-b border-ink-100 bg-amber-50/40 px-3 py-3 space-y-2">
                <p className="text-xs text-ink-700">
                  여기는 텍스트만 붙입니다. 이미지 넣을 문장{" "}
                  <strong>끝에 S</strong> 를 적어 두고(예:{" "}
                  <code className="text-[11px]">…기원이다. S</code>
                  ) 「전체 본문 교체」한 뒤, 본문 아래 칸 또는 이미지 룸의
                  「현재 섹션에 넣기」로 그림을 넣으세요. 보기 화면에는 S 가
                  보이지 않습니다.
                </p>
                <textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  rows={10}
                  placeholder={
                    "## 핵심 결론\n정리된 본문...\n\n## 항목별 팩트체크\n1. 주장 (판정: 사실)\n- 근거(출처): …"
                  }
                  className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-800 outline-none focus:border-accent"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={!importText.trim()}
                    onClick={normalizeImportPaste}
                    className="inline-flex items-center gap-1 rounded-md border border-accent/40 bg-accent-muted/40 px-3 py-1.5 text-sm font-medium text-ink-900 hover:bg-accent-muted disabled:opacity-50"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    AI 답변 정리
                  </button>
                  <button
                    type="button"
                    disabled={!importText.trim()}
                    onClick={() => applyImportedReportText("merge")}
                    className="inline-flex items-center gap-1 rounded-md border border-ink-200 bg-white px-3 py-1.5 text-sm font-medium text-ink-800 disabled:opacity-50"
                  >
                    보고서에 반영
                  </button>
                  <button
                    type="button"
                    disabled={!importText.trim()}
                    onClick={() => {
                      if (
                        !confirm(
                          "기존 섹션 제목·본문을 지우고, 붙여넣은 ## 섹션으로 전체를 바꿀까요?\n(팩트체크·이미지룸은 유지)"
                        )
                      ) {
                        return;
                      }
                      applyImportedReportText("replaceAll");
                    }}
                    className="inline-flex items-center gap-1 rounded-md border border-accent/40 bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    전체 본문 교체
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
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-xs font-medium text-ink-700">
                  이미지 룸 · 재사용 보관함
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setLibraryPickerOpen(true)}
                    className="inline-flex items-center gap-1 rounded-md border border-accent/40 bg-accent-muted/40 px-2 py-1 text-xs font-medium text-ink-900"
                  >
                    이미지 빠른 넣기 (Ctrl+V)
                  </button>
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
                    {imageRoomBusy ? "업로드 중…" : "룸에만 추가"}
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-ink-500">
                <strong>홈으로 나가지 마세요.</strong> 「이미지 빠른 넣기」에서
                Ctrl+V·파일로 바로 현재 섹션에 붙입니다. 섹션을 선택한 뒤
                붙여넣기도 됩니다.
              </p>
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

            <div className="p-4 sm:p-5">
              {draft.sections.map((sec, idx) => {
                const sectionMarkers = markers.filter(
                  (m) => m.sectionIdx === idx
                );
                const { segments: sSegments, slotCount: sSlotCount } =
                  parseBodySImageSlots(sec.body || "");
                const slotUrls = slotUrlsForSection(sec, sSlotCount);

                return (
                  <div
                    key={sectionEditKey(sec, idx)}
                    className="space-y-3"
                    onPaste={(e) => handleSectionPaste(idx, e)}
                    onFocusCapture={() => setActiveSectionIdx(idx)}
                  >
                    {/* S 위치마다 본문 조각 → 이미지 칸 순으로 배치 */}
                    {(sSegments.length
                      ? sSegments
                      : [
                          {
                            html: sec.body || "<p></p>",
                            hasSlot: false,
                            preview: "",
                          },
                        ]
                    ).map((seg, segIdx) => {
                      const slotIdxBefore = sSegments
                        .slice(0, segIdx)
                        .filter((s) => s.hasSlot).length;
                      const slotIdx = seg.hasSlot ? slotIdxBefore : -1;
                      const src =
                        slotIdx >= 0 ? slotUrls[slotIdx] || "" : "";
                      const armed =
                        slotIdx >= 0 &&
                        armedSSlot?.secIdx === idx &&
                        armedSSlot.slotIdx === slotIdx;
                      const baseKey = sectionEditKey(sec, idx);
                      const editorKey =
                        sSlotCount > 0
                          ? `${baseKey}-seg-${segIdx}`
                          : baseKey;

                      return (
                        <div
                          key={`${baseKey}-block-${segIdx}`}
                          className="space-y-2"
                        >
                          <RichBody
                            id={
                              segIdx === 0 && sec.sectionId
                                ? `sec-body-${sec.sectionId}`
                                : undefined
                            }
                            editorKey={editorKey}
                            html={seg.html || "<p></p>"}
                            onSaveSelection={saveEditorSelection}
                            onFocus={() => setActiveSectionIdx(idx)}
                            onChange={(html) => {
                              if (sSlotCount === 0) {
                                patchSection(
                                  idx,
                                  { body: html, rich: true },
                                  "debounced"
                                );
                                return;
                              }
                              const body = sSegments
                                .map((s, i) => {
                                  if (i !== segIdx) {
                                    return s.hasSlot
                                      ? appendTrailingSMarker(s.html)
                                      : s.html || "<p></p>";
                                  }
                                  // 이 조각에 S 를 새로 쓰면 그대로 두고, 아니면 기존 슬롯 유지
                                  if (countTrailingSMarkers(html) > 0) {
                                    return html;
                                  }
                                  return s.hasSlot
                                    ? appendTrailingSMarker(html)
                                    : html;
                                })
                                .join("");
                              patchSection(
                                idx,
                                { body, rich: true },
                                "debounced"
                              );
                            }}
                          />

                          {seg.hasSlot && slotIdx >= 0 && (
                            <div
                              className={`rounded-xl border border-dashed px-3 py-2.5 space-y-2 ${
                                armed
                                  ? "border-accent bg-accent-muted/35"
                                  : "border-ink-200 bg-ink-50/60"
                              }`}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-xs font-medium text-ink-800">
                                  이미지 {slotIdx + 1}
                                  {seg.preview
                                    ? ` · ${seg.preview}${
                                        seg.preview.length >= 40 ? "…" : ""
                                      }`
                                    : ""}
                                  {src ? "" : " · 비어 있음"}
                                </p>
                                <div className="flex flex-wrap gap-1.5">
                                  <input
                                    id={`s-slot-img-${idx}-${slotIdx}`}
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    onChange={(e) => {
                                      void addImagesToSSlot(
                                        idx,
                                        slotIdx,
                                        Array.from(e.target.files ?? [])
                                      );
                                      e.target.value = "";
                                    }}
                                  />
                                  <button
                                    type="button"
                                    title="파일에서 이미지"
                                    onClick={() => {
                                      setActiveSectionIdx(idx);
                                      setArmedSSlot({
                                        secIdx: idx,
                                        slotIdx,
                                      });
                                      (
                                        document.getElementById(
                                          `s-slot-img-${idx}-${slotIdx}`
                                        ) as HTMLInputElement | null
                                      )?.click();
                                    }}
                                    className="inline-flex items-center justify-center min-h-9 min-w-9 rounded-lg border border-ink-200 bg-white text-ink-700 hover:border-accent"
                                  >
                                    <ImagePlus className="h-4 w-4" />
                                  </button>
                                  <button
                                    type="button"
                                    title="클립보드에서 붙여넣기"
                                    onClick={() => {
                                      setActiveSectionIdx(idx);
                                      setArmedSSlot({
                                        secIdx: idx,
                                        slotIdx,
                                      });
                                      setImagePasteHint(
                                        "이미지를 복사한 뒤 지금 Ctrl+V 하세요."
                                      );
                                      window.setTimeout(() => {
                                        (
                                          document.getElementById(
                                            `s-slot-paste-${idx}-${slotIdx}`
                                          ) as HTMLTextAreaElement | null
                                        )?.focus();
                                      }, 50);
                                      void (async () => {
                                        try {
                                          const files =
                                            await readImagesFromClipboard();
                                          if (files.length) {
                                            await addImagesToSSlot(
                                              idx,
                                              slotIdx,
                                              files
                                            );
                                          }
                                        } catch {
                                          /* Ctrl+V 대기 */
                                        }
                                      })();
                                    }}
                                    className={`inline-flex items-center gap-1 min-h-9 rounded-lg border px-2.5 text-xs font-medium ${
                                      armed
                                        ? "border-accent bg-accent-muted/50 text-ink-900"
                                        : "border-ink-200 bg-white text-ink-700 hover:border-accent"
                                    }`}
                                  >
                                    <ClipboardPaste className="h-3.5 w-3.5" />
                                    붙여넣기
                                  </button>
                                </div>
                              </div>
                              <textarea
                                id={`s-slot-paste-${idx}-${slotIdx}`}
                                aria-label={`이미지 ${slotIdx + 1} 붙여넣기`}
                                rows={1}
                                placeholder="여기 클릭 후 Ctrl+V"
                                className="w-full rounded-lg border border-ink-200 bg-white px-2 py-1.5 text-xs text-ink-500 outline-none focus:border-accent"
                                onFocus={() => {
                                  setActiveSectionIdx(idx);
                                  setArmedSSlot({ secIdx: idx, slotIdx });
                                  setImagePasteHint(
                                    "지금 Ctrl+V로 이미지를 붙여넣으세요."
                                  );
                                }}
                                onPaste={(e) => {
                                  const files =
                                    extractImageFilesFromDataTransfer(
                                      e.clipboardData
                                    );
                                  if (!files.length) return;
                                  e.preventDefault();
                                  void addImagesToSSlot(
                                    idx,
                                    slotIdx,
                                    files
                                  );
                                }}
                                onInput={(e) => {
                                  (e.target as HTMLTextAreaElement).value =
                                    "";
                                }}
                              />
                              {armed && !src && (
                                <p className="text-[11px] text-amber-800">
                                  Ctrl+V 대기 중
                                </p>
                              )}
                              {src ? (
                                <div className="relative overflow-hidden rounded-xl border border-ink-100">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={src}
                                    alt=""
                                    className="w-full max-h-72 object-contain object-left bg-white"
                                  />
                                  <button
                                    type="button"
                                    className="absolute top-2 right-2 rounded-lg bg-white/90 border border-ink-200 p-1.5"
                                    onClick={() =>
                                      clearSSlotImage(idx, slotIdx)
                                    }
                                  >
                                    <X className="h-4 w-4" />
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          )}
                        </div>
                      );
                    })}

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
              <div className="rounded-xl border border-ink-200 bg-ink-50 px-3 py-2 text-xs text-ink-700">
                본문은 하나의 글로 편집합니다. 이미지가 필요하면 문장 끝에{" "}
                <strong>S</strong> 를 붙이세요. S 가 있는 곳에만 칸이 열리고,
                없으면 텍스트만 보입니다.
              </div>
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
            const sSlotCount = countTrailingSMarkers(sec.body || "");
            const slotUrls = slotUrlsForSection(sec, sSlotCount);
            const sectionOwn = new Set(slotUrls.filter(Boolean));
            const reportFcImages = fcImages.filter((u) => !sectionOwn.has(u));
            const viewHtml = draftPhase
              ? parseBodySImageSlots(markedHtml).textOnlyHtml || markedHtml
              : htmlWithSImages(markedHtml, slotUrls);

            return (
              <div
                key={`${sec.heading}-${idx}`}
                className="space-y-3 report-section"
              >
                <div className="flex flex-wrap items-center justify-end gap-2 print:hidden">
                  <div className="flex flex-wrap gap-1">
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
                      본문 복사
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void copyToClipboard(
                          [formatSectionText(draft, idx), formatFactChecksText(draft)]
                            .filter(Boolean)
                            .join("\n\n"),
                          "본문+팩트체크"
                        )
                      }
                      className="rounded-md border border-ink-200 bg-white px-2 py-1 text-xs font-medium text-ink-600 hover:border-accent hover:text-accent"
                    >
                      본문+FC 복사
                    </button>
                  </div>
                </div>

                {sec.body && (
                  <div
                    className="report-body text-sm text-ink-800 leading-relaxed space-y-2"
                    dangerouslySetInnerHTML={{ __html: viewHtml }}
                    onClick={onBodyClick}
                  />
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

                {reportFcImages.length > 0 && !draftPhase && (
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
                            className="w-full max-h-72 object-contain object-left bg-white"
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

        <ImageLibraryPicker
          open={libraryPickerOpen}
          onClose={() => setLibraryPickerOpen(false)}
          onPick={pickLibraryImageIntoReport}
        />

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
