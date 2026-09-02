"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, X, ZoomIn } from "lucide-react";
import { cropImageLossless } from "@/lib/image-client";

type Frame = { x: number; y: number; w: number; h: number };

function coverScale(natW: number, natH: number, frame: Frame) {
  return Math.max(frame.w / Math.max(natW, 1), frame.h / Math.max(natH, 1));
}

function clampOrigin(
  originX: number,
  originY: number,
  scale: number,
  natW: number,
  natH: number,
  frame: Frame
) {
  const dw = natW * scale;
  const dh = natH * scale;
  return {
    x: Math.min(frame.x, Math.max(frame.x + frame.w - dw, originX)),
    y: Math.min(frame.y, Math.max(frame.y + frame.h - dh, originY)),
  };
}

export function ImageCropModal({
  src,
  busy = false,
  onCancel,
  onApply,
}: {
  src: string;
  busy?: boolean;
  onCancel: () => void;
  onApply: (dataUrl: string) => void | Promise<void>;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [nat, setNat] = useState({ w: 0, h: 0 });
  const [frame, setFrame] = useState<Frame>({ x: 0, y: 0, w: 1, h: 1 });
  const [scale, setScale] = useState(1);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  const [cropping, setCropping] = useState(false);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    ox: number;
    oy: number;
  } | null>(null);

  const minScale = nat.w ? coverScale(nat.w, nat.h, frame) : 1;
  const maxScale = Math.max(minScale * 8, minScale + 0.01);
  const fitted = useRef(false);

  const measure = useCallback(() => {
    const stage = stageRef.current;
    const box = frameRef.current;
    if (!stage || !box) return;
    const sr = stage.getBoundingClientRect();
    const fr = box.getBoundingClientRect();
    setFrame({
      x: fr.left - sr.left,
      y: fr.top - sr.top,
      w: fr.width,
      h: fr.height,
    });
  }, []);

  useEffect(() => {
    measure();
    const stage = stageRef.current;
    if (!stage) return;
    const ro = new ResizeObserver(measure);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [measure, src]);

  useEffect(() => {
    fitted.current = false;
  }, [src]);

  useEffect(() => {
    if (!nat.w || frame.w < 32 || fitted.current) return;
    fitted.current = true;
    const nextScale = coverScale(nat.w, nat.h, frame);
    setScale(nextScale);
    setOrigin(
      clampOrigin(
        frame.x + (frame.w - nat.w * nextScale) / 2,
        frame.y + (frame.h - nat.h * nextScale) / 2,
        nextScale,
        nat.w,
        nat.h,
        frame
      )
    );
  }, [nat.w, nat.h, frame]);

  function setZoom(next: number, around?: { x: number; y: number }) {
    const s = Math.min(maxScale, Math.max(minScale, next));
    const cx = around?.x ?? frame.x + frame.w / 2;
    const cy = around?.y ?? frame.y + frame.h / 2;
    const imgX = (cx - origin.x) / scale;
    const imgY = (cy - origin.y) / scale;
    const ox = cx - imgX * s;
    const oy = cy - imgY * s;
    setScale(s);
    setOrigin(clampOrigin(ox, oy, s, nat.w, nat.h, frame));
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      ox: origin.x,
      oy: origin.y,
    };
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    setOrigin(
      clampOrigin(
        d.ox + (e.clientX - d.x),
        d.oy + (e.clientY - d.y),
        scale,
        nat.w,
        nat.h,
        frame
      )
    );
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (drag.current?.id === e.pointerId) drag.current = null;
  }

  function onWheel(e: React.WheelEvent<HTMLDivElement>) {
    e.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const r = stage.getBoundingClientRect();
    const factor = e.deltaY > 0 ? 0.92 : 1.08;
    setZoom(scale * factor, { x: e.clientX - r.left, y: e.clientY - r.top });
  }

  async function apply() {
    if (!nat.w || cropping || busy) return;
    setCropping(true);
    try {
      const dataUrl = await cropImageLossless(src, {
        sx: (frame.x - origin.x) / scale,
        sy: (frame.y - origin.y) / scale,
        sw: frame.w / scale,
        sh: frame.h / scale,
      });
      await onApply(dataUrl);
    } catch (err) {
      alert(err instanceof Error ? err.message : "잘라내지 못했습니다.");
    } finally {
      setCropping(false);
    }
  }

  const working = cropping || busy;

  return (
    <div
      className="fixed inset-0 z-[95] flex flex-col bg-black/80 print:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="사진 잘라내기"
    >
      <div className="flex items-center justify-between gap-2 px-4 py-3 text-white">
        <p className="text-sm font-medium">확대 후 잘라내기</p>
        <button
          type="button"
          onClick={onCancel}
          disabled={working}
          className="rounded-full border border-white/40 bg-black/40 p-2"
          aria-label="닫기"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <div
        ref={stageRef}
        className="relative min-h-0 flex-1 touch-none overflow-hidden cursor-grab active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt=""
          draggable={false}
          className="absolute max-w-none select-none pointer-events-none"
          style={
            nat.w
              ? {
                  left: origin.x,
                  top: origin.y,
                  width: nat.w * scale,
                  height: nat.h * scale,
                }
              : { opacity: 0 }
          }
          onLoad={(e) => {
            const el = e.currentTarget;
            setNat({ w: el.naturalWidth, h: el.naturalHeight });
          }}
        />
        <div
          ref={frameRef}
          className="pointer-events-none absolute inset-6 sm:inset-10 rounded-md border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
        />
      </div>
      <div className="space-y-2 px-4 py-3 text-white">
        <p className="text-xs text-white/80">
          확대해 위치를 맞춘 뒤 잘라냅니다. 원본 픽셀을 그대로 쓰며 화질을
          낮추지 않습니다.
        </p>
        <div className="flex items-center gap-2">
          <ZoomIn className="h-4 w-4 shrink-0" />
          <input
            type="range"
            min={minScale}
            max={maxScale}
            step={0.01}
            value={scale}
            disabled={!nat.w || working}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="w-full accent-white"
            aria-label="확대"
          />
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={working}
            className="rounded-lg border border-white/40 px-3 py-2 text-sm"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => void apply()}
            disabled={!nat.w || working}
            className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-2 text-sm font-medium text-ink-900 disabled:opacity-50"
          >
            {working ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                적용 중…
              </>
            ) : (
              "잘라내기 적용"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
