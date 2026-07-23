import { chatJson, hasLlm } from "./llm";
import {
  buildTypedReport,
  highlightConclusion,
} from "./report";
import { normalizeImageUrls, splitPrimaryImage } from "./image-urls";
import { resolveAnswerParts } from "./answer-parts";
import { dedupeTexts, normalizeAiAnswer } from "./text-format";
import { REPORT_TYPE_LABELS } from "./types";
import type {
  FactCheckResult,
  SummaryItem,
  TypedReport,
  VideoRecord,
} from "./types";

export type ReportBuildResult = {
  report: TypedReport;
  /** llm: 글쓰기 AI / assembled: 요약·FC 기반 조립(내용 적응형) */
  source: "llm" | "assembled";
  notice?: string;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function plainToHtml(body: string): string {
  const clean = body.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const paras = body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paras.length <= 1) {
    return `<p>${escapeHtml(body.trim())}</p>`;
  }
  return paras.map((p) => `<p>${escapeHtml(p)}</p>`).join("");
}

function entryFromItem(
  item: SummaryItem,
  fc?: FactCheckResult
) {
  const parts = resolveAnswerParts({
    explanation: fc?.explanation,
    answerImageUrl: fc?.answerImageUrl,
    answerImageUrls: fc?.answerImageUrls,
    answerParts: fc?.answerParts,
  });
  const flatImages = parts.flatMap((p) => p.imageUrls ?? []);
  const split = splitPrimaryImage(flatImages);
  const targetImages = normalizeImageUrls(item.imageUrl, item.imageUrls);
  return {
    itemId: item.id,
    text: item.statement,
    answerImageUrl: split.imageUrl,
    answerImageUrls: split.imageUrls,
    answerParts: parts.length ? parts : undefined,
    targetImages,
  };
}

/**
 * 글쓰기 AI로 요약·팩트체크에 맞는 적응형 보고서 작성.
 * 실패·키 없음 시 null (호출측에서 조립 폴백).
 */
