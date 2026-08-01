/**
 * 본문 문장/문단 끝의 S 표시 → 이미지 슬롯 (섹션 분할 없음).
 * S 는 화면에 보이지 않고, 그 자리에 이미지만 붙입니다.
 *
 * 인식 예: `…이다. S` / `…이다.S` / `…이다. s` / 단독 줄 `S`
 * TipTap `<br>` 줄바꿈 앞의 S 도 인식합니다.
 */

export type BodySSegment = {
  /** S 를 제거한 HTML 조각 */
  html: string;
  /** 이 조각 뒤에 이미지 칸이 있는지 */
  hasSlot: boolean;
  /** 슬롯 앞 문장 미리보기 (UI 라벨용) */
  preview: string;
};

/** 문단/문장 끝의 이미지 표시 S/s (앞에 공백·문장부호 있거나 단독) */
const S_ONLY_RE = /^[Ss]\.?$/u;

function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/[\u200B\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTrailingSFromPlain(text: string): { text: string; hadS: boolean } {
  const t = text
    .replace(/\u00a0/g, " ")
    .replace(/[\u200B\uFEFF]/g, "")
    .trimEnd();
  if (S_ONLY_RE.test(t.trim())) return { text: "", hadS: true };
  // `…이다. S` / `…이다 s` / `…이다．S`
  const withSpace = t.replace(/(?:^|[\s\u00a0]+)[Ss]\.?\s*$/u, "").trimEnd();
  if (withSpace !== t) return { text: withSpace, hadS: true };
  // `…이다.S` / `…이다!s` / 전각 마침표
  const withPunct = t
    .replace(/([.!?。．…])[Ss]\.?\s*$/u, "$1")
    .trimEnd();
  if (withPunct !== t) return { text: withPunct, hadS: true };
  return { text: t, hadS: false };
}

function stripTrailingSFromHtmlBlock(block: string): {
  html: string;
  hadS: boolean;
} {
  const plain = stripTags(block);
  const { text, hadS } = stripTrailingSFromPlain(plain);
  if (!hadS) return { html: block, hadS: false };
  if (!text) return { html: "", hadS: true };

  // 블록 끝의 단독 S/s / 공백+S / 문장부호 직후 S 제거
  let html = block
    .replace(/[\u200B\uFEFF]/g, "")
    .replace(
      /((?:&nbsp;|\s|<br\s*\/?\s*>)*)[Ss]\.?(\s*)(<\/(?:p|div|li|h[1-6])>\s*)$/i,
      "$3"
    )
    .replace(/([.!?。．…])[Ss]\.?(\s*)(<\/(?:p|div|li|h[1-6])>\s*)$/i, "$1$3")
    .replace(/((?:&nbsp;|\s|<br\s*\/?\s*>)*)[Ss]\.?\s*$/i, "")
    .replace(/([.!?。．…])[Ss]\.?\s*$/i, "$1");
  if (!stripTags(html).trim()) return { html: "", hadS: true };
  return { html, hadS: true };
}

/**
 * `<p>a.s<br>b<br>c</p>` → 줄 단위 `<p>…</p>` 조각으로 나눔.
 * TipTap 한 문단 안 Enter/`<br>` 뒤에도 S 를 인식하기 위함.
 */
function splitBlockIntoLinePieces(block: string): string[] {
  const wrapped = block.match(/^<(p|div|li|h[1-6]|blockquote)(\s[^>]*)?>([\s\S]*)<\/\1>$/i);
  if (!wrapped) {
    if (!/<br\s*\/?>/i.test(block)) return [block];
    return block
      .split(/<br\s*\/?>/gi)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const [, tag, attrs = "", inner] = wrapped;
  if (!/<br\s*\/?>/i.test(inner)) return [block];
  return inner
    .split(/<br\s*\/?>/gi)
    .map((line) => line.trim())
    .filter((line) => stripTags(line).length > 0 || /[Ss]\.?$/.test(line.trim()))
    .map((line) => `<${tag}${attrs}>${line}</${tag}>`);
}

/**
 * HTML 본문을 문단·줄바꿈 단위로 나누고, S 뒤에 슬롯을 둡니다.
 */
export function parseBodySImageSlots(html: string): {
  segments: BodySSegment[];
  slotCount: number;
  /** 보기용: S 제거·슬롯 자리 표시 없는 HTML */
  textOnlyHtml: string;
} {
  const raw = (html || "").trim();
  if (!raw) {
    return { segments: [], slotCount: 0, textOnlyHtml: "" };
  }

  // 블록 단위 분리 (p/div/h*/li 또는 이중 개행)
  const blocks: string[] = [];
  const blockRe =
    /<(p|div|h[1-6]|li|blockquote)(\s[^>]*)?>[\s\S]*?<\/\1>/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(blockRe.source, "gi");
  while ((m = re.exec(raw))) {
    if (m.index > last) {
      const between = raw.slice(last, m.index).trim();
      if (between) blocks.push(between);
    }
    blocks.push(m[0]);
    last = m.index + m[0].length;
  }
  if (last < raw.length) {
    const rest = raw.slice(last).trim();
    if (rest) blocks.push(rest);
  }
  if (!blocks.length) blocks.push(raw);

  const pieces = blocks.flatMap((b) => splitBlockIntoLinePieces(b));

  const segments: BodySSegment[] = [];
  let buf = "";
  let slotCount = 0;

  const flushText = (hasSlot: boolean) => {
    const htmlPart = buf.trim();
    buf = "";
    if (!htmlPart && !hasSlot) return;
    const preview = stripTags(htmlPart).slice(0, 40);
    segments.push({
      html: htmlPart || "<p></p>",
      hasSlot,
      preview: preview || `이미지 ${slotCount}`,
    });
  };

  for (const piece of pieces) {
    const { html: cleaned, hadS } = stripTrailingSFromHtmlBlock(piece);
    if (cleaned) buf += cleaned;
    if (hadS) {
      slotCount += 1;
      flushText(true);
    }
  }
  if (buf.trim()) flushText(false);

  // S 가 본문 전체 끝에만 있는 평문 케이스
  if (
    !slotCount &&
    /(?:^|[\s>]|[.!?。．…])[Ss]\.?\s*$/u.test(stripTags(raw))
  ) {
    const { html: cleaned } = stripTrailingSFromHtmlBlock(raw);
    return {
      segments: [
        {
          html: cleaned || "<p></p>",
          hasSlot: true,
          preview: stripTags(cleaned).slice(0, 40) || "이미지 1",
        },
      ],
      slotCount: 1,
      textOnlyHtml: cleaned || "",
    };
  }

  const textOnlyHtml = segments
    .map((s) => s.html)
    .filter(Boolean)
    .join("");

  return { segments, slotCount, textOnlyHtml };
}

/** 보기/인쇄: S 자리에 이미지를 끼워 넣은 HTML */
export function htmlWithSImages(
  html: string,
  imageUrls: string[]
): string {
  const { segments, slotCount } = parseBodySImageSlots(html);
  if (!slotCount) {
    // S 없으면 원문에서 혹시 남은 끝 S 만 제거
    const { textOnlyHtml } = parseBodySImageSlots(html);
    return textOnlyHtml || html;
  }
  let imgIdx = 0;
  const parts: string[] = [];
  for (const seg of segments) {
    if (seg.html) parts.push(seg.html);
    if (seg.hasSlot) {
      const src = imageUrls[imgIdx++];
      if (src) {
        parts.push(
          `<figure class="report-s-image"><img src="${src.replace(/"/g, "&quot;")}" alt="" /></figure>`
        );
      }
    }
  }
  // 슬롯보다 이미지가 많으면 뒤에 붙임
  while (imgIdx < imageUrls.length) {
    const src = imageUrls[imgIdx++];
    parts.push(
      `<figure class="report-s-image"><img src="${src.replace(/"/g, "&quot;")}" alt="" /></figure>`
    );
  }
  return parts.join("");
}

export function countTrailingSMarkers(html: string): number {
  return parseBodySImageSlots(html).slotCount;
}

/** 편집 세그먼트 HTML 끝에 이미지 슬롯용 S 표시를 붙입니다. */
export function appendTrailingSMarker(html: string): string {
  const trimmed = (html || "").trim();
  if (!trimmed || trimmed === "<p></p>" || trimmed === "<p><br></p>") {
    return "<p>S</p>";
  }
  if (countTrailingSMarkers(trimmed) > 0) return trimmed;
  if (/<\/p>\s*$/i.test(trimmed)) {
    return trimmed.replace(/<\/p>\s*$/i, " S</p>");
  }
  return `${trimmed}<p>S</p>`;
}

/**
 * S 로 나뉜 편집 세그먼트를 다시 본문 HTML 로 합칩니다.
 * hasSlot 세그먼트 끝에 S 를 복원해 슬롯이 유지되게 합니다.
 */
export function joinBodySegmentsWithS(
  segments: Array<{ html: string; hasSlot: boolean }>
): string {
  if (!segments.length) return "<p></p>";
  return segments
    .map((seg) => {
      const html = (seg.html || "").trim() || "<p></p>";
      return seg.hasSlot ? appendTrailingSMarker(html) : html;
    })
    .join("");
}
