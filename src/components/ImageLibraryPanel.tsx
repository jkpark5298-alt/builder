"use client";

import { ClipboardPaste, Loader2, Plus, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LibraryImage } from "@/lib/types";
import {
  compressImageFiles,
  extractImageFilesFromDataTransfer,
  readImagesFromClipboard,
} from "@/lib/image-client";
import {
  clearImageLibraryReturnPath,
  peekImageLibraryReturnPath,
} from "@/components/HomeSectionLink";

const TAGS = ["표지", "지도", "인물", "유물", "도표", "기타"] as const;

export function ImageLibraryPanel({
  initialImages = [],
}: {
  initialImages?: LibraryImage[];
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const [images, setImages] = useState(initialImages);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [pasteArmed, setPasteArmed] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [returnPath, setReturnPath] = useState<string | null>(null);

  useEffect(() => {
    setReturnPath(peekImageLibraryReturnPath());
  }, []);

  const reload = useCallback(async (query = q) => {
    try {
      const res = await fetch(
        `/api/image-library${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ""}`,
        { cache: "no-store" }
      );
      const data = (await res.json()) as { images?: LibraryImage[]; error?: string };
      if (!res.ok) throw new Error(data.error || "목록을 불러오지 못했습니다.");
      setImages(data.images ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "목록 불러오기 실패");
    }
  }, [q]);

  // 최초 마운트만 SSR 목록 반영. 이후 저장분·API 목록을 빈 SSR로 덮지 않음.
  const bootstrapped = useRef(false);
  useEffect(() => {
    if (bootstrapped.current) return;
    setImages(initialImages);
    bootstrapped.current = true;
  }, [initialImages]);

  function keepOnImagesSection() {
    if (typeof window === "undefined") return;
    window.history.replaceState(null, "", "/#images");
    // scrollIntoView는 입력 직후 화면이 튀는 원인이 되어, 이미 섹션에 있으면 생략
    const el = document.getElementById("images");
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.top < 0 || rect.top > 120) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  const uploadFiles = useCallback(async (files: FileList | File[] | null) => {
    const list = files
      ? Array.from(files).filter((f) => f.type.startsWith("image/"))
      : [];
    if (!list.length) {
      setError(
        "이미지 파일이 없습니다. 스크린샷·사진을 복사한 뒤 다시 붙여넣으세요."
      );
      return;
    }
    setBusy(true);
    setError(null);
    setHint(null);
    try {
      const compressed = await compressImageFiles(list);
      let added = 0;
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
        added += 1;
        setImages((prev) => [
          data.image!,
          ...prev.filter((i) => i.id !== data.image!.id),
        ]);
      }
      await reload("");
      setHint(
        `${added}장을 라이브러리에 저장했습니다. 아래 메모를 적어 두세요.`
      );
      setPasteArmed(false);
      keepOnImagesSection();
    } catch (e) {
      setError(e instanceof Error ? e.message : "업로드 실패");
      keepOnImagesSection();
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }, [reload]);

  const onPasteEvent = useCallback(
    (e: React.ClipboardEvent | ClipboardEvent) => {
      if (busy) return;
      const dt = "clipboardData" in e ? e.clipboardData : null;
      if (!dt) return;
      const files = extractImageFilesFromDataTransfer(dt);
      if (!files.length) return;
      e.preventDefault();
      void uploadFiles(files);
    },
    [busy, uploadFiles]
  );

  useEffect(() => {
    if (!pasteArmed || busy) return;
    const onWin = (e: ClipboardEvent) => {
      const files = e.clipboardData
        ? extractImageFilesFromDataTransfer(e.clipboardData)
        : [];
      if (!files.length) return;
      e.preventDefault();
      void uploadFiles(files);
    };
    window.addEventListener("paste", onWin, true);
    return () => window.removeEventListener("paste", onWin, true);
  }, [pasteArmed, busy, uploadFiles]);

  async function pasteFromClipboard() {
    if (busy) return;
    setError(null);
    setPasteArmed(true);
    dropRef.current?.focus();
    try {
      const files = await readImagesFromClipboard();
      if (files.length) {
        await uploadFiles(files);
        return;
      }
      setHint(
        "클립보드에 이미지가 없습니다. 여기 클릭 후 Ctrl+V 로 붙여넣으세요."
      );
    } catch {
      setHint("여기 영역을 클릭한 뒤 Ctrl+V 로 붙여넣으세요.");
    }
  }

  async function saveMemo(id: string, memo: string, tag?: string) {
    setError(null);
    const res = await fetch(`/api/image-library/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memo, tag: tag ?? null }),
    });
    const data = (await res.json()) as { image?: LibraryImage; error?: string };
    if (!res.ok || !data.image) {
      setError(data.error || "메모 저장 실패");
      return;
    }
    setImages((prev) => prev.map((i) => (i.id === id ? data.image! : i)));
  }

  async function remove(id: string) {
    if (!window.confirm("이 이미지를 라이브러리에서 삭제할까요?")) return;
    setError(null);
    const res = await fetch(`/api/image-library/${id}`, { method: "DELETE" });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      setError(data.error || "삭제 실패");
      return;
    }
    setImages((prev) => prev.filter((i) => i.id !== id));
  }

  return (
    <div className="space-y-4">
      {returnPath && (
        <div className="rounded-xl border border-accent/35 bg-accent-muted/40 px-3 py-2.5 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-ink-800">
            보고서에서 오셨습니다. 이미지를 저장한 뒤 바로 돌아갈 수 있습니다.
            <span className="block text-[11px] text-ink-500 mt-0.5">
              더 빠른 방법: 보고서 편집의 「이미지 빠른 넣기」에서 Ctrl+V
            </span>
          </p>
          <a
            href={returnPath}
            onClick={() => clearImageLibraryReturnPath()}
            className="inline-flex items-center min-h-10 rounded-xl bg-ink-900 px-4 text-sm font-medium text-white hover:bg-accent"
          >
            보고서로 돌아가기
          </a>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => void uploadFiles(e.target.files)}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1.5 min-h-10 rounded-xl bg-ink-900 px-4 text-sm font-medium text-white hover:bg-accent disabled:opacity-60"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            {busy ? "올리는 중…" : "파일에서 저장"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void pasteFromClipboard()}
            className={`inline-flex items-center gap-1.5 min-h-10 rounded-xl border px-4 text-sm font-medium disabled:opacity-60 ${
              pasteArmed
                ? "border-accent bg-accent-muted/50 text-ink-900"
                : "border-ink-300 bg-white text-ink-800 hover:border-accent"
            }`}
          >
            <ClipboardPaste className="h-4 w-4" />
            {pasteArmed ? "Ctrl+V 대기 중…" : "붙여넣기"}
          </button>
          <p className="text-xs text-ink-500 self-center">
            파일 · Ctrl+V · 드래그. FC에는 쓰지 않고 보고서에서만 불러옵니다.
          </p>
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void reload(q);
          }}
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="메모·태그 검색"
            className="min-h-10 rounded-xl border border-ink-200 bg-white px-3 text-sm outline-none focus:border-accent"
          />
          <button
            type="submit"
            className="min-h-10 rounded-xl border border-ink-200 bg-white px-3 text-sm font-medium"
          >
            검색
          </button>
        </form>
      </div>

      <div
        ref={dropRef}
        tabIndex={0}
        role="button"
        aria-label="이미지 붙여넣기·드래그 영역"
        onClick={() => {
          setPasteArmed(true);
          dropRef.current?.focus();
          setHint("이미지를 복사한 뒤 이 칸에서 Ctrl+V 하세요.");
        }}
        onPaste={onPasteEvent}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void uploadFiles(extractImageFilesFromDataTransfer(e.dataTransfer));
        }}
        className={`rounded-2xl border border-dashed px-4 py-6 text-center outline-none transition-colors ${
          dragOver || pasteArmed
            ? "border-accent bg-accent-muted/40"
            : "border-ink-300 bg-ink-50/60 hover:border-accent/50"
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
          또는 이미지 드래그
        </p>
        <p className="text-xs text-ink-500 mt-1">
          스크린샷·갤러리 복사본을 바로 라이브러리에 저장합니다.
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

      {images.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-ink-300 bg-white/50 px-6 py-12 text-center">
          <p className="font-display text-lg text-ink-700">
            저장된 이미지가 없습니다
          </p>
          <p className="text-ink-500 mt-2 text-sm">
            파일 저장 · 붙여넣기 · 드래그로 올린 뒤 메모를 적어 두세요.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1.5 min-h-10 rounded-xl border border-ink-300 bg-white px-4 text-sm font-medium"
            >
              <Plus className="h-4 w-4" />
              파일에서 올리기
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void pasteFromClipboard()}
              className="inline-flex items-center gap-1.5 min-h-10 rounded-xl border border-accent/40 bg-accent-muted/40 px-4 text-sm font-medium"
            >
              <ClipboardPaste className="h-4 w-4" />
              붙여넣기
            </button>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {images.map((img) => (
            <LibraryImageCard
              key={img.id}
              image={img}
              onSave={(memo, tag) => void saveMemo(img.id, memo, tag)}
              onDelete={() => void remove(img.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LibraryImageCard({
  image,
  onSave,
  onDelete,
}: {
  image: LibraryImage;
  onSave: (memo: string, tag?: string) => void;
  onDelete: () => void;
}) {
  const [memo, setMemo] = useState(image.memo);
  const [tag, setTag] = useState(image.tag ?? "");
  const dirty =
    memo !== image.memo || (tag || undefined) !== (image.tag || undefined);

  useEffect(() => {
    setMemo(image.memo);
    setTag(image.tag ?? "");
  }, [image.id, image.memo, image.tag]);

  return (
    <div className="rounded-2xl border border-ink-200 bg-white overflow-hidden shadow-sm">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image.url}
        alt=""
        className="h-40 w-full object-cover bg-ink-100"
      />
      <div className="p-3 space-y-2">
        <select
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          className="w-full rounded-lg border border-ink-200 px-2 py-1.5 text-xs text-ink-700"
        >
          <option value="">태그 없음</option>
          {TAGS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <textarea
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          rows={3}
          placeholder="메모장 — 출처·설명·보고서에 쓸 때 필요 사항"
          className="w-full rounded-lg border border-ink-200 px-2.5 py-2 text-sm text-ink-800 outline-none focus:border-accent"
        />
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!dirty}
            onClick={() => onSave(memo, tag || undefined)}
            className="flex-1 min-h-9 rounded-lg bg-ink-900 text-xs font-medium text-white disabled:opacity-40"
          >
            메모 저장
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex items-center justify-center min-h-9 min-w-9 rounded-lg border border-ink-200 text-ink-500 hover:border-verify-false hover:text-verify-false"
            title="삭제"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
