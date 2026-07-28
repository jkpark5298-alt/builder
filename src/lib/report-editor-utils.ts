import type { ReportSectionBlock, TypedReport } from "./types";

export const TEXT_COLORS = [
  { id: "black", label: "검정", color: "#1a2430" },
  { id: "yellow", label: "노랑", color: "#b45309" },
  { id: "blue", label: "파랑", color: "#1d4ed8" },
  { id: "red", label: "빨강", color: "#b91c1c" },
  { id: "green", label: "녹색", color: "#15803d" },
] as const;

export const HIGHLIGHT_COLORS = [
  { id: "yellow", label: "노랑", bg: "#fef08a" },
  { id: "blue", label: "파랑", bg: "#bfdbfe" },
  { id: "red", label: "빨강", bg: "#fecaca" },
  { id: "green", label: "녹색", bg: "#bbf7d0" },
] as const;

export const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28] as const;

export const HISTORY_LIMIT = 40;
export const HISTORY_DEBOUNCE_MS = 450;

export function cloneReport(report: TypedReport): TypedReport {
  return JSON.parse(JSON.stringify(report)) as TypedReport;
}

export function sectionSnapshot(sec: ReportSectionBlock): string {
  return JSON.stringify(sec);
}

export function newSectionId(): string {
  return `sec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function sectionEditKey(sec: ReportSectionBlock, idx: number): string {
  return sec.sectionId ?? `legacy-${idx}`;
}

export function stepFontSize(current: number, delta: number): number {
  const sizes = [...FONT_SIZES];
  let idx = sizes.findIndex((s) => s >= current);
  if (idx === -1) idx = sizes.length - 1;
  const next = Math.min(sizes.length - 1, Math.max(0, idx + delta));
  return sizes[next]!;
}

export function collectSectionImages(sec: ReportSectionBlock): string[] {
  return Array.from(
    new Set(
      [sec.imageUrl, ...(sec.images ?? [])].filter(Boolean) as string[]
    )
  );
}
