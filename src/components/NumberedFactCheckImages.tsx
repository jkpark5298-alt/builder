"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import type { FactCheckResult, SummaryItem, VideoRecord } from "@/lib/types";
import { isItemChecked } from "@/lib/factcheck-client";
import { compressDataUrls } from "@/lib/image-client";
import { uploadDataUrls } from "@/lib/media-upload-client";
import { normalizeImageUrls } from "@/lib/image-urls";
import { verdictLabel } from "@/lib/labels";
import { ImageAttachArea } from "@/components/ImageAttachArea";
import { FactCheckRestoreActions } from "@/components/FactCheckRestoreActions";

/**
 * 항목 번호(1·2·3)마다 이미지 1칸 + 대상 추가/삭제.
 * after_confirm: 역사 FC 확정 후 — 이미지 첨부만 (대상 추가/삭제 숨김)
 */
export function NumberedFactCheckImages({
  video,
  onVideoUpdate,
  variant = "during_fc",
}: {
  video: VideoRecord;
  onVideoUpdate: (v: VideoRecord) => void;
  variant?: "during_fc" | "after_confirm";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addStatement, setAddStatement] = useState("");
  const manageTargets = variant === "during_fc";

  const items = useMemo(
    () => video.items.filter((i) => i.needsFactCheck),
    [video.items]
  );

  async function addItem() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/videos/${video.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft: true,
          addFactCheckItem: {
            statement: addStatement.trim() || undefined,
          },
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        video?: VideoRecord;
      };
      if (!res.ok || !data.video) {
        throw new Error(data.error || "항목 추가 실패");
      }
      setAddStatement("");
      onVideoUpdate(data.video);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "항목 추가 실패");
    } finally {
      setBusy(false);
    }
  }

  async function deleteItem(itemId: string) {
    if (!confirm("이 팩트체크 대상을 삭제할까요? 답변·이미지도 함께 삭제됩니다.")) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/videos/${video.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft: true,
          deleteItem: { itemId },
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        video?: VideoRecord;
      };
      if (!res.ok || !data.video) {
        throw new Error(data.error || "삭제 실패");
      }
      onVideoUpdate(data.video);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "삭제 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-accent/30 bg-white px-3 py-3 sm:px-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-ink-900">
            {variant === "after_confirm"
              ? "번호별 참고 이미지"
              : "항목별 이미지 · 대상"}
          </p>
          <details className="mt-1">
            <summary className="cursor-pointer select-none text-xs text-ink-500 hover:text-ink-800">
              사용 방법 보기
            </summary>
            <p className="text-xs text-ink-500 mt-1">
              {variant === "after_confirm" ? (
                <>
                  · <strong>N번 이미지</strong> — 확정된 각 주장에 참고 이미지를
                  붙입니다.
                  <br />· 대상 추가·삭제는 팩트체크 단계에서 합니다.
                </>
              ) : (
                <>
                  · <strong>대상 추가</strong> — 붙여넣기 없이 검증할 주장을 직접
                  하나 더 만듭니다.
                  <br />· <strong>삭제</strong> — 해당 번호 대상·답변·이미지를
                  지웁니다 (원복 가능).
                  <br />· <strong>N번 이미지</strong> — 그 주장에 참고 이미지를
                  붙입니다.
                </>
              )}
            </p>
          </details>
        </div>
        {manageTargets && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void addItem()}
            className="inline-flex items-center gap-1.5 min-h-10 rounded-xl border border-accent/40 bg-accent-muted/40 px-3 text-sm font-medium disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            대상 추가
          </button>
        )}
      </div>

      {manageTargets && (video.factCheckTrash?.length ?? 0) > 0 && (
        <FactCheckRestoreActions
          video={video}
          onVideoUpdate={onVideoUpdate}
          compact
        />
      )}

      {manageTargets && (
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={addStatement}
            onChange={(e) => setAddStatement(e.target.value)}
            placeholder="새 대상 주장 (비우면 ‘새 팩트체크 대상’)"
            className="flex-1 min-h-10 rounded-xl border border-ink-200 px-3 text-sm outline-none focus:border-accent"
          />
        </div>
      )}

      {error && (
        <p className="text-sm text-verify-false" role="alert">
          {error}
        </p>
      )}

      {!items.length ? (
        <p className="text-sm text-ink-500 rounded-lg border border-dashed border-ink-200 px-3 py-4 text-center">
          아직 대상이 없습니다.
          {manageTargets
            ? " 「대상 추가」또는 위 답변 적용으로 만드세요."
            : ""}
        </p>
      ) : (
        items.map((item, idx) => {
          const fc = video.factChecks.find((f) => f.itemId === item.id);
          return (
            <ItemImageSlot
              key={item.id}
              videoId={video.id}
              item={item}
              index={idx}
              fc={fc}
              busyAll={busy}
              allowDelete={manageTargets}
              onDelete={() => void deleteItem(item.id)}
              onVideoUpdate={onVideoUpdate}
            />
          );
        })
      )}
    </div>
  );
}

