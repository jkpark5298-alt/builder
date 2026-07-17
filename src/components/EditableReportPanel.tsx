"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  Bold,
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  ImagePlus,
  PenLine,
  Pencil,
  Save,
  Type,
  Underline,
  X,
} from "lucide-react";
import type {
  FactCheckVerdict,
  ReportSectionBlock,
  TypedReport,
  VideoRecord,
} from "@/lib/types";
import { compressImageFiles, extractImageFilesFromDataTransfer, readImagesFromClipboard } from "@/lib/image-client";
import { normalizeImageUrls } from "@/lib/image-urls";
import { isFailedVerdict, verdictBadge } from "@/lib/text-format";
import { TextToImageModal } from "@/components/TextToImageModal";

const COLORS = [
  { id: "yellow", label: "노랑", color: "#b45309", bg: "#fef08a" },
  { id: "blue", label: "파랑", color: "#1d4ed8", bg: "#bfdbfe" },
  { id: "red", label: "빨강", color: "#b91c1c", bg: "#fecaca" },
  { id: "green", label: "녹색", color: "#15803d", bg: "#bbf7d0" },
] as const;

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
  const [openFc, setOpenFc] = useState<string | null>(null);
  const [handwritingFor, setHandwritingFor] = useState<number | null>(null);
  const [textImageFor, setTextImageFor] = useState<number | null>(null);
  const [rebuilding, setRebuilding] = useState(false);

  useEffect(() => {
    setDraft(report);
  }, [report]);

  // 구형식(TYPE별) → 일반 형식 자동 재생성
  useEffect(() => {
    if (!video.report || video.report.format === "general_v4") return;
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

  if (!report || !draft) return null;

  const fcByItem = new Map(
    draft.factChecks.filter((f) => f.itemId).map((f) => [f.itemId!, f])
  );

  async function saveReport() {
    setSaving(true);
    try {
      const res = await fetch(`/api/videos/${video.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updateReport: draft }),
      });
      const data = (await res.json()) as { error?: string; video?: VideoRecord };
      if (!res.ok) throw new Error(data.error || "저장 실패");
      if (data.video?.report) setDraft(data.video.report);
      setEditing(false);
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  }

  function patchSection(idx: number, patch: Partial<ReportSectionBlock>) {
    setDraft((prev) => {
      if (!prev) return prev;
      const sections = [...prev.sections];
      sections[idx] = { ...sections[idx], ...patch };
      return { ...prev, sections };
    });
  }

  async function addImagesToSection(idx: number, files: File[]) {
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    if (!imageFiles.length) return;
    try {
      const dataUrls = await compressImageFiles(imageFiles);
      if (!dataUrls.length) return;
      setDraft((prev) => {
        if (!prev) return prev;
        const sections = [...prev.sections];
        const sec = sections[idx];
        const images = [...(sec.images ?? []), ...dataUrls];
        sections[idx] = { ...sec, images };
        return { ...prev, sections };
      });
    } catch {
      alert("이미지 추가에 실패했습니다.");
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

  function insertHandwriting(idx: number, dataUrl: string) {
    setDraft((prev) => {
      if (!prev) return prev;
      const sections = [...prev.sections];
      const images = [...(sections[idx].images ?? []), dataUrl];
      sections[idx] = { ...sections[idx], images };
      return { ...prev, sections };
    });
    setHandwritingFor(null);
  }

  function insertTextImage(idx: number, dataUrl: string) {
    setDraft((prev) => {
      if (!prev) return prev;
      const sections = [...prev.sections];
      const images = [...(sections[idx].images ?? []), dataUrl];
      sections[idx] = { ...sections[idx], images };
      return { ...prev, sections };
    });
    setTextImageFor(null);
  }

  return (
    <section
      id="report"
      className="rounded-2xl border border-ink-200 bg-white/80 p-4 sm:p-5 space-y-5 scroll-mt-20"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg sm:text-xl">
          3. 보고서 (요약 · 팩트체크)
        </h2>
        <button
          type="button"
          onClick={() => (editing ? void saveReport() : setEditing(true))}
          disabled={saving || rebuilding}
          className="inline-flex items-center gap-1.5 min-h-10 rounded-lg border border-ink-200 bg-white px-3 text-sm font-medium hover:border-accent"
        >
          {editing ? (
            <>
              <Save className="h-4 w-4" />
              {saving ? "저장 중…" : "저장 (PDF 반영)"}
            </>
          ) : (
            <>
              <Pencil className="h-4 w-4" />
              수정 (텍스트·이미지)
            </>
          )}
        </button>
      </div>

      {rebuilding && (
        <p className="text-sm text-ink-500">일반 보고서 형식으로 갱신 중…</p>
      )}

      <div className="rounded-xl bg-ink-50 border border-ink-100 p-3 text-sm space-y-1">
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

      {draft.sections.map((sec, idx) => (
        <div
          key={`${sec.heading}-${idx}`}
          className="space-y-3"
          tabIndex={editing ? 0 : undefined}
          onPaste={editing ? (e) => handleSectionPaste(idx, e) : undefined}
        >
          <h3 className="font-medium text-accent text-lg">{sec.heading}</h3>

          {editing && (
            <FormatToolbar
              onBold={() => document.execCommand("bold")}
              onUnderline={() => document.execCommand("underline")}
              onColor={(c) => document.execCommand("foreColor", false, c)}
              onHighlight={(c) => document.execCommand("hiliteColor", false, c)}
              onImage={() => {
                const input = document.getElementById(
                  `sec-img-${idx}`
                ) as HTMLInputElement | null;
                input?.click();
              }}
              onPasteImage={() => void pasteImagesToSection(idx)}
              onTextImage={() => setTextImageFor(idx)}
              onHandwriting={() => setHandwritingFor(idx)}
            />
          )}

          <input
            id={`sec-img-${idx}`}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              void addImagesToSection(idx, Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />

          {editing && (
            <p className="text-xs text-ink-500">
              이미지: 파일 · 붙여넣기 · 텍스트→이미지 · 손글씨
            </p>
          )}

          <textarea
            id={`sec-paste-${idx}`}
            readOnly
            aria-label="이미지 붙여넣기"
            className="sr-only"
            onPaste={(e) => handleSectionPaste(idx, e)}
          />

          {sec.imageUrl && (
            <div className="overflow-hidden rounded-xl border border-ink-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={sec.imageUrl}
                alt=""
                className="w-full max-h-64 object-cover"
              />
            </div>
          )}

          {editing ? (
            <RichBody
              html={sec.body}
              onChange={(html) =>
                patchSection(idx, { body: html, rich: true })
              }
            />
          ) : (
            sec.body && (
              <div
                className="report-body text-sm text-ink-800 leading-relaxed space-y-2"
                dangerouslySetInnerHTML={{ __html: sec.body }}
              />
            )
          )}

          {/* 소주제 본문 바로 아래 관련 이미지 */}
          {sec.images?.map((src, i) => (
            <div
              key={i}
              className="relative overflow-hidden rounded-xl border border-ink-100"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="w-full max-h-72 object-contain bg-white" />
              {editing && (
                <button
                  type="button"
                  className="absolute top-2 right-2 rounded-lg bg-white/90 border border-ink-200 p-1.5"
                  onClick={() =>
                    patchSection(idx, {
                      images: sec.images?.filter((_, j) => j !== i),
                    })
                  }
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}

          {sec.entries && sec.entries.length > 0 && (
            <p className="text-xs text-ink-500 pt-1">이 소주제 관련 팩트체크</p>
          )}

          {sec.entries?.map((entry) => {
            const fc = entry.itemId ? fcByItem.get(entry.itemId) : undefined;
            const verdict = (fc?.verdict ?? "pending") as FactCheckVerdict;
            const badge = verdictBadge(verdict);
            const open = openFc === entry.itemId;
            const failed = isFailedVerdict(verdict);
            const parts =
              entry.answerParts?.length
                ? entry.answerParts
                : fc?.answerParts?.length
                  ? fc.answerParts
                  : null;
            const flatFallback = Array.from(
              new Set(
                [
                  ...normalizeImageUrls(
                    entry.answerImageUrl,
                    entry.answerImageUrls
                  ),
                  ...normalizeImageUrls(
                    fc?.answerImageUrl,
                    fc?.answerImageUrls
                  ),
                ].filter(
                  (u) => !/i\.ytimg\.com|ytimg\.com\/vi\//i.test(u)
                )
              )
            );

            return (
              <div
                key={entry.itemId ?? entry.text}
                className="rounded-xl border border-ink-100 overflow-hidden bg-white"
              >
                <div className="p-3 sm:p-4 space-y-3">
                  <p className="font-medium text-ink-900 leading-snug">
                    <mark className="hl-yellow">{entry.text}</mark>
                  </p>

                  {parts?.length ? (
                    <div className="space-y-3">
                      {parts.map((part) => (
                        <div
                          key={part.number}
                          className="rounded-lg border border-ink-100 bg-ink-50/80 p-2.5 space-y-2"
                        >
                          <p className="text-sm text-ink-800 leading-relaxed whitespace-pre-wrap">
                            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-ink-900 text-[10px] font-bold text-white mr-1.5 align-middle">
                              {part.number}
                            </span>
                            {part.text}
                          </p>
                          {(part.imageUrls ?? [])
                            .filter(
                              (u) =>
                                !/i\.ytimg\.com|ytimg\.com\/vi\//i.test(u)
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
                                <p className="text-xs text-ink-500 px-2 py-1.5 bg-ink-50 border-t border-ink-100">
                                  {part.number}번 이미지
                                </p>
                              </div>
                            ))}
                        </div>
                      ))}
                    </div>
                  ) : (
                    flatFallback.map((src) => (
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
                        <p className="text-xs text-ink-500 px-2 py-1.5 bg-ink-50 border-t border-ink-100">
                          관련 이미지
                        </p>
                      </div>
                    ))
                  )}

                  {fc && (
                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={() =>
                          setOpenFc(open ? null : (entry.itemId ?? null))
                        }
                        className={`w-full flex items-center justify-between gap-2 min-h-10 rounded-lg px-3 text-sm font-medium border ${
                          failed
                            ? "border-verify-false/40 bg-verify-false/10 text-verify-false"
                            : badge.ok
                              ? "border-verify-true/30 bg-verify-true/10 text-verify-true"
                              : "border-ink-200 bg-ink-50 text-ink-700"
                        }`}
                      >
                        <span>
                          FACT CHECK {badge.mark}{" "}
                          {badge.label !== "대기" ? badge.label : "결과 보기"}
                        </span>
                        {open ? (
                          <ChevronUp className="h-4 w-4 shrink-0" />
                        ) : (
                          <ChevronDown className="h-4 w-4 shrink-0" />
                        )}
                      </button>

                      {open && (
                        <div className="mt-2 rounded-lg bg-ink-50 border border-ink-100 p-3 text-sm text-ink-700 whitespace-pre-wrap leading-relaxed">
                          {failed && (
                            <p className="text-verify-false font-bold mb-2">
                              ✗ 사실과 다름
                            </p>
                          )}
                          {fc.checkGuide || (
                            <p className="text-ink-500">
                              저장된 팩트체크 세부 내용이 없습니다.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}

      {editing && (
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="text-sm text-ink-500 underline"
        >
          취소
        </button>
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
    </section>
  );
}

function FormatToolbar({
  onBold,
  onUnderline,
  onColor,
  onHighlight,
  onImage,
  onPasteImage,
  onTextImage,
  onHandwriting,
}: {
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
    <div className="flex flex-wrap gap-1.5 items-center rounded-xl border border-ink-200 bg-ink-50 p-2">
      <ToolBtn onClick={onBold} title="굵게">
        <Bold className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn onClick={onUnderline} title="밑줄">
        <Underline className="h-4 w-4" />
      </ToolBtn>
      <span className="text-xs text-ink-400 px-1">글자</span>
      {COLORS.map((c) => (
        <button
          key={c.id}
          type="button"
          title={c.label}
          onClick={() => onColor(c.color)}
          className="h-8 w-8 rounded-lg border border-ink-200 shadow-sm"
          style={{ background: c.color }}
        />
      ))}
      <span className="text-xs text-ink-400 px-1">형광</span>
      {COLORS.map((c) => (
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
}: {
  children: ReactNode;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="inline-flex items-center gap-1 min-h-8 rounded-lg border border-ink-200 bg-white px-2 text-ink-700 hover:border-accent"
    >
      {children}
    </button>
  );
}

function RichBody({
  html,
  onChange,
}: {
  html: string;
  onChange: (html: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== html) {
      ref.current.innerHTML = html || "<p></p>";
    }
  }, [html]);

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      className="report-body min-h-[120px] w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 leading-relaxed"
      onInput={() => onChange(ref.current?.innerHTML ?? "")}
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
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink-900/50 p-3">
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
