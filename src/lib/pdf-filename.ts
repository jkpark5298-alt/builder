/** PDF·공유 파일명에 쓸 수 있게 제목 정리 */
export function sanitizePdfFilePart(raw: string, maxLen = 60): string {
  const cleaned = (raw || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .trim();
  if (!cleaned) return "report";
  return cleaned.slice(0, maxLen);
}

/** 작성일 → YYYYMMDD (한글 작성일·ISO 모두 허용) */
export function formatPdfDatePart(raw?: string | null): string {
  const fallback = () => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}${m}${day}`;
  };
  if (!raw?.trim()) return fallback();
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, "0");
    const day = String(parsed.getDate()).padStart(2, "0");
    return `${y}${m}${day}`;
  }
  const ko = raw.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
  if (ko) {
    return `${ko[1]}${ko[2].padStart(2, "0")}${ko[3].padStart(2, "0")}`;
  }
  const iso = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}${iso[2]}${iso[3]}`;
  return fallback();
}

/**
 * 내보내기 파일명: INF_{제목}_{작성일자}.{ext}
 */
export function buildInfExportFileName(opts: {
  title: string;
  writtenAt?: string | null;
  ext: "pdf" | "docx";
}): string {
  const title = sanitizePdfFilePart(opts.title);
  const date = formatPdfDatePart(opts.writtenAt);
  return `INF_${title}_${date}.${opts.ext}`;
}

/** PDF 저장 파일명: INF_{제목}_{작성일자}.pdf */
export function buildInfPdfFileName(opts: {
  title: string;
  writtenAt?: string | null;
}): string {
  return buildInfExportFileName({ ...opts, ext: "pdf" });
}

/** Word 저장 파일명: INF_{제목}_{작성일자}.docx */
export function buildInfDocxFileName(opts: {
  title: string;
  writtenAt?: string | null;
}): string {
  return buildInfExportFileName({ ...opts, ext: "docx" });
}
