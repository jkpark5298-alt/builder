import { extractText, getDocumentProxy } from "unpdf";

/** Vercel Hobby 요청 본문 한도(~4.5MB)보다 여유 있게 */
export const PDF_EXTRACT_MAX_BYTES = 4 * 1024 * 1024;

export function normalizePdfExtractedText(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * PDF 바이너리에서 텍스트 레이어를 추출한다.
 * 스캔본(이미지 PDF)은 텍스트가 비어 있을 수 있다.
 */
export async function extractTextFromPdfBuffer(
  data: ArrayBuffer | Uint8Array
): Promise<{ text: string; pageCount: number }> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength === 0) {
    throw new Error("빈 PDF 파일입니다.");
  }
  if (bytes.byteLength > PDF_EXTRACT_MAX_BYTES) {
    throw new Error(
      `PDF가 너무 큽니다. ${(PDF_EXTRACT_MAX_BYTES / (1024 * 1024)).toFixed(0)}MB 이하로 올려 주세요.`
    );
  }

  const pdf = await getDocumentProxy(bytes);
  const pageCount = pdf.numPages ?? 0;
  const result = await extractText(pdf, { mergePages: true });
  const rawText = result.text as string | string[];
  const merged = Array.isArray(rawText) ? rawText.join("\n\n") : String(rawText ?? "");
  const text = normalizePdfExtractedText(merged);

  if (text.length < 20) {
    throw new Error(
      "PDF에서 텍스트를 거의 찾지 못했습니다. 스캔(이미지) PDF는 OCR이 필요하니, 텍스트가 있는 PDF를 쓰거나 내용을 직접 붙여넣어 주세요."
    );
  }

  return { text, pageCount };
}
