import type { ReportEntry, ReportSectionBlock, TypedReport } from "./types";

export type FcMarker = {
  n: number;
  key: string;
  sectionIdx: number;
  entryIdx: number;
  entry: ReportEntry;
};

/** 보고서 전체 entries를 F1…Fn 순번으로 평탄화 */
export function collectFcMarkers(report: TypedReport): FcMarker[] {
  const out: FcMarker[] = [];
  let n = 1;
  report.sections.forEach((sec, sectionIdx) => {
    (sec.entries ?? []).forEach((entry, entryIdx) => {
      out.push({
        n,
        key: entry.itemId ?? `s${sectionIdx}-e${entryIdx}`,
        sectionIdx,
        entryIdx,
        entry,
      });
      n += 1;
    });
  });
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 본문 HTML에서 claim 텍스트를 찾아 밑줄 + F 뱃지 마커로 감쌈.
 * 못 찾으면 null (호출측에서 섹션 하단에 별도 표시).
 */
export function injectFcMarkerIntoHtml(
  html: string,
  claim: string,
  n: number,
  key: string
): string | null {
  const needle = claim.trim();
  if (!needle || needle.length < 4) return null;
  // 이미 같은 마커가 있으면 스킵
  if (html.includes(`data-fc-key="${escapeHtml(key)}"`)) return html;

  const snippet = needle.length > 80 ? needle.slice(0, 80) : needle;
  const re = new RegExp(escapeRegExp(snippet));
  if (!re.test(html.replace(/<[^>]+>/g, " "))) {
    // HTML 태그 제거본에서만 매칭 시도
    const plain = html.replace(/<[^>]+>/g, "");
    if (!plain.includes(snippet)) return null;
  }

  // 태그 밖의 첫 매칭만 치환 — 단순 문자열 검색
  let result = "";
  let i = 0;
  let inTag = false;
  let matched = false;
  const lowerHtml = html;
  const lowerNeedle = snippet;

  while (i < lowerHtml.length) {
    const ch = lowerHtml[i];
    if (ch === "<") {
      inTag = true;
      result += ch;
      i += 1;
      continue;
    }
    if (ch === ">") {
      inTag = false;
      result += ch;
      i += 1;
      continue;
    }
    if (!inTag && !matched && lowerHtml.startsWith(lowerNeedle, i)) {
      const marked = `<span class="fc-target" data-fc-key="${escapeHtml(key)}" data-fc-n="${n}"><u>${escapeHtml(snippet)}</u><button type="button" class="fc-badge" data-fc-key="${escapeHtml(key)}" data-fc-n="${n}" aria-label="팩트체크 F${n}">F${n}</button></span>`;
      result += marked;
      i += lowerNeedle.length;
      matched = true;
      continue;
    }
    result += ch;
    i += 1;
  }

  return matched ? result : null;
}

export function sectionBodyWithMarkers(
  sec: ReportSectionBlock,
  sectionIdx: number,
  markers: FcMarker[]
): { html: string; unmatched: FcMarker[] } {
  const mine = markers.filter((m) => m.sectionIdx === sectionIdx);
  let html = sec.body || "";
  const unmatched: FcMarker[] = [];
  for (const m of mine) {
    const next = injectFcMarkerIntoHtml(html, m.entry.text, m.n, m.key);
    if (next) html = next;
    else unmatched.push(m);
  }
  return { html, unmatched };
}
