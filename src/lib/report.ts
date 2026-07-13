import type {
  FactCheckResult,
  ReportType,
  SummaryItem,
  TypedReport,
  VideoRecord,
} from "./types";
import { REPORT_TYPE_LABELS, REPORT_TYPE_STRUCTURE } from "./types";

export function detectReportType(input: {
  title: string;
  description: string;
  overview: string;
  chapters?: Array<{ title: string }>;
}): ReportType {
  const text = [
    input.title,
    input.description,
    input.overview,
    ...(input.chapters?.map((c) => c.title) ?? []),
  ]
    .join(" ")
    .toLowerCase();

  const score = (words: string[]) =>
    words.reduce((n, w) => (text.includes(w.toLowerCase()) ? n + 1 : n), 0);

  const h = score([
    "역사",
    "몽골",
    "전쟁",
    "왕조",
    "제국",
    "고대",
    "중세",
    "사료",
    "유물",
    "고고",
    "칭기즈",
    "흑사병",
    "연대기",
  ]);
  const s = score([
    "주식",
    "증시",
    "코스피",
    "나스닥",
    "실적",
    "배당",
    "투자",
    "주가",
    "금리",
    "환율",
    "재무",
    "시총",
    "펀드",
  ]);
  const p = score([
    "정치",
    "선거",
    "국회",
    "대통령",
    "외교",
    "시사",
    "법안",
    "여야",
    "정책",
    "정부",
    "탄핵",
    "정당",
  ]);

  const ranked: Array<[ReportType, number]> = [
    ["H", h],
    ["S", s],
    ["P", p],
  ];
  ranked.sort((a, b) => b[1] - a[1]);
  if (ranked[0][1] >= 2) return ranked[0][0];
  if (ranked[0][1] >= 1 && ranked[0][1] > ranked[1][1]) return ranked[0][0];
  return "C";
}

export function buildTypedReport(
  video: Pick<
    VideoRecord,
    | "title"
    | "channel"
    | "youtubeUrl"
    | "overview"
    | "summaryBullets"
    | "items"
    | "factChecks"
    | "reportType"
    | "updatedAt"
    | "createdAt"
  >
): TypedReport {
  const writtenAt = new Date(video.updatedAt || video.createdAt).toLocaleString(
    "ko-KR"
  );
  const fcMap = new Map(video.factChecks.map((f) => [f.itemId, f]));
  const bullets = video.summaryBullets?.length
    ? video.summaryBullets
    : video.items.slice(0, 6).map((i) => i.statement);

  const sections = fillTypeSections(
    video.reportType,
    video.overview,
    bullets,
    video.items,
    video.factChecks
  );

  return {
    meta: {
      title: video.title,
      channel: video.channel,
      url: video.youtubeUrl,
      writtenAt,
    },
    reportType: video.reportType,
    reportTypeLabel: REPORT_TYPE_LABELS[video.reportType],
    sections,
    summaryExcerpt: [video.overview, ...bullets.map((b) => `· ${b}`)].join(
      "\n"
    ),
    factChecks: video.items
      .filter((i) => i.needsFactCheck)
      .map((i) => ({
        statement: i.detail
          ? `${i.statement}\n(상세) ${i.detail}`
          : i.statement,
        checkGuide:
          fcMap.get(i.id)?.explanation ||
          "팩트체크할 내용을 정리해 주세요.",
      })),
  };
}

function fillTypeSections(
  type: ReportType,
  overview: string,
  bullets: string[],
  items: SummaryItem[],
  factChecks: FactCheckResult[]
): Array<{ heading: string; body: string }> {
  const headings = REPORT_TYPE_STRUCTURE[type];
  const claimTexts = items
    .filter((i) => i.needsFactCheck)
    .map((i) => i.statement);
  const fcNotes = factChecks
    .map((f) => f.explanation)
    .filter(Boolean)
    .slice(0, 4);

  const chunk = (parts: string[]) =>
    parts.filter(Boolean).join("\n\n") || overview;

  if (type === "H") {
    return [
      {
        heading: headings[0],
        body: chunk([
          overview,
          bullets[0] ? `관련 배경: ${bullets[0]}` : "",
          bullets[1] ? `원인·맥락: ${bullets[1]}` : "",
        ]),
      },
      {
        heading: headings[1],
        body: chunk([
          claimTexts.slice(0, 3).map((c, i) => `${i + 1}. ${c}`).join("\n") ||
            bullets.slice(0, 3).map((b, i) => `${i + 1}. ${b}`).join("\n"),
        ]),
      },
      {
        heading: headings[2],
        body: chunk([
          bullets.slice(3).join("\n") ||
            "영상에서 제시한 결과·영향과 팩트체크 포인트를 함께 고려해야 합니다.",
          fcNotes[0] ? `검증 관점: ${fcNotes[0]}` : "",
        ]),
      },
    ];
  }

  if (type === "S") {
    return [
      {
        heading: headings[0],
        body: chunk([overview, bullets[0] ?? ""]),
      },
      {
        heading: headings[1],
        body: chunk([
          ...bullets.slice(1, 4).map((b) => `· ${b}`),
          ...claimTexts.slice(0, 2).map((c) => `· ${c}`),
        ]),
      },
      {
        heading: headings[2],
        body: chunk([
          bullets.slice(-2).join("\n") ||
            "투자 판단 전 지표·리스크를 교차 확인하세요.",
          fcNotes.slice(0, 2).join("\n"),
        ]),
      },
    ];
  }

  if (type === "P") {
    return [
      {
        heading: headings[0],
        body: chunk([
          overview,
          bullets[0] ? `핵심 배경: ${bullets[0]}` : "",
        ]),
      },
      {
        heading: headings[1],
        body: chunk([
          claimTexts.map((c, i) => `${i + 1}. ${c}`).join("\n") ||
            bullets.slice(1, 4).map((b, i) => `${i + 1}. ${b}`).join("\n"),
          fcNotes[0] ? `\n검증 쟁점: ${fcNotes[0]}` : "",
        ]),
      },
      {
        heading: headings[2],
        body: chunk([
          bullets.slice(-2).join("\n") ||
            "향후 전개와 관전 포인트는 추가 보도·공식 발표를 확인하세요.",
          fcNotes.slice(1, 3).join("\n"),
        ]),
      },
    ];
  }

  // C — 교양
  return [
    {
      heading: headings[0],
      body: chunk([
        overview,
        ...bullets.slice(0, 3).map((b) => `· ${b}`),
      ]),
    },
    {
      heading: headings[1],
      body: chunk([
        ...claimTexts.slice(0, 3).map((c) => `실천·주의: ${c}`),
        ...fcNotes.slice(0, 2).map((n) => `확인: ${n}`),
        bullets.slice(3).join("\n") ||
          "핵심 메시지를 일상·학습에 적용할 때 과장·단정은 걸러 보세요.",
      ]),
    },
  ];
}