export async function writeReportWithLlm(
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
    | "inputMode"
  >
): Promise<TypedReport | null> {
  if (!hasLlm()) return null;

  const fcItems = video.items.filter((i) => i.needsFactCheck);
  const fcMap = new Map(video.factChecks.map((f) => [f.itemId, f]));

  const system = `당신은 한국어 보고서 작성자입니다.
입력된 **요약**과 **팩트체크 결과**만 근거로, 고정 양식(역사/주식 템플릿)에 억지로 맞추지 말고
이번 내용에 맞는 목차·서술 깊이의 보고서를 작성하세요.

규칙:
- 요약·검증에 없는 사실을 새로 만들지 마세요.
- 오류·과장·미확인 판정은 본문에 분명히 드러내세요.
- 섹션 수는 내용에 맞게 2~8개. 짧은 주제면 적게, 쟁점이 많으면 나누세요.
- 첫 섹션은 보통 "결론"을 권장하되, 내용상 다른 제목이 더 맞으면 바꿔도 됩니다.
- body는 평문(마크다운 ### 금지). 문단은 빈 줄로 구분.
- relatedItemIds에는 그 섹션과 관련된 팩트체크 itemId만 넣으세요(없으면 []).

JSON:
{
  "summaryExcerpt": string,
  "sections": [
    { "heading": string, "body": string, "relatedItemIds": string[] }
  ]
}`;

  try {
    const llm = await chatJson<{
      summaryExcerpt?: string;
      sections?: Array<{
        heading?: string;
        body?: string;
        relatedItemIds?: string[];
      }>;
    }>(
      system,
      JSON.stringify({
        title: video.title,
        channel: video.channel,
        overview: video.overview?.slice(0, 12_000),
        summaryBullets: video.summaryBullets?.slice(0, 16),
        factChecks: fcItems.map((i) => {
          const fc = fcMap.get(i.id);
          return {
            itemId: i.id,
            statement: i.statement,
            detail: i.detail,
            verdict: fc?.verdict ?? "pending",
            answer: normalizeAiAnswer(fc?.explanation || "").slice(0, 2_500),
          };
        }),
      }),
      { maxTokens: 7_000, temperature: 0.35, timeoutMs: 120_000 }
    );

    const rawSections = llm?.sections?.filter(
      (s) => s?.heading?.trim() && String(s.body ?? "").trim().length >= 12
    );
    if (!rawSections?.length) return null;

    const usedItemIds = new Set<string>();
    const sections: TypedReport["sections"] = rawSections.map((s, idx) => {
      const heading = String(s.heading).trim().slice(0, 80);
      const bodyText = String(s.body ?? "").trim();
      const isConclusion = idx === 0 || /^결론/.test(heading);
      const related = (s.relatedItemIds ?? [])
        .map(String)
        .filter((id) => fcMap.has(id) || fcItems.some((i) => i.id === id));

      const entries = [];
      const images: string[] = [];
      for (const id of related) {
        const item = fcItems.find((i) => i.id === id);
        if (!item || usedItemIds.has(id)) continue;
        usedItemIds.add(id);
        const bundled = entryFromItem(item, fcMap.get(id));
        entries.push({
          itemId: bundled.itemId,
          text: bundled.text,
          answerImageUrl: bundled.answerImageUrl,
          answerImageUrls: bundled.answerImageUrls,
          answerParts: bundled.answerParts,
        });
        images.push(...bundled.targetImages);
      }

      return {
        heading,
        body: isConclusion
          ? highlightConclusion(bodyText.replace(/<[^>]+>/g, ""))
          : plainToHtml(bodyText),
        rich: true as const,
        images: images.length ? Array.from(new Set(images)) : undefined,
        entries: entries.length ? entries : undefined,
      };
    });

    const leftover = fcItems.filter((i) => !usedItemIds.has(i.id));
    if (leftover.length) {
      const images: string[] = [];
      const entries = leftover.map((item) => {
        const bundled = entryFromItem(item, fcMap.get(item.id));
        images.push(...bundled.targetImages);
        return {
          itemId: bundled.itemId,
          text: bundled.text,
          answerImageUrl: bundled.answerImageUrl,
          answerImageUrls: bundled.answerImageUrls,
          answerParts: bundled.answerParts,
        };
      });
      sections.push({
        heading: "검증 상세",
        body: `<p>${escapeHtml(
          "아래는 본문 섹션에 직접 묶이지 않은 팩트체크 항목입니다."
        )}</p>`,
        rich: true,
        images: images.length ? Array.from(new Set(images)) : undefined,
        entries,
      });
    }

    const writtenAt = new Date(
      video.updatedAt || video.createdAt
    ).toLocaleString("ko-KR");

    const inlineFactChecks = fcItems.map((i) => {
      const fc = fcMap.get(i.id);
      const raw = fc?.explanation?.trim() ?? "";
      const isPrompt =
        !raw || (/^다음 주장을/.test(raw) && /팩트체크/.test(raw));
      const parts = resolveAnswerParts({
        explanation: isPrompt ? "" : raw,
        answerImageUrl: fc?.answerImageUrl,
        answerImageUrls: fc?.answerImageUrls,
        answerParts: fc?.answerParts,
      });
      const flat = parts.flatMap((p) => p.imageUrls ?? []);
      const split = splitPrimaryImage(flat);
      return {
        itemId: i.id,
        statement: i.statement,
        verdict: fc?.verdict ?? ("pending" as const),
        checkGuide: isPrompt ? "" : normalizeAiAnswer(raw),
        answerImageUrl: split.imageUrl,
        answerImageUrls: split.imageUrls,
        answerParts: parts.length ? parts : undefined,
      };
    });

    const summaryExcerpt =
      llm?.summaryExcerpt?.trim() ||
      dedupeTexts([
        sections[0] ? `결론: ${sections[0].heading}` : "",
        ...sections.slice(1, 6).map((s, i) => `${i + 1}. ${s.heading}`),
      ])
        .filter(Boolean)
        .join("\n");

    return {
      meta: {
        title: video.title,
        channel: video.channel,
        url:
          video.inputMode === "report"
            ? "Report 생성 (직접 입력)"
            : video.youtubeUrl,
        writtenAt,
      },
      reportType: video.reportType,
      reportTypeLabel: REPORT_TYPE_LABELS[video.reportType] || "일반 보고서",
      format: "general_v5" as const,
      sections,
      summaryExcerpt,
      factChecks: inlineFactChecks.map((f) => ({
        itemId: f.itemId,
        statement: f.statement,
        checkGuide: f.checkGuide,
        verdict: f.verdict,
        answerImageUrl: f.answerImageUrl,
        answerImageUrls: f.answerImageUrls,
        answerParts: f.answerParts,
      })),
    };
  } catch (e) {
    console.error("[report-write] writeReportWithLlm failed", e);
    return null;
  }
}

/**
 * 1순위: 글쓰기 AI → 실패 시 요약·FC 조립(내용 적응형, 기존 buildTypedReport)
 */
export async function buildReportDocument(
  video: Parameters<typeof buildTypedReport>[0]
): Promise<ReportBuildResult> {
  const llmReport = await writeReportWithLlm(video);
  if (llmReport?.sections?.length) {
    return {
      report: llmReport,
      source: "llm",
      notice:
        "글쓰기 AI로 보고서를 작성했습니다. (OpenAI 토큰 사용) 에디터에서 수정할 수 있습니다.",
    };
  }

  return {
    report: buildTypedReport(video),
    source: "assembled",
    notice: !hasLlm()
      ? "OPENAI_API_KEY가 없어 글쓰기 AI를 쓰지 못했습니다. 요약·팩트체크 결과로 보고서를 조립했습니다."
      : "글쓰기 AI 작성에 실패해, 요약·팩트체크 결과로 내용 적응형 보고서를 조립했습니다. (추가 LLM 비용 없음)",
  };
}
