"use client";

import {
  Check,
  FileText,
  ImagePlus,
  Link2,
  Loader2,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { hasUsablePastedScript, normalizePastedText } from "@/lib/paste";
import { extractVideoId } from "@/lib/youtube";
import { releaseMediaUrls } from "@/lib/media-upload-client";
import {
  dropArticleImages,
  organizeUrlArticleText,
} from "@/lib/url-article-report";
import { cacheVideoSnapshot } from "./VideoNotFoundRecovery";

const STORAGE_KEY = "yfc-url-article-form-v1";
const POST_TIMEOUT_MS = 150_000;
const FETCH_TIMEOUT_MS = 60_000;

export type UrlArticleFormValues = {
  title: string;
  sourceUrl: string;
  channel: string;
  pastedScript: string;
  thumbnailUrl?: string;
  articleImages?: string[];
};

function loadSaved(): Partial<UrlArticleFormValues> {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<UrlArticleFormValues>) : {};
  } catch {
    return {};
  }
}

function saveForm(data: UrlArticleFormValues) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* quota */
  }
}

type FetchedArticle = {
  url: string;
  title: string;
  siteName?: string;
  text: string;
  images: string[];
  thumbnailUrl?: string;
  imageCount: number;
  skippedImages: number;
};

export function UrlArticleForm({
  draftId,
  initial,
}: {
  draftId?: string;
  initial?: Partial<UrlArticleFormValues>;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [sourceUrl, setSourceUrl] = useState(initial?.sourceUrl ?? "");
  const [channel, setChannel] = useState(initial?.channel ?? "");
  const [pastedScript, setPastedScript] = useState(initial?.pastedScript ?? "");
  const [articleImages, setArticleImages] = useState<string[]>(
    initial?.articleImages ?? []
  );
  const [thumbnailUrl, setThumbnailUrl] = useState(
    initial?.thumbnailUrl?.trim() || ""
  );
  const [fetching, setFetching] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(Boolean(draftId || initial));
  const [fetchedOk, setFetchedOk] = useState(
    Boolean(initial?.pastedScript && hasUsablePastedScript(initial.pastedScript))
  );

  useEffect(() => {
    if (draftId || initial) return;
    const saved = loadSaved();
    if (saved.title) setTitle(saved.title);
    if (saved.sourceUrl) setSourceUrl(saved.sourceUrl);
    if (saved.channel) setChannel(saved.channel);
    if (saved.pastedScript) {
      setPastedScript(saved.pastedScript);
      if (hasUsablePastedScript(saved.pastedScript)) setFetchedOk(true);
    }
    if (saved.articleImages?.length) setArticleImages(saved.articleImages);
    if (saved.thumbnailUrl) setThumbnailUrl(saved.thumbnailUrl);
    setHydrated(true);
  }, [draftId, initial]);

  useEffect(() => {
    if (!hydrated || draftId || initial) return;
    saveForm({
      title,
      sourceUrl,
      channel,
      pastedScript,
      thumbnailUrl,
      articleImages,
    });
  }, [
    title,
    sourceUrl,
    channel,
    pastedScript,
    thumbnailUrl,
    articleImages,
    hydrated,
    draftId,
    initial,
  ]);

  const scriptLen = normalizePastedText(pastedScript).length;
  const hasScript = hasUsablePastedScript(pastedScript);
  const step1Done = title.trim().length >= 2 && Boolean(sourceUrl.trim());
  const isContinuing = Boolean(draftId);

  function formPayload() {
    return {
      title: title.trim(),
      channel: channel.trim() || undefined,
      pastedScript: normalizePastedText(pastedScript),
      thumbnailUrl: thumbnailUrl.trim() || articleImages[0] || undefined,
      sourceUrl: sourceUrl.trim(),
      articleImages,
    };
  }

  async function parseJsonResponse(res: Response): Promise<{
    error?: string;
    video?: { id: string; status?: string };
    article?: FetchedArticle;
  }> {
    const text = await res.text();
    try {
      return JSON.parse(text) as {
        error?: string;
        video?: { id: string; status?: string };
        article?: FetchedArticle;
      };
    } catch {
      throw new Error(text.trim().slice(0, 180) || `서버 오류 (${res.status})`);
    }
  }

  async function fetchArticle() {
    setError(null);
    setStatus(null);
    const url = sourceUrl.trim();
    if (!url) {
      setError("URL을 입력해 주세요.");
      return;
    }
    if (extractVideoId(url)) {
      setError("유튜브 주소입니다. 홈 「유튜브」 탭에서 가져와 주세요.");
      return;
    }

    setFetching(true);
    setStatus("페이지 본문과 이미지를 가져오는 중…");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch("/api/article/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ url }),
      });
      const data = await parseJsonResponse(res);
      if (!res.ok || !data.article) {
        throw new Error(data.error || "본문을 가져오지 못했습니다.");
      }
      const article = data.article;
      const cleaned = organizeUrlArticleText(article.text, {
        keepImageMarkers: true,
      });
      setSourceUrl(article.url || url);
      if (!title.trim() && article.title) setTitle(article.title);
      if (!channel.trim() && article.siteName) setChannel(article.siteName);
      setPastedScript(cleaned || article.text);
      setArticleImages(article.images ?? []);
      if (article.thumbnailUrl) setThumbnailUrl(article.thumbnailUrl);
      setFetchedOk(true);
      const shown = cleaned || article.text;
      setStatus(
        `본문 ${shown.length.toLocaleString()}자 · 이미지 ${article.imageCount}장을 가져와 정리했습니다.${
          article.skippedImages
            ? ` (건너뛴 이미지 ${article.skippedImages}장)`
            : ""
        } 필요 없는 사진은 지운 뒤 「보고서 만들기」를 누르세요.`
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError("가져오기 시간이 초과됐습니다. 다시 시도해 주세요.");
      } else {
        setError(err instanceof Error ? err.message : "본문을 가져오지 못했습니다.");
      }
      setStatus(null);
    } finally {
      clearTimeout(timer);
      setFetching(false);
    }
  }

  async function startSummary(manual: boolean) {
    setError(null);
    if (title.trim().length < 2) {
      setError("제목을 2자 이상 입력해 주세요.");
      return;
    }
    if (!sourceUrl.trim()) {
      setError("URL을 입력해 주세요.");
      return;
    }
    if (!hasScript && !manual) {
      setError("본문을 먼저 가져온 뒤 AI 요약을 시작하세요. 또는 수동 요약을 고르세요.");
      return;
    }

    setLoading(true);
    setStatus("원문을 보고서 본문으로 넣는 중…");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), POST_TIMEOUT_MS);
    try {
      if (draftId) {
        const res = await fetch(`/api/videos/${draftId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            startReportPipeline: true,
            manualOverview: manual,
            updateReportInput: formPayload(),
          }),
        });
        const data = await parseJsonResponse(res);
        if (!res.ok || !data.video?.id) {
          throw new Error(data.error || "보고서 만들기 실패");
        }
        if (data.video.status === "report_input_draft") {
          throw new Error(
            "보고서가 만들어지지 않았습니다. 새로고침 후 다시 시도해 주세요."
          );
        }
        cacheVideoSnapshot(data.video);
        setStatus("완료. 다음 화면으로 이동합니다…");
        window.location.assign(`/videos/${data.video.id}#report`);
        return;
      }

      const res = await fetch("/api/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          mode: "report",
          manualOverview: manual,
          ...formPayload(),
        }),
      });
      const data = await parseJsonResponse(res);
      if (!res.ok || !data.video?.id) {
        throw new Error(data.error || "보고서 만들기 실패");
      }
      cacheVideoSnapshot(data.video);
      setStatus("완료. 보고서로 이동합니다…");
      window.location.assign(`/videos/${data.video.id}#report`);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError(
          "요약에 시간이 오래 걸렸습니다. Wi‑Fi를 확인하고 다시 시도해 주세요."
        );
      } else {
        setError(err instanceof Error ? err.message : "처리 실패");
      }
      setStatus(null);
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!fetchedOk || !hasScript) {
      await fetchArticle();
      return;
    }
    await startSummary(false);
  }

  const busy = fetching || loading;

  function organizePreview() {
    const next = organizeUrlArticleText(pastedScript, {
      keepImageMarkers: true,
    });
    if (!next) {
      setError("정리할 본문이 없습니다.");
      return;
    }
    setError(null);
    setPastedScript(next);
    setStatus(
      `본문을 정리했습니다 · ${next.length.toLocaleString()}자 · 이미지 ${articleImages.length}장`
    );
  }

  function removePreviewImages(drop: string[]) {
    const urls = drop.map((u) => u.trim()).filter(Boolean);
    if (!urls.length) return;
    const next = dropArticleImages(pastedScript, articleImages, urls);
    setPastedScript(next.text);
    setArticleImages(next.images);
    if (!next.images.includes(thumbnailUrl)) {
      setThumbnailUrl(next.images[0] || "");
    }
    void releaseMediaUrls(urls);
    setStatus(
      next.images.length
        ? `사진 ${urls.length}장을 뺐습니다 · 남은 이미지 ${next.images.length}장`
        : "사진을 모두 뺐습니다. 본문만 보고서로 만듭니다."
    );
  }

  function removeAllPreviewImages() {
    if (!articleImages.length) return;
    if (!confirm(`가져온 사진 ${articleImages.length}장을 모두 지울까요?`)) {
      return;
    }
    removePreviewImages(articleImages);
  }

  return (
    <form
      id="url-article"
      onSubmit={onSubmit}
      className="relative rounded-2xl border border-ink-200 bg-white/80 p-5 sm:p-6 shadow-sm pb-40 sm:pb-6"
    >
      <div className="relative space-y-4">
        <div className="flex items-center gap-2 text-accent">
          <Link2 className="h-5 w-5" />
          <span className="text-sm font-medium tracking-wide uppercase">
            URL 입력
          </span>
        </div>
        <div>
          <h2 className="font-display text-2xl sm:text-3xl text-ink-900 mb-2">
            {isContinuing ? "URL 본문 이어서 작성" : "URL로 보고서 만들기"}
          </h2>
          <p className="text-sm text-ink-600 leading-relaxed">
            제목과 기사 URL을 넣은 뒤 본문·이미지를 가져옵니다. 가져온 뒤{" "}
            <strong>본문 정리</strong>로 관련기사·저작권 문구를 걷고, 필요 없는
            사진은 지울 수 있습니다. <strong>보고서 만들기</strong>를 누르면
            정리한 글이 본문이 되고, 남긴 사진은 본문 아래에 붙습니다.
            요약(수동·추후 AI)과 팩트체크는 선택입니다.
          </p>
        </div>

        <label className="block text-sm text-ink-600">
          ① 제목 <span className="text-verify-false">*</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="비워 두면 페이지 제목을 가져옵니다"
            className="mt-1.5 w-full rounded-xl border border-ink-200 bg-white px-4 py-3.5 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </label>

        <label className="block text-sm text-ink-600">
          ② URL <span className="text-verify-false">*</span>
          <input
            value={sourceUrl}
            onChange={(e) => {
              setSourceUrl(e.target.value);
              setFetchedOk(false);
            }}
            placeholder="https:// 기사·웹 글 주소"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="url"
            className="mt-1.5 w-full rounded-xl border border-ink-200 bg-white px-4 py-3.5 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </label>

        <button
          type="button"
          disabled={busy || !sourceUrl.trim()}
          onClick={() => void fetchArticle()}
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-accent/40 bg-accent-muted/40 min-h-12 px-5 text-sm font-medium text-ink-900 hover:bg-accent-muted disabled:opacity-50"
        >
          {fetching ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              본문·이미지 가져오는 중…
            </>
          ) : (
            <>
              <ImagePlus className="h-4 w-4" />
              본문·이미지 가져오기
            </>
          )}
        </button>

        {fetchedOk && (
          <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
            <p className="text-xs font-medium text-emerald-800">
              가져온 본문 미리보기
              {hasScript
                ? ` · ${scriptLen.toLocaleString()}자 · 이미지 ${articleImages.length}장`
                : ""}
            </p>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                disabled={busy || !pastedScript.trim()}
                onClick={organizePreview}
                className="inline-flex items-center gap-1 rounded-lg border border-accent/40 bg-white px-2.5 py-1.5 text-xs font-medium text-ink-800 hover:border-accent disabled:opacity-50"
              >
                <Sparkles className="h-3.5 w-3.5" />
                본문 정리
              </button>
              {articleImages.length > 0 && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={removeAllPreviewImages}
                  className="inline-flex items-center gap-1 rounded-lg border border-verify-false/40 bg-white px-2.5 py-1.5 text-xs font-medium text-verify-false hover:border-verify-false disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  사진 모두 삭제
                </button>
              )}
            </div>
            {articleImages.length > 0 && (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {articleImages.map((src, i) => (
                  <div
                    key={`${src}-${i}`}
                    className="relative overflow-hidden rounded-lg border border-ink-200 bg-ink-50"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={src}
                      alt={`본문 이미지 ${i + 1}`}
                      className="aspect-video w-full object-cover"
                    />
                    <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                      {i + 1}
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => removePreviewImages([src])}
                      className="absolute top-1 right-1 rounded-md bg-white/95 border border-ink-200 p-1 hover:border-verify-false disabled:opacity-50"
                      title={`${i + 1}번 사진 삭제`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <textarea
              value={pastedScript}
              onChange={(e) => setPastedScript(e.target.value)}
              rows={10}
              className="w-full rounded-xl border border-ink-200 bg-white px-3 py-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </div>
        )}

        <label className="block text-sm text-ink-600">
          매체·사이트 (선택)
          <input
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            placeholder="가져오기 후 자동으로 채워질 수 있습니다"
            className="mt-1.5 w-full rounded-xl border border-ink-200 bg-white px-4 py-3 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </label>

        {(busy || status) && (
          <div
            className="rounded-xl border border-ink-200 bg-ink-50 px-4 py-3 text-sm text-ink-700"
            role="status"
          >
            {status || (fetching ? "가져오는 중…" : "처리 중…")}
          </div>
        )}
        {error && (
          <p
            className="rounded-xl border border-verify-false/30 bg-verify-false/5 px-4 py-3 text-sm text-verify-false font-medium"
            role="alert"
          >
            {error}
          </p>
        )}
      </div>

      <div className="fixed bottom-0 inset-x-0 z-50 sm:static sm:z-auto border-t border-ink-200 sm:border-0 bg-white/95 sm:bg-transparent backdrop-blur px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-0 sm:mt-4 space-y-2">
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            onClick={() => void startSummary(false)}
            disabled={busy || !step1Done || !hasScript}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-accent min-h-12 px-5 py-3.5 text-white font-medium hover:bg-ink-900 disabled:opacity-60 transition-colors shadow-lg sm:shadow-none"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                보고서 만드는 중…
              </>
            ) : (
              <>
                <FileText className="h-4 w-4" />
                보고서 만들기
              </>
            )}
          </button>
        </div>
        {step1Done && !busy && !error && (
          <p className="text-center text-xs text-ink-500 flex items-center justify-center gap-1">
            <Check className="h-3.5 w-3.5 text-emerald-600" />
            {hasScript
              ? "보고서 만들기 → 정리한 본문·남긴 사진. 요약·팩트체크는 선택"
              : "본문을 가져온 뒤 보고서를 만들 수 있습니다"}
          </p>
        )}
      </div>
    </form>
  );
}
