export type ClaimType = "claim" | "opinion" | "info";

/** H=역사, S=주식, C=교양, P=정치/시사 */
export type ReportType = "H" | "S" | "C" | "P";

/** youtube: URL·자막 자동 / report: 스크립트 직접 입력 */
export type InputMode = "youtube" | "report";

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
  | "report_input_draft"
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
  /** 대상 관련 이미지 (첫 장 — 하위 호환) */
  imageUrl?: string;
  /** 대상 관련 이미지 (복수) */
  imageUrls?: string[];
  chapterTimestamp?: string;
  evidence: Evidence[];
  needsFactCheck: boolean;
  /** true면 보고서 만들기 필수 게이트에서 제외 (나중에 이어서 가능) */
  factCheckOptional?: boolean;
}

export interface AnswerPart {
  /** 1부터 시작하는 번호 — 같은 번호의 텍스트·이미지를 묶음 */
  number: number;
  text: string;
  imageUrls: string[];
}

export interface FactCheckResult {
  itemId: string;
  mode: FactCheckMode;
  verdict: FactCheckVerdict;
  /** 어떤 내용을 팩트체크해야 하는지 (번호 텍스트 평문) */
  explanation: string;
  sources: string[];
  checkedAt: string;
  /** AI 답변 참고 이미지 (첫 장 — 하위 호환) */
  answerImageUrl?: string;
  /** AI 답변 참고 이미지 (복수, 번호 순서 평탄화) */
  answerImageUrls?: string[];
  /** 번호별 텍스트·이미지 묶음 */
  answerParts?: AnswerPart[];
}

export interface ReportEntry {
  itemId?: string;
  text: string;
  /** HTML 가능 */
  html?: string;
  imageUrl?: string;
  /** 팩트체크 답변 이미지 (첫 장 — 하위 호환) */
  answerImageUrl?: string;
  /** 팩트체크 답변 이미지 (복수) */
  answerImageUrls?: string[];
  /** 번호별 텍스트·이미지 묶음 */
  answerParts?: AnswerPart[];
}

