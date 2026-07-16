"use client";

import { useMemo, useState } from "react";
import { Type, X } from "lucide-react";
import { renderTextToImageDataUrl } from "@/lib/text-to-image";

const BG_PRESETS = [
  { id: "white", label: "흰 배경", bg: "#ffffff", fg: "#1a2430" },
  { id: "cream", label: "크림", bg: "#f8f4ec", fg: "#1a2430" },
  { id: "ink", label: "다크", bg: "#1a2430", fg: "#f8fafc" },
  { id: "accent", label: "강조", bg: "#fff7ed", fg: "#9a3412" },
] as const;

export function TextToImageModal({
  onCancel,
  onInsert,
  initialText = "",
  title = "텍스트 → 이미지",
}: {
  onCancel: () => void;
  onInsert: (dataUrl: string) => void;
  initialText?: string;
  title?: string;
}) {
  const [text, setText] = useState(initialText);
  const [fontSize, setFontSize] = useState(28);
  const [preset, setPreset] = useState<(typeof BG_PRESETS)[number]["id"]>("white");
  const [align, setAlign] = useState<"left" | "center">("left");
  const [busy, setBusy] = useState(false);

  const colors = useMemo(
    () => BG_PRESETS.find((p) => p.id === preset) ?? BG_PRESETS[0],
    [preset]
  );

  const previewUrl = useMemo(() => {
    if (!text.trim()) return null;
    try {
      return renderTextToImageDataUrl(text, {
        fontSize,
        backgroundColor: colors.bg,
        textColor: colors.fg,
        align,
        maxWidth: 640,
      });
    } catch {
      return null;
    }
  }, [text, fontSize, colors, align]);

  function insert() {
    if (!text.trim()) {
      alert("텍스트를 입력해 주세요.");
      return;
    }
    setBusy(true);
    try {
      const url = renderTextToImageDataUrl(text, {
        fontSize,
        backgroundColor: colors.bg,
        textColor: colors.fg,
        align,
        maxWidth: 900,
      });
      onInsert(url);
    } catch {
      alert("이미지 생성에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink-900/50 p-3">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl overflow-hidden max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-ink-100 shrink-0">
          <p className="font-medium text-ink-900 inline-flex items-center gap-1.5">
            <Type className="h-4 w-4" />
            {title}
          </p>
          <button type="button" onClick={onCancel} className="p-1">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-3 space-y-3 overflow-y-auto">
          <label className="block text-xs font-medium text-ink-600">
            텍스트 입력
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              placeholder="이미지로 넣을 문장을 입력하세요…"
              className="mt-1.5 w-full rounded-xl border border-ink-200 px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </label>

          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs text-ink-500">배경</span>
            {BG_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPreset(p.id)}
                className={`min-h-8 rounded-lg border px-2.5 text-xs ${
                  preset === p.id
                    ? "border-accent bg-accent-muted"
                    : "border-ink-200 bg-white"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-3 items-center">
            <label className="text-xs text-ink-500 flex items-center gap-2">
              글자 크기
              <input
                type="range"
                min={18}
                max={44}
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}
              />
              <span className="tabular-nums w-8">{fontSize}</span>
            </label>
            <div className="flex gap-1.5">
              {(
                [
                  ["left", "왼쪽"],
                  ["center", "가운데"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setAlign(id)}
                  className={`min-h-8 rounded-lg border px-2.5 text-xs ${
                    align === id
                      ? "border-accent bg-accent-muted"
                      : "border-ink-200 bg-white"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-ink-100 bg-ink-50 p-2">
            <p className="text-xs text-ink-500 mb-2 px-1">미리보기</p>
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt=""
                className="w-full rounded-lg border border-ink-100 bg-white"
              />
            ) : (
              <p className="text-sm text-ink-400 px-2 py-6 text-center">
                텍스트를 입력하면 미리보기가 나타납니다.
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-2 p-3 border-t border-ink-100 shrink-0">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 min-h-11 rounded-xl border border-ink-200"
          >
            취소
          </button>
          <button
            type="button"
            disabled={busy || !text.trim()}
            onClick={insert}
            className="flex-1 min-h-11 rounded-xl bg-ink-900 text-white font-medium disabled:opacity-50"
          >
            {busy ? "생성 중…" : "이미지로 넣기"}
          </button>
        </div>
      </div>
    </div>
  );
}
