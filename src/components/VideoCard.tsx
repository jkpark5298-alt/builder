import type { VideoRecord } from "@/lib/types";
import { libraryCardLabel, libraryStage } from "@/lib/library";
import { formatDistanceToNow } from "date-fns";
import { ko } from "date-fns/locale";

export function VideoCard({ video }: { video: VideoRecord }) {
  const stage = libraryStage(video);

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
              stage === "complete"
                ? "bg-verify-true/10 text-verify-true"
                : stage === "report_pending"
                  ? "bg-ink-900 text-white"
                  : stage === "factcheck_draft"
                    ? "bg-accent-muted text-accent"
                    : stage === "error"
                      ? "bg-verify-false/10 text-verify-false"
                      : "bg-ink-100 text-ink-600"
            }`}
          >
            {libraryCardLabel(video)}
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
