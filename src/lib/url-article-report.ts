import { plainTextToHtml, reportBodyPlain, sanitizeAiPasteText, decodeHtmlEntities } from "./report";
import { reportSourceLink } from "./input-mode";
import { stabilizeReportFcAnchors } from "./fc-markers";
import {
  bindSectionSlotUrls,
  upsertRoomUrls,
  normalizeRoomItems,
} from "./report-images";
import {
  countTrailingSMarkers,
  ensureTrailingSMarkers,
} from "./report-body-s-slots";
import { REPORT_TYPE_LABELS } from "./types";
import type { ReportSectionBlock, TypedReport, VideoRecord } from "./types";

function isPressBoilerplateLine(line: string): boolean {
  const t = line.replace(/\u00a0/g, " ").trim();
  if (!t) return true;
  if (/◎\s*공감언론\s*뉴시스/i.test(t)) return true;
  if (/^(ⓒ|©|Copyright\b)/i.test(t)) return true;
  if (/무단전재|재배포\s*금지/.test(t)) return true;
  if (/^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/.test(t)) return true;
  if (
    t.length <= 80 &&
    /뉴시스|연합뉴스|뉴스1|오마이뉴스/.test(t) &&
    /@|기자/.test(t)
  ) {
    return true;
  }
  return false;
}

function isChromeLine(line: string): boolean {
  const t = line.replace(/\u00a0/g, " ").trim();
  if (!t) return false;
  if (/^\[이미지\s*\d+\]$/.test(t)) return false;
  if (isPressBoilerplateLine(t)) return true;
  if (
    /^(좋아요|슬퍼요|화나요|후속기사\s*원해요|공유하기|스크랩|인쇄하기|페이스북|트위터|카카오톡|카카오스토리)$/i.test(
      t
    )
  ) {
    return true;
  }
  if (
    t.length <= 40 &&
    /^(구독|뉴스레터|앱\s*다운로드|기사\s*제보|댓글\s*\d*|응원\s*\d*)$/.test(t)
  ) {
    return true;
  }
  if (/^(사진|영상|그래픽)\s*[=:：]/.test(t) && t.length < 80) return true;
  if (/^[▲▶▷◆■●]\s*(사진|연합뉴스|뉴시스|뉴스1)/.test(t) && t.length < 80) {
    return true;
  }
  if (/^https?:\/\/\S+$/i.test(t)) return true;
  if (/^\[?광고\]?$/.test(t)) return true;
  if (/^\[광고\]/.test(t)) return true;
  if (/^(AD|Advertisement|Sponsored)\b/i.test(t) && t.length < 50) return true;
  if (/쿠팡\s*파트너스|파트너스\s*활동|이 포스팅은.+(수수료|광고)/.test(t)) {
    return true;
  }
  if (/^(스폰서|협찬|광고)\s*[:：]/.test(t) && t.length < 80) return true;
  if (
    t.length < 40 &&
    /지금\s*(가입|신청|구매)|최저가\s*보장|클릭\s*(한\s*번|하세요)|구매하기/.test(
      t
    )
  ) {
    return true;
  }
  return false;
}