function ItemImageSlot({
  videoId,
  item,
  index,
  fc,
  busyAll,
  allowDelete,
  onDelete,
  onVideoUpdate,
}: {
  videoId: string;
  item: SummaryItem;
  index: number;
  fc?: FactCheckResult;
  busyAll: boolean;
  allowDelete: boolean;
  onDelete: () => void;
  onVideoUpdate: (v: VideoRecord) => void;
}) {
  const router = useRouter();
  const done = fc ? isItemChecked(item.id, [fc]) : false;
  const [images, setImages] = useState<string[]>(() =>
    normalizeImageUrls(fc?.answerImageUrl, fc?.answerImageUrls)
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setImages(normalizeImageUrls(fc?.answerImageUrl, fc?.answerImageUrls));
  }, [fc?.answerImageUrl, fc?.answerImageUrls, item.id]);

  async function persistImages(urls: string[]) {
    if (!fc) {
      alert("먼저 답변을 적용하거나 「추가」에서 답변을 입력해 주세요.");
      return;
    }
    setBusy(true);
    try {
      const compressed = await compressDataUrls(urls);
      const uploaded = await uploadDataUrls(
        compressed,
        `videos/${videoId}/fc`
      );
      const parts = [
        {
          number: 1,
          text: fc.explanation,
          imageUrls: uploaded,
        },
      ];
      const res = await fetch(`/api/videos/${videoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft: true,
          answerImages: {
            itemId: item.id,
            imageUrls: uploaded,
            answerParts: parts,
          },
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        video?: VideoRecord;
      };
      if (!res.ok) throw new Error(data.error || "이미지 저장 실패");

      const savedFc = data.video?.factChecks.find((f) => f.itemId === item.id);
      const savedUrls = savedFc
        ? normalizeImageUrls(savedFc.answerImageUrl, savedFc.answerImageUrls)
        : uploaded;
      setImages(savedUrls);
      if (data.video) onVideoUpdate(data.video);
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "이미지 저장 실패");
    } finally {
      setBusy(false);
    }
  }

  const n = index + 1;

  return (
    <div className="rounded-xl border border-ink-200 bg-ink-50/40 p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="shrink-0 inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-ink-900 text-xs font-bold text-white">
          {n}
        </span>
        {fc && fc.verdict !== "pending" ? (
          <span className="rounded-md bg-white border border-ink-200 px-1.5 py-0.5 text-[11px] text-ink-600">
            {verdictLabel(fc.verdict)}
          </span>
        ) : (
          <span className="rounded-md bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[11px] text-amber-800">
            답변 대기
          </span>
        )}
        {done ? (
          <span className="text-[11px] text-emerald-700">완료</span>
        ) : null}
        {allowDelete && (
          <button
            type="button"
            disabled={busy || busyAll}
            onClick={onDelete}
            className="ml-auto inline-flex items-center gap-1 min-h-9 rounded-lg border border-verify-false/30 bg-white px-2.5 text-xs font-medium text-verify-false hover:bg-verify-false/10 disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
            삭제
          </button>
        )}
      </div>
      <p className="text-sm text-ink-800 leading-snug">{item.statement}</p>
      {fc?.explanation && !/^다음 주장을/.test(fc.explanation) ? (
        <p className="text-xs text-ink-500 line-clamp-2 whitespace-pre-wrap">
          {fc.explanation}
        </p>
      ) : null}
      <ImageAttachArea
        images={images}
        label={`${n}번 이미지 추가`}
        hint=""
        initialText={item.statement}
        maxImages={6}
        busy={busy || busyAll}
        onChange={(urls) => void persistImages(urls)}
      />
    </div>
  );
}
