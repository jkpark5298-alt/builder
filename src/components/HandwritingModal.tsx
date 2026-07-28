"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

export function HandwritingModal({
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

