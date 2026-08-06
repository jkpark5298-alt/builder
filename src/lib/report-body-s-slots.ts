/**
 * 본문 문장/문단 끝의 S 표시 → 이미지 슬롯 (섹션 분할 없음).
 * S 는 화면에 보이지 않고, 그 자리에 이미지만 붙입니다.
 *
 * 인식 예: `…이다. S` / `…이다.S` / `…이다. S2` / 단독 줄 `S1`
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

/** 문단/문장 끝의 이미지 표시 S/s 또는 S1·S2… (앞에 공백·문장부호 있거나 단독) */
const S_ONLY_RE = /^[Ss]\d{0,2}\.?$/u;
const S_MARK_TAIL = "[Ss]\\d{0,2}\\.?";

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
  // `…이다. S` / `…이다 S2` / `…이다．S1`
  const withSpace = t
    .replace(new RegExp(`(?:^|[\\s\\u00a0]+)${S_MARK_TAIL}\\s*$`, "u"), "")
    .trimEnd();
  if (withSpace !== t) return { text: withSpace, hadS: true };
  // `…이다.S` / `…이다!S1` / 전각 마침표
  const withPunct = t
    .replace(new RegExp(`([.!?。．…])${S_MARK_TAIL}\\s*$`, "u"), "$1")
    .trimEnd();
  if (withPunct !== t) return { text: withPunct, hadS: true };
  // 한글·한자 제목/문장 끝: `진화설 미확인S` / `검증 필요S2` (영문 단어 끝 s 는 제외)
  const withCjk = t
    .replace(
      new RegExp(
        `([\\u1100-\\u11FF\\u3130-\\u318F\\uAC00-\\uD7A3\\u4E00-\\u9FFF])${S_MARK_TAIL}\\s*$`,
        "u"
      ),
      "$1"
    )
    .trimEnd();
  if (withCjk !== t) return { text: withCjk, hadS: true };
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

  // 블록 끝 S/S1 제거 — </strong></p> 같이 중첩 닫는 태그도 허용
  const closeTail = "((?:</[^>]+>\\s*)*)$";
  let html = block.replace(/[\u200B\uFEFF]/g, "");
  const before = html;
  html = html
    .replace(
      new RegExp(
        `((?:&nbsp;|\\s|<br\\s*/?\\s*>)*)${S_MARK_TAIL}(\\s*)${closeTail}`,
        "i"
      ),
      "$3"
    )
    .replace(
      new RegExp(`([.!?。．…])${S_MARK_TAIL}(\\s*)${closeTail}`, "i"),
      "$1$3"
    )
    .replace(
      new RegExp(
        `([\\u1100-\\u11FF\\u3130-\\u318F\\uAC00-\\uD7A3\\u4E00-\\u9FFF])${S_MARK_TAIL}(\\s*)${closeTail}`,
        "u"
      ),
      "$1$3"
    )
    .replace(new RegExp(`((?:&nbsp;|\\s|<br\\s*/?\\s*>)*)${S_MARK_TAIL}\\s*$`, "i"), "")
    .replace(new RegExp(`([.!?。．…])${S_MARK_TAIL}\\s*$`, "i"), "$1")
    .replace(
      new RegExp(
        `([\\u1100-\\u11FF\\u3130-\\u318F\\uAC00-\\uD7A3\\u4E00-\\u9FFF])${S_MARK_TAIL}\\s*$`,
        "u"
      ),
      "$1"
    );
  if (html === before && hadS) {
    // 평문에선 S 인데 HTML 패턴이 안 맞으면 텍스트 노드만 제거 시도
    html = html.replace(/([Ss]\d{0,2})\.?(?=\s*(?:<\/[^>]+>\s*)*$)/u, "");
  }
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
    .filter(
      (line) =>
        stripTags(line).length > 0 || /[Ss]\d{0,2}\.?$/.test(line.trim())
    )
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
    /(?:^|[\s>]|[.!?。．…])[Ss]\d{0,2}\.?\s*$/u.test(stripTags(raw))
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
  const filled = (imageUrls || []).map((u) => (u || "").trim()).filter(Boolean);
  const { segments, slotCount } = parseBodySImageSlots(html);
  if (!slotCount) {
    // S 표시가 없어도 저장된 이미지가 있으면 본문 끝에 붙임
    const { textOnlyHtml } = parseBodySImageSlots(html);
    const base = textOnlyHtml || html || "";
    if (!filled.length) return base;
    return (
      base +
      filled
        .map(
          (src, i) =>
            `<figure class="report-s-image"><span class="s-slot-badge">S${i + 1}</span><img src="${src.replace(/"/g, "&quot;")}" alt="" /></figure>`
        )
        .join("")
    );
  }
  let imgIdx = 0;
  const parts: string[] = [];
  for (const seg of segments) {
    if (seg.html) parts.push(seg.html);
    if (seg.hasSlot) {
      const src = imageUrls[imgIdx++];
      if (src) {
        const n = imgIdx;
        parts.push(
          `<figure class="report-s-image"><span class="s-slot-badge">S${n}</span><img src="${src.replace(/"/g, "&quot;")}" alt="" /></figure>`
        );
      }
    }
  }
  // 슬롯보다 이미지가 많으면 뒤에 붙임
  while (imgIdx < imageUrls.length) {
    const src = imageUrls[imgIdx++];
    if (!src) continue;
    const n = imgIdx;
    parts.push(
      `<figure class="report-s-image"><span class="s-slot-badge">S${n}</span><img src="${src.replace(/"/g, "&quot;")}" alt="" /></figure>`
    );
  }
  return parts.join("");
}