export interface ReportSectionBlock {
  /** 클라이언트 편집용 안정 id (저장·재렌더 시 React key) */
  sectionId?: string;
  heading: string;
  /** plain 또는 HTML */
  body: string;
  /** true 이면 body를 HTML로 렌더 */
  rich?: boolean;
  imageUrl?: string;
  /** 첨부·손글씨 이미지들 */
  images?: string[];
  /** imageRoom 원본을 가리키는 참조 id들 */
  imageRefs?: string[];
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
  format?:
    | "general_v1"
    | "general_v2"
    | "general_v3"
    | "general_v4"
    | "general_v5"
    | "typed_legacy";
  /** 유형별 본문 섹션 */
  sections: ReportSectionBlock[];
  /** 요약 발췌 */
  summaryExcerpt: string;
  /** 보고서 전용 이미지 룸 (재사용용 URL/태그/메모) */
  imageRoom?: Array<
    | string
    | {
        id?: string;
        url: string;
        tag?: string;
        note?: string;
      }
  >;
  factChecks: Array<{
    itemId?: string;
    statement: string;
    checkGuide: string;
    verdict?: FactCheckVerdict;
    answerImageUrl?: string;
    answerImageUrls?: string[];
    answerParts?: AnswerPart[];
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
  /** 인라인 SVG (생성 직후·로컬 미리보기). DB에는 보통 비움 */
  svgMarkup: string;
  /** 외부 저장(Blob/로컬) SVG URL — 새로고침 후에도 유지 */
  svgUrl?: string;
}

export interface YoutubeChapter {
  startSec: number;
  timestamp: string;
  title: string;
}

export interface VideoRecord {
  id: string;
  /** youtube: URL·자막 자동 수집 / report: 스크립트·메타 직접 입력 */
  inputMode?: InputMode;
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
  /** 요약 출처: AI API / 수동 입력 / 휴리스틱 폴백 */
  summarySource?: "ai" | "manual" | "fallback" | "none";
  /** 일반 요약 단락 (핵심 포인트) */
  summaryBullets: string[];
  items: SummaryItem[];
  factChecks: FactCheckResult[];
  /**
   * 삭제한 팩트체크 항목 휴지통 (원복용). 최근 삭제분 최대 30건.
   */
  factCheckTrash?: Array<{
    item: SummaryItem;
    factCheck?: FactCheckResult | null;
    deletedAt: string;
  }>;
  /** 간편 붙여넣기란에 남긴 마지막 외부 AI 답변 (재진입·대조용) */
  factCheckPasteDraft?: string;
  /**
   * 팩트체크 초안 출처.
   * llm_draft: 인앱 OpenAI 초안 / prompt·heuristic: 질문만 두고 외부 AI 붙여넣기
   */
  factCheckSource?: "llm_draft" | "prompt" | "heuristic";
  /** 팩트체크 단계 안내 (인앱 초안 성공·폴백 설명) */
  factCheckNotice?: string;
  /**
   * 요약 수정으로 팩트체크 항목이 다시 만들어진 경우 안내.
   * dismissed면 배너 숨김.
   */
  factCheckRevisionNotice?: {
    at: string;
    itemCount: number;
    reason: "summary_edit" | "resummary";
    dismissed?: boolean;
  } | null;
  reportType: ReportType;
  report: TypedReport | null;
  /** llm: 글쓰기 AI / assembled: 요약·FC 조립(내용 적응형) */
  reportSource?: "llm" | "assembled";
  /** 보고서 작성 방식 안내 (AI 비용·폴백) */
  reportWriteNotice?: string;
  /**
   * 팩트체크 다시하기 후 「보고서 만들기」 시 본문 처리.
   * keep_body: 기존 본문 유지·FC만 반영 / rewrite: 글쓰기 AI·조립으로 재작성
   */
  pendingReportFinalize?: "keep_body" | "rewrite" | null;
  /** FC 단계에서 골격 보고서 본문을 수정했으면 finalize 시 본문 유지 */
  reportSkeletonEdited?: boolean;
  /** legacy */
  legacyReport?: ReportSection | null;
  infographic: InfographicData | null;
  /**
   * 인포그래픽 이미지 갤러리 (붙여넣기·사진첩).
   * 자동 SVG 생성은 하지 않음.
   */
  infographicBridgeImages?: string[] | null;
  status: PipelineStatus;
  errorMessage?: string;
  /** 시스템 태그 (파이프라인·검색용). 사용자 #분류는 userTags */
  tags: string[];
  /**
   * 사용자 분류 태그 (#조선 → "조선").
   * 주제 통합 보고서 선별·자동 분류에 사용. 시스템 tags 와 분리.
   */
  userTags?: string[];
  createdAt: string;
  updatedAt: string;
  sharedAt?: string;
}

/** 주제 폴더 — 여러 Entry(VideoRecord)를 모아 태그 기준 통합 보고서 작성 */
export type TopicStatus = "draft" | "ready";

export interface Topic {
  id: string;
  title: string;
  description?: string;
  /** 주제 기본 태그 (예: 역사팩트체크). # 없이 저장 */
  themeTag: string;
  /** 연결된 Entry(VideoRecord) id */
  entryIds: string[];
  /** 마지막 통합 시 선택한 분류 태그 */
  selectedComposeTags: string[];
  reportType: ReportType;
  report: TypedReport | null;
  status: TopicStatus;
  createdAt: string;
  updatedAt: string;
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

/** 유형별 한 줄 설명 — UI「설명 보기」용 */
export const REPORT_TYPE_HINTS: Record<ReportType, string> = {
  H: "사건·인물의 배경과 흐름을 정리하는 역사형 보고서입니다.",
  S: "시세·지표·리스크를 중심으로 정리하는 투자·시장형 보고서입니다.",
  C: "핵심 메시지와 실천 포인트를 짧게 정리하는 교양형 보고서입니다.",
  P: "쟁점·대립 의견·전망을 균형 있게 정리하는 시사형 보고서입니다.",
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
