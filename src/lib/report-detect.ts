import type { ReportType } from "./types";

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