/**
 * 편집기용: S 자리에 figure 를 넣어 문장 바로 아래에 이미지가 보이게 합니다.
 * 빈 슬롯은 점선 칸으로 표시합니다.
 */
export function bodyHtmlWithSSlotFigures(
  html: string,
  imageUrls: string[]
): string {
  const { segments, slotCount, textOnlyHtml } = parseBodySImageSlots(html);
  if (!slotCount) return textOnlyHtml || html || "<p></p>";
  let imgIdx = 0;
  const parts: string[] = [];
  for (const seg of segments) {
    if (seg.html) parts.push(seg.html);
    if (seg.hasSlot) {
      const idx = imgIdx;
      const src = (imageUrls[imgIdx++] || "").trim();
      const n = idx + 1;
      if (src) {
        parts.push(
          `<figure class="report-s-image" data-s-slot="${idx}"><span class="s-slot-badge">S${n}</span><img src="${src.replace(/"/g, "&quot;")}" alt="" /></figure>`
        );
      } else {
        parts.push(
          `<figure class="report-s-image report-s-slot-empty" data-s-slot="${idx}"><p class="s-slot-ph"><strong>S${n} 이미지 입력칸</strong><br/>클릭 후 Ctrl+V · 또는 아래 「파일」</p></figure>`
        );
      }
    }
  }
  return parts.join("") || "<p></p>";
}

/**
 * 편집기 HTML → 저장용 본문(S 표시) + 슬롯 이미지 URL 목록
 */
export function bodyHtmlFromSSlotFigures(html: string): {
  body: string;
  urls: string[];
} {
  const urls: string[] = [];
  let slotN = 0;
  const body = (html || "").replace(
    /<figure\b[^>]*(?:report-s-image|data-s-slot)[^>]*>[\s\S]*?<\/figure>/gi,
    (fig) => {
      const srcMatch = /<img\b[^>]*\bsrc=["']([^"']*)["']/i.exec(fig);
      const src = (srcMatch?.[1] || "")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .trim();
      urls.push(src);
      slotN += 1;
      return `<p>S${slotN}</p>`;
    }
  );
  return { body, urls };
}

/**
 * 문서 순서대로 슬롯 추출.
 * 텍스트 S → 빈 URL(새 입력칸), figure → 해당 이미지.
 * (텍스트 S를 앞에 치면 기존 이미지가 새 칸을 채우던 문제 방지)
 */
