import { normalizeAiAnswer } from "./text-format";
import { normalizeImageUrls } from "./image-urls";
import type { AnswerPart } from "./types";

/**
 * AI 답변 텍스트를 번호 단위로 나눕니다.
 * `1. …` / `2. …` 형태를 우선하고, 번호가 없으면 단락 단위로 1부터 부여합니다.
 */
export function parseNumberedTexts(explanation: string): Array<{
  number: number;
  text: string;
}> {
  const normalized = normalizeAiAnswer(explanation || "");
  if (!normalized.trim()) return [];

  const lines = normalized.split("\n");
  const parts: Array<{ number: number; text: string }> = [];
  let current: { number: number; text: string } | null = null;
  let autoN = 0;

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) {
      if (current) current.text += "\n";
      continue;
    }
    const numbered = trimmed.match(/^(\d+)[.)]\s+(.+)$/);
    if (numbered) {
      if (current?.text.trim()) parts.push(current);
      current = {
        number: parseInt(numbered[1], 10),
        text: numbered[2].trim(),
      };
      autoN = Math.max(autoN, current.number);
      continue;
    }
    if (!current) {
      autoN += 1;
      current = { number: autoN, text: trimmed };
    } else {
      current.text = `${current.text}\n${trimmed}`.trim();
    }
  }
  if (current?.text.trim()) parts.push(current);

  // 번호 중복·구멍 정리: 등장 순서 유지, 번호는 1..N 재부여
  return parts.map((p, i) => ({
    number: i + 1,
    text: p.text.replace(/\n{3,}/g, "\n\n").trim(),
  }));
}

/** 텍스트 번호와 이미지 배열을 같은 번호로 묶습니다 (이미지 i → 번호 i+1). */
export function pairAnswerParts(
  explanation: string,
  imageUrls: string[] = [],
  existing?: AnswerPart[] | null
): AnswerPart[] {
  const texts = parseNumberedTexts(explanation);
  const images = normalizeImageUrls(undefined, imageUrls);

  if (existing?.length) {
    // 기존 구조가 있으면 텍스트는 explanation 기준, 이미지는 기존 번호 유지
    const byNum = new Map(existing.map((p) => [p.number, p.imageUrls ?? []]));
    if (texts.length) {
      return texts.map((t) => ({
        number: t.number,
        text: t.text,
        imageUrls: byNum.get(t.number) ?? [],
      }));
    }
    return existing
      .map((p, i) => ({
        number: i + 1,
        text: p.text?.trim() || "",
        imageUrls: normalizeImageUrls(undefined, p.imageUrls),
      }))
      .filter((p) => p.text || p.imageUrls.length);
  }

  if (!texts.length && !images.length) return [];

  if (!texts.length) {
    // 이미지만 있으면 장마다 번호
    return images.map((url, i) => ({
      number: i + 1,
      text: "",
      imageUrls: [url],
    }));
  }

  const count = Math.max(texts.length, images.length);
  const parts: AnswerPart[] = [];
  for (let i = 0; i < count; i++) {
    parts.push({
      number: i + 1,
      text: texts[i]?.text ?? "",
      imageUrls: images[i] ? [images[i]] : [],
    });
  }
  // 이미지가 텍스트보다 많으면 남는 이미지는 마지막 번호에 붙이지 않고 각각 번호
  // (위에서 이미 i마다 1장씩 배정)
  return parts.filter((p) => p.text || p.imageUrls.length);
}

/** 번호 묶음 → 저장용 explanation 문자열 */
export function partsToExplanation(parts: AnswerPart[]): string {
  return parts
    .filter((p) => p.text.trim())
    .map((p) => `${p.number}. ${p.text.trim()}`)
    .join("\n\n")
    .trim();
}

/** 번호 순서대로 이미지 평탄화 */
export function partsToImageUrls(parts: AnswerPart[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of [...parts].sort((a, b) => a.number - b.number)) {
    for (const u of p.imageUrls ?? []) {
      if (!u || seen.has(u)) continue;
      seen.add(u);
      out.push(u);
    }
  }
  return out;
}

/** 레코드에서 항상 번호 묶음을 얻음 (없으면 텍스트·이미지로 추론) */
export function resolveAnswerParts(input: {
  explanation?: string | null;
  answerImageUrl?: string | null;
  answerImageUrls?: string[] | null;
  answerParts?: AnswerPart[] | null;
}): AnswerPart[] {
  const images = normalizeImageUrls(
    input.answerImageUrl,
    input.answerImageUrls
  );
  if (input.answerParts?.length) {
    return pairAnswerParts(
      input.explanation || partsToExplanation(input.answerParts),
      images.length ? images : partsToImageUrls(input.answerParts),
      input.answerParts
    );
  }
  return pairAnswerParts(input.explanation || "", images);
}

/** 보고서 HTML: 번호별 텍스트 + 이미지 */
export function answerPartsToHtml(
  parts: AnswerPart[],
  escapeHtml: (s: string) => string
): string {
  if (!parts.length) return "";
  return parts
    .map((p) => {
      const text = p.text.trim()
        ? `<p><strong>${p.number}.</strong> ${escapeHtml(p.text.trim())}</p>`
        : `<p><strong>${p.number}.</strong></p>`;
      const imgs = (p.imageUrls ?? [])
        .filter(Boolean)
        .map(
          (src) =>
            `<figure class="fc-part-img" data-part="${p.number}"><img src="${escapeHtml(
              src
            )}" alt="${p.number}번 이미지" /><figcaption>${p.number}번 이미지</figcaption></figure>`
        )
        .join("");
      return `<div class="fc-part" data-part="${p.number}">${text}${imgs}</div>`;
    })
    .join("");
}
