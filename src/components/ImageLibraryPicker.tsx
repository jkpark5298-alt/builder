"use client";

import {
  ClipboardPaste,
  Library,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LibraryImage } from "@/lib/types";
import {
  compressImageFiles,
  extractImageFilesFromDataTransfer,
  readImagesFromClipboard,
} from "@/lib/image-client";

/**
 * 보고서에서 라이브러리 고르기 + 바로 업로드/붙여넣기.
 * 홈 「이미지」로 나가지 않아도 됨.
 */
export function ImageLibraryPicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  /** url + memo 를 보고서에 반영 */
  onPick: (image: LibraryImage) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const [images, setImages] = useState<LibraryImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [pasteArmed, setPasteArmed] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const reload = useCallback(async (query = q) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/image-library${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ""}`,
        { cache: "no-store" }
      );
      const data = (await res.json()) as {
        images?: LibraryImage[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || "불러오기 실패");
      setImages(data.images ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "불러오기 실패");
    } finally {
      setLoading(false);
    }
  }, [q]);

  useEffect(() => {
    if (!open) return;
    setHint(null);
    setError(null);
    setPasteArmed(true);
    setQ("");
    void (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/image-library", { cache: "no-store" });
        const data = (await res.json()) as {
          images?: LibraryImage[];
          error?: string;
        };
        if (!res.ok) throw new Error(data.error || "불러오기 실패");
        setImages(data.images ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "불러오기 실패");
      } finally {
        setLoading(false);
      }
    })();
    const t = window.setTimeout(() => dropRef.current?.focus(), 80);
    return () => window.clearTimeout(t);
  }, [open]);

  const uploadAndPick = useCallback(
    async (files: FileList | File[] | null) => {
      const list = files
        ? Array.from(files).filter((f) => f.type.startsWith("image/"))
        : [];
      if (!list.length) {
        setError(
          "이미지 파일이 없습니다. 스크린샷을 복사한 뒤 Ctrl+V 하세요."
        );
        return;
      }
      setBusy(true);
      setError(null);
      setHint(null);
      try {
        const compressed = await compressImageFiles(list);
        let last: LibraryImage | null = null;
        for (const dataUrl of compressed) {
          const res = await fetch("/api/image-library", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dataUrl, memo: "" }),
          });
          const data = (await res.json()) as {
            image?: LibraryImage;
            error?: string;
          };
          if (!res.ok || !data.image) {
            throw new Error(data.error || "업로드 실패");
          }
          last = data.image;
          setImages((prev) => [
            data.image!,
            ...prev.filter((i) => i.id !== data.image!.id),
          ]);
          onPick(data.image);
        }
        setHint(
          last
            ? `${compressed.length}장을 라이브러리에 저장하고 현재 섹션에 넣었습니다.`
            : null
        );
        setPasteArmed(false);
        if (compressed.length === 1) onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "업로드 실패");
      } finally {
        setBusy(false);
        if (fileRef.current) fileRef.current.value = "";
      }
    },
    [onClose, onPick]
  );

  useEffect(() => {
    if (!open || busy) return;
    const onWin = (e: ClipboardEvent) => {
      const files = e.clipboardData
        ? extractImageFilesFromDataTransfer(e.clipboardData)
        : [];
      if (!files.length) return;
      e.preventDefault();
      e.stopPropagation();
      void uploadAndPick(files);
    };
    window.addEventListener("paste", onWin, true);
    return () => window.removeEventListener("paste", onWin, true);
  }, [open, busy, uploadAndPick]);

  async function pasteFromClipboard() {
    if (busy) return;
    setPasteArmed(true);
    dropRef.current?.focus();
    try {
      const files = await readImagesFromClipboard();
      if (files.length) {
        await uploadAndPick(files);
        return;
      }
      setHint("이미지를 복사한 뒤 이 창에서 Ctrl+V 하세요.");
    } catch {
      setHint("이 영역을 클릭한 뒤 Ctrl+V 로 붙여넣으세요.");
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-ink-900/40 p-3 print:hidden">
      <div
        role="dialog"
        aria-modal
        aria-label="이미지 빠른 넣기"
        className="w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-xl flex flex-col"
      >
        <div className="flex items-center justify-between gap-2 border-b border-ink-100 px-4 py-3">
          <div className="flex items-center gap-2 text-ink-900">
            <Library className="h-4 w-4 text-accent" />
            <div>
              <p className="font-medium text-sm">이미지 빠른 넣기</p>
              <p className="text-[11px] text-ink-500">
                홈으로 나가지 않아도 됩니다 · 붙여넣기·파일 → 현재 섹션
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-9 min-w-9 inline-flex items-center justify-center rounded-lg border border-ink-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-4 py-3 space-y-2 border-b border-ink-50">
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => void uploadAndPick(e.target.files)}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1.5 min-h-10 rounded-xl bg-ink-900 px-3 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {busy ? "넣는 중…" : "파일에서 넣기"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void pasteFromClipboard()}
              className={`inline-flex items-center gap-1.5 min-h-10 rounded-xl border px-3 text-sm font-medium disabled:opacity-50 ${
                pasteArmed
                  ? "border-accent bg-accent-muted/50"
                  : "border-ink-300 bg-white"
              }`}
            >
              <ClipboardPaste className="h-4 w-4" />
              {pasteArmed ? "Ctrl+V 대기…" : "붙여넣기"}
            </button>
          </div>

          <div
            ref={dropRef}
            tabIndex={0}
            role="button"
            aria-label="이미지 붙여넣기 영역"
            onClick={() => {
              setPasteArmed(true);
              dropRef.current?.focus();
              setHint("이미지를 복사한 뒤 Ctrl+V 하세요.");
            }}
            onPaste={(e) => {
              const files = extractImageFilesFromDataTransfer(e.clipboardData);
              if (!files.length) return;
              e.preventDefault();
              void uploadAndPick(files);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              void uploadAndPick(
                extractImageFilesFromDataTransfer(e.dataTransfer)
              );
            }}
            className={`rounded-xl border border-dashed px-3 py-4 text-center outline-none transition-colors ${
              dragOver || pasteArmed
                ? "border-accent bg-accent-muted/40"
                : "border-ink-300 bg-ink-50/70"
            }`}
          >
            <p className="text-sm font-medium text-ink-800">
              여기 클릭 후{" "}
              <kbd className="rounded border border-ink-300 bg-white px-1.5 py-0.5 text-xs">
                Ctrl
              </kbd>
              +
              <kbd className="rounded border border-ink-300 bg-white px-1.5 py-0.5 text-xs">
                V
              </kbd>{" "}
              또는 드래그
            </p>
            <p className="text-[11px] text-ink-500 mt-1">
              라이브러리에 저장됨과 동시에 현재 섹션에 붙습니다.
            </p>
          </div>

          {error && (
            <p className="text-sm text-verify-false" role="alert">
              {error}
            </p>
          )}
          {hint && (
            <p className="text-sm text-emerald-700" role="status">
              {hint}
            </p>
          )}
        </div>

        <div className="px-4 py-2 border-b border-ink-50 flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void reload(q);
              }
            }}
            placeholder="기존 이미지 메모·태그 검색"
            className="flex-1 min-h-10 rounded-xl border border-ink-200 px-3 text-sm outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={() => void reload(q)}
            className="min-h-10 rounded-xl border border-ink-200 bg-white px-3 text-sm font-medium"
          >
            검색
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading && (
            <p className="text-sm text-ink-500 flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              불러오는 중…
            </p>
          )}
          {!loading && !images.length && (
            <p className="text-sm text-ink-500 text-center py-6">
              저장된 이미지가 없습니다. 위에서 바로 붙여넣거나 파일을 고르세요.
            </p>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {images.map((img) => (
              <button
                key={img.id}
                type="button"
                disabled={busy}
                onClick={() => {
                  onPick(img);
                  onClose();
                }}
                className="text-left rounded-xl border border-ink-200 bg-ink-50/50 overflow-hidden hover:border-accent transition-colors disabled:opacity-50"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.url}
                  alt=""
                  className="h-24 w-full object-cover bg-ink-100"
                />
                <p className="px-2 py-1.5 text-[11px] text-ink-600 line-clamp-3 min-h-[2.5rem]">
                  {img.memo || img.tag || "메모 없음 · 탭하여 넣기"}
                </p>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