export function bodyAndUrlsFromEditorHtml(html: string): {
  body: string;
  urls: string[];
} {
  const raw = html || "";
  const figRe =
    /<figure\b[^>]*(?:report-s-image|data-s-slot)[^>]*>[\s\S]*?<\/figure>/gi;
  const urls: string[] = [];
  const bodyParts: string[] = [];
  let slotN = 0;
  let last = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(figRe.source, "gi");

  const flushTextChunk = (chunk: string) => {
    if (!chunk) return;
    if (!chunk.trim()) {
      bodyParts.push(chunk);
      return;
    }
    const { segments, slotCount } = parseBodySImageSlots(chunk);
    if (!slotCount) {
      bodyParts.push(chunk);
      return;
    }
    for (const seg of segments) {
      if (seg.html) bodyParts.push(seg.html);
      if (seg.hasSlot) {
        slotN += 1;
        urls.push("");
        bodyParts.push(`<p>S${slotN}</p>`);
      }
    }
  };

  while ((m = re.exec(raw))) {
    flushTextChunk(raw.slice(last, m.index));
    const fig = m[0];
    const srcMatch = /<img\b[^>]*\bsrc=["']([^"']*)["']/i.exec(fig);
    const src = (srcMatch?.[1] || "")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .trim();
    slotN += 1;
    urls.push(src);
    bodyParts.push(`<p>S${slotN}</p>`);
    last = m.index + m[0].length;
  }
  flushTextChunk(raw.slice(last));

  if (!slotN) {
    return bodyHtmlFromSSlotFigures(raw);
  }
  return { body: bodyParts.join("") || "<p></p>", urls };
}

export function countTrailingSMarkers(html: string): number {
  return parseBodySImageSlots(html).slotCount;
}