/** 기사 말미 통신사 출처·메일·저작권 안내 */
export function stripPressBoilerplate(text: string): string {
  const lines = text.replace(/\u00a0/g, " ").split(/\n/);
  while (lines.length && isPressBoilerplateLine(lines[lines.length - 1] || "")) {
    lines.pop();
  }
  return lines
    .join("\n")
    .replace(/(?:\n|^)\s*◎\s*공감언론\s*뉴시스[^\n]*$/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripTrailingRelatedBlocks(text: string): string {
  const cuts = [
    /(?:^|\n)\s*(?:▶\s*)?(?:관련\s*(?:기사|뉴스|소식)|함께\s*(?:본|볼)\s*(?:기사|뉴스)|이\s*시각\s*주요\s*뉴스|많이\s*본\s*(?:뉴스|기사)|추천\s*(?:기사|뉴스|콘텐츠)|이런\s*기사\s*어때요|당신이 좋아할|스폰서(?:\s*콘텐츠)?)\s*:?\s*(?:\n[\s\S]*)?$/i,
    /(?:^|\n)\s*(?:댓글|한줄평|독자\s*댓글)\s*\d*\s*(?:\n[\s\S]*)?$/i,
  ];
  let out = text;
  for (const re of cuts) {
    const m = re.exec(out);
    if (m && m.index > 40) {
      out = out.slice(0, m.index).trimEnd();
    }
  }
  return out;
}

function stripChromeLines(text: string): string {
  return text
    .split(/\n/)
    .filter((line) => !isChromeLine(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type OrganizeUrlArticleOptions = {
  /** true면 `[이미지 N]` 미리보기 표시를 남긴다 */
  keepImageMarkers?: boolean;
};

function stripInlinePhotoCaptions(text: string): string {
  return text
    .replace(
      /\s*[\(（][^)）]{0,120}(?:사진|영상|그래픽)\s*[=:：][^)）]*[\)）]/g,
      ""
    )
    .replace(/[ \t]{2,}/g, " ");
}

/**
 * URL에서 가져온 기사 본문 정리.
 * 저작권·관련기사·공유 버튼·HTML 엔티티(&ldquo; 등)·마크다운 잡음을 걷고 문단만 남긴다.
 */
export function organizeUrlArticleText(
  raw: string,
  opts?: OrganizeUrlArticleOptions
): string {
  let t = (raw || "")
    .replace(/\u200B|\uFEFF/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ");
  if (!t.trim()) return "";
  t = decodeHtmlEntities(t);
  // 줄 단위 잡음은 문장 이어붙이기(unwrap) 전에 제거
  t = stripChromeLines(t);
  t = stripTrailingRelatedBlocks(t);
  t = stripPressBoilerplate(t);
  t = sanitizeAiPasteText(t);
  t = decodeHtmlEntities(t);
  t = stripInlinePhotoCaptions(t);
  t = t.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/__([^_\n]+?)__/g, "$1");
  t = t.replace(/^[ \t]*[-*_]{3,}[ \t]*$/gm, "");
  t = t.replace(/^#{1,6}[ \t]+/gm, "");
  t = stripChromeLines(t);
  t = stripTrailingRelatedBlocks(t);
  t = stripPressBoilerplate(t);
  if (!opts?.keepImageMarkers) {
    t = t.replace(/\[이미지\s*\d+\]/g, "");
  }
  return t.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** 본문에 끼워 둔 `[이미지 N]` 표시 — 실제 사진은 S칸으로 붙이므로 글자는 제거 */
export function stripArticleImageMarkers(text: string): string {
  return organizeUrlArticleText(text, { keepImageMarkers: false });
}

/** 미리보기에서 고른 사진을 빼고 `[이미지 N]` 번호를 다시 맞춘다 */
export function dropArticleImages(
  text: string,
  images: string[],
  dropUrls: string[]
): { text: string; images: string[] } {
  const drop = new Set(dropUrls.map((u) => u.trim()).filter(Boolean));
  if (!drop.size) return { text, images: images.map((u) => u.trim()).filter(Boolean) };

  const oldToNew = new Map<number, number>();
  const kept: string[] = [];
  for (let i = 0; i < images.length; i++) {
    const url = images[i]?.trim() || "";
    if (!url || drop.has(url)) continue;
    oldToNew.set(i + 1, kept.length + 1);
    kept.push(url);
  }

  const nextText = text
    .replace(/\[이미지\s*(\d+)\]/g, (_, n: string) => {
      const mapped = oldToNew.get(Number(n));
      return mapped ? `[[KEEPIMG:${mapped}]]` : "";
    })
    .replace(/\[\[KEEPIMG:(\d+)\]\]/g, "[이미지 $1]")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { text: nextText, images: kept };
}

/** 보고서 본문 HTML을 기사 정리 규칙으로 다듬고 S칸(사진)은 유지 */
export function organizeUrlArticleReport(report: TypedReport): TypedReport {
  const sections = report.sections.map((sec) => {
    const slotCount = countTrailingSMarkers(sec.body || "");
    const plain = reportBodyPlain(sec.body || "", Boolean(sec.rich));
    const withoutSlots = plain
      .replace(/(?:^|\n)[ \t]*[Ss]\d{0,2}\.?[ \t]*(?=\n|$)/g, "\n")
      .replace(/[ \t]+[Ss]\d{0,2}\.?[ \t]*$/gm, "");
    const cleaned = organizeUrlArticleText(withoutSlots, {
      keepImageMarkers: false,
    });
    if (!cleaned && !slotCount) return sec;
    let body = cleaned ? plainTextToHtml(cleaned) : "<p></p>";
    if (slotCount) body = ensureTrailingSMarkers(body, slotCount);
    return { ...sec, body, rich: true };
  });
  const first = sections[0];
  const excerpt = first
    ? reportBodyPlain(first.body || "", true).slice(0, 400)
    : report.summaryExcerpt;
  return { ...report, sections, summaryExcerpt: excerpt };
}

/**
 * URL 원문 → 보고서.
 * 본문은 평문 문단(HTML `<p>`). 받은 사진은 본문 끝 S칸에 붙여,
 * 기존처럼 S/s → 붙여넣기·사진첩으로 더 넣을 수 있게 한다.
 */
export function buildUrlArticleReport(
  video: Pick<
    VideoRecord,
    | "title"
    | "channel"
    | "sourceUrl"
    | "youtubeUrl"
    | "inputMode"
    | "transcript"
    | "articleImages"
    | "reportType"
    | "updatedAt"
    | "createdAt"
  >
): TypedReport {
  const bodyText = stripArticleImageMarkers(video.transcript ?? "");
  const images = (video.articleImages ?? []).map((u) => u.trim()).filter(Boolean);
  let body = bodyText ? plainTextToHtml(bodyText) : "<p></p>";
  if (images.length) {
    body = ensureTrailingSMarkers(body, images.length);
  }

  const section: ReportSectionBlock = {
    sectionId: "sec-url-body",
    heading: "본문",
    body,
    rich: true,
  };
  const bound = images.length
    ? bindSectionSlotUrls(section, [], images, { body, rich: true })
    : { room: [], section };

  const writtenAt = new Date(
    video.updatedAt || video.createdAt
  ).toLocaleString("ko-KR");

  return {
    meta: {
      title: video.title,
      channel: video.channel,
      url: reportSourceLink(video),
      writtenAt,
    },
    reportType: video.reportType || "C",
    reportTypeLabel: REPORT_TYPE_LABELS[video.reportType || "C"] || "일반 보고서",
    format: "general_v5",
    sections: [bound.section],
    summaryExcerpt: bodyText.slice(0, 400),
    imageRoom: bound.room,
    factChecks: [],
  };
}

export const URL_ARTICLE_REPORT_NOTICE =
  "URL 원문을 정리해 보고서 본문(평문)으로 넣었습니다. 받은 사진은 본문 아래 S칸에 붙였습니다. 불필요한 사진은 갤러리에서 지울 수 있고, 「본문 정리」로 관련기사·저작권 문구를 다시 걷을 수 있습니다. 문장 끝에 S를 치면 붙여넣기·사진첩으로 더 넣을 수 있습니다. 요약·팩트체크는 선택입니다.";

/** 기존 보고서의 팩트체크는 유지하고, 본문만 URL 원문(+S칸 사진)으로 교체 */
export function applyUrlArticleBodyToReport(video: VideoRecord): TypedReport {
  const built = buildUrlArticleReport(video);
  const existing = video.report;
  if (!existing) return built;
  const extraUrls = normalizeRoomItems(existing.imageRoom)
    .map((item) => item.url)
    .filter((url) => !(video.articleImages ?? []).includes(url));
  const { room } = extraUrls.length
    ? upsertRoomUrls(built.imageRoom, extraUrls)
    : { room: built.imageRoom };
  return stabilizeReportFcAnchors({
    ...existing,
    sections: built.sections,
    summaryExcerpt: built.summaryExcerpt,
    imageRoom: room,
    meta: {
      ...existing.meta,
      url: built.meta.url || existing.meta.url,
      writtenAt: built.meta.writtenAt,
    },
    factChecks: existing.factChecks ?? [],
  });
}
