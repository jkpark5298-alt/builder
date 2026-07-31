import { resolveAnswerParts } from "./answer-parts";
import { wrapFcAnchorText } from "./fc-markers";
import { normalizeImageUrls } from "./image-urls";
import { normalizeAiAnswer } from "./text-format";
import type {
  AnswerPart,
  FactCheckResult,
  FactCheckVerdict,
  SummaryItem,
  TypedReport,
  VideoRecord,
} from "./types";

export const FC_VERDICT_OPTIONS: FactCheckVerdict[] = [
  "true",
  "mostly_true",
  "false",
  "unverifiable",
];

export { normalizeSimpleVerdict } from "./labels";

export function isPromptOnlyExplanation(text: string | undefined): boolean {
  const t = (text ?? "").trim();
  if (!t) return true;
  return /^다음 주장을/.test(t) && /팩트체크/.test(t);
}

export function textToFactCheckHtml(text: string): string {
  const clean = normalizeAiAnswer(text).trim();
  if (!clean) return "";
  return clean
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        `<p>${p
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/\n/g, "<br>")}</p>`
    )
    .join("");
}

/** 본문 삽입용 HTML — 주장 줄에 itemId 앵커를 붙인다 */
export function factCheckPasteHtml(opts: {
  itemId: string;
  statement: string;
  answerText?: string;
}): string {
  const title = `【FC】 ${opts.statement}`.trim();
  const head = `<p>${wrapFcAnchorText(opts.itemId, title)}</p>`;
  const body = opts.answerText ? textToFactCheckHtml(opts.answerText) : "";
  return `${head}${body}`;
}

export type FactCheckDetailSource = {
  itemId?: string;
  label: string;
  statement: string;
  detail: string;
  answerText: string;
  parts: AnswerPart[] | null;
  images: string[];
  verdict: FactCheckVerdict;
};

type ReportFc = TypedReport["factChecks"][number];

export function resolveFactCheckDetailSource(opts: {
  label: string;
  statementFallback: string;
  item?: SummaryItem;
  videoFc?: FactCheckResult;
  reportFc?: ReportFc;
  entry?: {
    text?: string;
    html?: string;
    answerImageUrl?: string;
    answerImageUrls?: string[];
    answerParts?: AnswerPart[];
  };
}): FactCheckDetailSource {
  const { item, videoFc, reportFc, entry } = opts;
  const answerFromVideo = !isPromptOnlyExplanation(videoFc?.explanation)
    ? normalizeAiAnswer(videoFc?.explanation || "")
    : "";
  const answerFromReport = (reportFc?.checkGuide || "").trim();
  const parts =
    entry?.answerParts?.length
      ? entry.answerParts
      : videoFc?.answerParts?.length
        ? videoFc.answerParts
        : reportFc?.answerParts?.length
          ? reportFc.answerParts
          : null;
  const partsText = parts?.map((p) => `${p.number}. ${p.text}`).join("\n") || "";
  const answerText =
    answerFromVideo ||
    answerFromReport ||
    partsText ||
    entry?.html?.replace(/<[^>]+>/g, "") ||
    "";

  const verdict = (videoFc?.verdict ??
    reportFc?.verdict ??
    "pending") as FactCheckVerdict;

  const images = Array.from(
    new Set(
      [
        ...normalizeImageUrls(entry?.answerImageUrl, entry?.answerImageUrls),
        ...normalizeImageUrls(videoFc?.answerImageUrl, videoFc?.answerImageUrls),
        ...normalizeImageUrls(
          reportFc?.answerImageUrl,
          reportFc?.answerImageUrls
        ),
        ...(parts ?? []).flatMap((p) => p.imageUrls ?? []),
        ...(item ? normalizeImageUrls(item.imageUrl, item.imageUrls) : []),
      ].filter((u) => Boolean(u) && !/i\.ytimg\.com|ytimg\.com\/vi\//i.test(u))
    )
  );

  return {
    itemId: item?.id,
    label: opts.label,
    statement: item?.statement || entry?.text || opts.statementFallback,
    detail: item?.detail || "",
    answerText,
    parts,
    images,
    verdict,
  };
}

export function resolveFactCheckDetailSourceWithId(
  opts: Parameters<typeof resolveFactCheckDetailSource>[0] & {
    itemId?: string;
  }
): FactCheckDetailSource {
  const base = resolveFactCheckDetailSource(opts);
  return {
    ...base,
    itemId: opts.itemId ?? opts.item?.id,
  };
}

export async function clearFactCheckDetailApi(
  videoId: string,
  itemId: string
): Promise<VideoRecord> {
  const res = await fetch(`/api/videos/${videoId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clearFactCheckDetail: { itemId },
      preserveReadyStatus: true,
    }),
  });
  const data = (await res.json()) as { error?: string; video?: VideoRecord };
  if (!res.ok) throw new Error(data.error || "DETAIL 삭제 실패");
  if (!data.video) throw new Error("DETAIL 삭제 실패");
  return data.video;
}

export async function deleteFactCheckItemApi(
  videoId: string,
  itemId: string
): Promise<VideoRecord> {
  const res = await fetch(`/api/videos/${videoId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      deleteItem: { itemId },
      preserveReadyStatus: true,
    }),
  });
  const data = (await res.json()) as { error?: string; video?: VideoRecord };
  if (!res.ok) throw new Error(data.error || "전체 삭제 실패");
  if (!data.video) throw new Error("전체 삭제 실패");
  return data.video;
}

export async function saveFactCheckEditApi(
  videoId: string,
  opts: {
    itemId: string;
    statement: string;
    detail: string;
    explanation: string;
    verdict: FactCheckVerdict;
    prev?: FactCheckResult;
  }
): Promise<VideoRecord> {
  const explanation = normalizeAiAnswer(opts.explanation.trim());
  if (explanation.length < 20) {
    throw new Error("팩트체크 답변을 20자 이상 입력해 주세요.");
  }
  if (!opts.statement.trim()) {
    throw new Error("주장을 입력해 주세요.");
  }

  const itemRes = await fetch(`/api/videos/${videoId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      updateItem: {
        itemId: opts.itemId,
        statement: opts.statement.trim(),
        detail: opts.detail.trim() || null,
      },
      preserveReadyStatus: true,
    }),
  });
  const itemData = (await itemRes.json()) as {
    error?: string;
    video?: VideoRecord;
  };
  if (!itemRes.ok) throw new Error(itemData.error || "주장 수정 실패");

  const prev =
    (itemData.video?.factChecks ?? []).find((f) => f.itemId === opts.itemId) ??
    opts.prev;
  const nextParts = resolveAnswerParts({
    explanation,
    answerImageUrl: prev?.answerImageUrl,
    answerImageUrls: prev?.answerImageUrls,
    answerParts: prev?.answerParts,
  });

  const fcRes = await fetch(`/api/videos/${videoId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      factCheck: {
        itemId: opts.itemId,
        verdict: opts.verdict === "pending" ? "unverifiable" : opts.verdict,
        explanation,
        sources: prev?.sources ?? [],
        answerParts: nextParts,
      },
      preserveReadyStatus: true,
    }),
  });
  const fcData = (await fcRes.json()) as {
    error?: string;
    video?: VideoRecord;
  };
  if (!fcRes.ok) throw new Error(fcData.error || "답변 저장 실패");
  if (!fcData.video) throw new Error("답변 저장 실패");
  return fcData.video;
}