function normalizeBlockPlain(html: string): string {
  return stripTags(html)
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function splitHtmlBlocks(html: string): string[] {
  const raw = (html || "").trim();
  if (!raw) return [];
  const blocks: string[] = [];
  const re = /<(p|div|h[1-6]|li|blockquote)(\s[^>]*)?>[\s\S]*?<\/\1>/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  const matcher = new RegExp(re.source, "gi");
  while ((m = matcher.exec(raw))) {
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
  return blocks.length ? blocks : [raw];
}

/**
 * S 슬롯 다중 편집기 버그 등으로 같은 문단 덩어리가 여러 번 붙은 본문을 정리합니다.
 */
export function dedupeRepeatedReportBodyHtml(html: string): string {
  let current = (html || "").trim();
  if (!current) return html;

  for (let pass = 0; pass < 6; pass++) {
    const next = dedupeExactBlockRuns(current);
    if (next === current) break;
    current = next;
  }
  current = dedupeRestartedTail(current);
  return current.trim() ? current : html;
}

function dedupeExactBlockRuns(html: string): string {
  const blocks = splitHtmlBlocks(html);
  if (blocks.length < 8) return html;

  const plains = blocks.map(normalizeBlockPlain);
  const keep = blocks.map(() => true);
  const minBlocks = 4;
  const minChars = 80;

  for (let i = 0; i < plains.length; i++) {
    if (!keep[i] || !plains[i]) continue;
    for (let j = i + minBlocks; j < plains.length; j++) {
      if (!keep[j] || plains[j] !== plains[i]) continue;
      let L = 0;
      while (
        i + L < j &&
        j + L < plains.length &&
        keep[i + L] &&
        keep[j + L] &&
        plains[i + L] === plains[j + L]
      ) {
        L += 1;
      }
      const charLen = plains.slice(i, i + L).join("").length;
      if (L >= minBlocks && charLen >= minChars) {
        for (let k = 0; k < L; k++) keep[j + k] = false;
      }
    }
  }

  const next = blocks.filter((_, idx) => keep[idx]).join("");
  return next.trim() ? next : html;
}

/** 앞에서 이미 나온 내용이 뒤로 다시 시작되면 뒷부분 제거 */
function dedupeRestartedTail(html: string): string {
  const blocks = splitHtmlBlocks(html);
  if (blocks.length < 10) return html;
  const plains = blocks.map(normalizeBlockPlain);

  for (let i = 0; i < plains.length; i++) {
    if (plains[i].length < 8) continue;
    const j = plains.indexOf(plains[i], i + 1);
    if (j < 0 || j < Math.floor(blocks.length * 0.28)) continue;

    const nextI =
      plains.slice(i + 1).find((p) => p.length > 12) || "";
    const nextJ =
      plains.slice(j + 1).find((p) => p.length > 12) || "";
    const contextMatch =
      !!nextI &&
      !!nextJ &&
      (nextI === nextJ ||
        nextI.startsWith(nextJ.slice(0, 24)) ||
        nextJ.startsWith(nextI.slice(0, 24)));
    if (!contextMatch) continue;

    let substantial = 0;
    let alreadySeen = 0;
    for (let k = j; k < plains.length; k++) {
      if (plains[k].length < 10) continue;
      substantial += 1;
      if (plains.slice(0, j).includes(plains[k])) alreadySeen += 1;
    }
    const ratio = alreadySeen / Math.max(1, substantial);
    // 같은 제목+다음 문장이 다시 시작되면 뒤로 붙은 중복본으로 보고 절단
    if (
      (substantial >= 2 && alreadySeen >= 2 && ratio >= 0.5) ||
      (substantial >= 3 && ratio >= 0.65)
    ) {
      const cut = blocks.slice(0, j).join("");
      return cut.trim() ? cut : html;
    }
  }
  return html;
}

/** 편집 세그먼트 HTML 끝에 이미지 슬롯용 S/S1… 표시를 붙입니다. */
export function appendTrailingSMarker(html: string, slotN?: number): string {
  const mark = slotN != null && slotN > 0 ? `S${slotN}` : "S";
  const trimmed = (html || "").trim();
  if (!trimmed || trimmed === "<p></p>" || trimmed === "<p><br></p>") {
    return `<p>${mark}</p>`;
  }
  // 이미 S 가 있어도 새 슬롯이 필요하면 별도 문단으로 추가
  if (countTrailingSMarkers(trimmed) > 0 && slotN == null) {
    return trimmed;
  }
  if (
    slotN != null &&
    slotN > 0 &&
    countTrailingSMarkers(trimmed) >= slotN
  ) {
    return trimmed;
  }
  if (/<\/p>\s*$/i.test(trimmed) && countTrailingSMarkers(trimmed) === 0) {
    return trimmed.replace(/<\/p>\s*$/i, ` ${mark}</p>`);
  }
  return `${trimmed}<p>${mark}</p>`;
}

/** 본문에 S 슬롯이 최소 count 개가 되도록 뒤에 채웁니다. */
export function ensureTrailingSMarkers(html: string, count: number): string {
  const need = Math.max(0, Math.floor(count));
  if (need <= 0) return html || "<p></p>";
  let body = (html || "").trim() || "<p></p>";
  let n = countTrailingSMarkers(body);
  let guard = 0;
  while (n < need && guard < need + 3) {
    guard += 1;
    const before = n;
    body = appendTrailingSMarker(body, n + 1);
    n = countTrailingSMarkers(body);
    if (n <= before) {
      body = `${body}<p>S${before + 1}</p>`;
      n = countTrailingSMarkers(body);
      if (n <= before) break;
    }
  }
  return body;
}

/**
 * S 로 나뉜 편집 세그먼트를 다시 본문 HTML 로 합칩니다.
 * hasSlot 세그먼트 끝에 S1·S2… 를 복원해 슬롯이 유지되게 합니다.
 */
export function joinBodySegmentsWithS(
  segments: Array<{ html: string; hasSlot: boolean }>
): string {
  if (!segments.length) return "<p></p>";
  let slotN = 0;
  return segments
    .map((seg) => {
      const html = (seg.html || "").trim() || "<p></p>";
      if (!seg.hasSlot) return html;
      slotN += 1;
      return appendTrailingSMarker(html, slotN);
    })
    .join("");
}

/** n번째(0-based) S 슬롯 표시를 본문에서 제거합니다. */
export function removeSSlotAtIndex(html: string, slotIndex: number): string {
  const { segments } = parseBodySImageSlots(html || "");
  if (!segments.length) return html || "<p></p>";
  let n = 0;
  const next = segments.map((seg) => {
    if (!seg.hasSlot) return { html: seg.html, hasSlot: false };
    const drop = n === slotIndex;
    n += 1;
    return { html: seg.html, hasSlot: drop ? false : true };
  });
  if (n <= slotIndex) return html || "<p></p>";
  return joinBodySegmentsWithS(next);
}
