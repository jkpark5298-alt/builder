export type ClaimType = "claim" | "opinion" | "info";

/** H=역사, S=주식, C=교양, P=정치/시사 */
export type ReportType = "H" | "S" | "C" | "P";

export type FactCheckVerdict =
  | "true"
  | "mostly_true"
  | "mixed"
  | "mostly_false"
  | "false"
  | "unverifiable"
  | "pending";

export type FactCheckMode = "auto" | "manual";

export type PipelineStatus =
  | "queued"
  | "fetching"
  | "summarizing"
  | "fact_checking"
  | "awaiting_factcheck"
  | "ready"
  | "error";

export interface Evidence {
  text: string;
  sourceHint?: string;
}

export interface SummaryItem {
  id: string;
  type: ClaimType;
  /** 팩트체크 대상 주장 (구체적·검증 가능해야 함) */
  statement: string;
  /** 왜/무엇을 검증할지 상세 (선택) */
  detail?: string;
  imageUrl?: string;
  chapterTimestamp?: string;
  evidence: Evidence[];
  needsFactCheck: boolean;
}

export interface FactCheckResult {
  itemId: string;
  mode: FactCheckMode;
  verdict: FactCheckVerdict;
  /** 어떤 내용을 팩트체크해야 하는지 */
  explanation: string;
  sources: string[];
  checkedAt: string;
  /** AI 답변 참고 이미지 (data URL 또는 URL) */
  answerImageUrl?: string;
}

export interface ReportEntry {
  itemId?: string;
  text: string;
  /** HTML 가능 */
  html?: string;
  imageUrl?: string;
  /** 팩트체크 답변 이미지 */
  answerImageUrl?: string;
}

export interface ReportSectionBlock {
  heading: string;
  /** plain 또는 HTML */
  body: string;
  /** true 이면 body를 HTML로 렌더 */
  rich?: boolean;
  imageUrl?: string;
  /** 첨부·손글씨 이미지들 */
  images?: string[];
  /** 본문 아래 항목(팩트체크 연동) */
  entries?: ReportEntry[];
}

export interface TypedReport {
  meta: {
    title: string;
    channel: string;
    url: string;
    writtenAt: string;
  };
  reportType: ReportType;
  reportTypeLabel: string;
  /** general = 연역형 일반 보고서 (TYPE 형식 폐지) */
  format?: "general_v1" | "general_v2" | "typed_legacy";
  /** 유형별 본문 섹션 */
  sections: ReportSectionBlock[];
  /** 요약 발췌 */
  summaryExcerpt: string;
  factChecks: Array<{
    itemId?: string;
    statement: string;
    checkGuide: string;
    verdict?: FactCheckVerdict;
    answerImageUrl?: string;
  }>;
}

/** @deprecated kept for migration — prefer TypedReport */
export interface ReportSection {
  introduction: string;
  body: Array<{
    itemId: string;
    statement: string;
    type: ClaimType;
    verdict: FactCheckVerdict;
    factCheckSummary: string;
  }>;
  conclusion: string;
}

export interface InfographicData {
  title: string;
  channel: string;
  reportType: ReportType;
  stats: { claims: number; opinions: number; info: number; verified: number };
  highlights: Array<{
    label: string;
    short: string;
  }>;
  sectionHints: Array<{ heading: string; short: string }>;
  svgMarkup: string;
}

export interface YoutubeChapter {
  startSec: number;
  timestamp: string;
  title: string;
}

export interface VideoRecord {
  id: string;
  youtubeUrl: string;
  videoId: string;
  title: string;
  channel: string;
  thumbnailUrl: string;
  publishedAt?: string;
  description: string;
  chapters: YoutubeChapter[];
  transcript: string;
  transcriptSource:
    | "youtube"
    | "youtube_auto"
    | "speech_text"
    | "pasted"
    | "creator_meta"
    | "none";
  /** 스크립트 없음/대체 소스 안내 */
  scriptNotice?: string;
  /** 일반 요약 본문 */
  overview: string;
  /** 일반 요약 단락 (핵심 포인트) */
  summaryBullets: string[];
  items: SummaryItem[];
  factChecks: FactCheckResult[];
  reportType: ReportType;
  report: TypedReport | null;
  /** legacy */
  legacyReport?: ReportSection | null;
  infographic: InfographicData | null;
  status: PipelineStatus;
  errorMessage?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  sharedAt?: string;
}

export interface CreateVideoInput {
  youtubeUrl: string;
}

export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  H: "역사 (H)",
  S: "주식 (S)",
  C: "교양 (C)",
  P: "정치/시사 (P)",
};

export const REPORT_TYPE_STRUCTURE: Record<ReportType, string[]> = {
  H: ["배경 / 원인", "핵심 사건", "결과 · 영향"],
  S: ["현황", "근거 / 지표", "결론 / 리스크"],
  C: ["핵심 메시지", "실천 방법 / 주의할 점"],
  P: [
    "사안의 본질 (정의 + 핵심 배경)",
    "대립 의견 및 쟁점",
    "향후 전망 및 관전 포인트",
  ],
};
