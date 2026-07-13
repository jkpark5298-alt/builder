import type { VideoRecord } from "@/lib/types";
import { formatDistanceToNow } from "date-fns";
import { ko } from "date-fns/locale";

const statusLabel: Record<VideoRecord["status"], string> = {
  queued: "대기",
  fetching: "수집 중",
  summarizing: "요약 중",
  fact_checking: "자동 검증",
  awaiting_factcheck: "수동 검증",
  ready: "완료",
  error: "오류",
};

export function VideoCard({ video }: { video: VideoRecord }) {
  return (
    <a
      href={`/videos/${video.id}`}
      className="group block overflow-hidden rounded-2xl border border-ink-200 bg-white/90 hover:border-accent/50 hover:shadow-md transition-all"
    >
      <div className="aspect-video overflow-hidden bg-ink-900">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={video.thumbnailUrl}
          alt=""
          className="h-full w-full object-cover opacity-95 group-hover:scale-[1.03] transition-transform duration-500"
        />
      </div>
      <div className="p-4">
        <div className="flex items-center justify-between gap-2 mb-2">
          <span
            className={`text-xs px-2 py-0.5 rounded-md ${
              video.status === "ready"
                ? "bg-verify-true/10 text-verify-true"
                : video.status === "awaiting_factcheck"
                  ? "bg-accent-muted text-accent"
                  : video.status === "error"
                    ? "bg-verify-false/10 text-verify-false"
                    : "bg-ink-100 text-ink-600"
            }`}
          >
            {statusLabel[video.status]}
          </span>
          <span className="text-xs text-ink-400">
            {formatDistanceToNow(new Date(video.updatedAt), {
              addSuffix: true,
              locale: ko,
            })}
          </span>
        </div>
        <h3 className="font-medium text-ink-900 line-clamp-2 group-hover:text-accent transition-colors">
          {video.title}
        </h3>
        <p className="text-sm text-ink-500 mt-1">{video.channel}</p>
        <p className="text-xs text-ink-400 mt-3">
          항목 {video.items.length} · 검증 {video.factChecks.length}
        </p>
      </div>
    </a>
  );
}
