"use client";

import { useEffect, useState } from "react";
import type { VideoRecord } from "@/lib/types";
import { NumberedFactCheckImages } from "@/components/NumberedFactCheckImages";

/** 확정(ready) 후 번호별 이미지 — 서버 페이지용 클라이언트 래퍼 */
export function HistoryPostConfirmImages({
  video: initial,
}: {
  video: VideoRecord;
}) {
  const [video, setVideo] = useState(initial);

  useEffect(() => {
    setVideo(initial);
  }, [initial.updatedAt, initial.id]);

  return (
    <section
      id="numbered-images"
      className="rounded-2xl border border-accent/30 bg-white shadow-sm overflow-hidden print:hidden scroll-mt-20"
    >
      <div className="bg-accent px-4 sm:px-5 py-3.5">
        <h2 className="font-display text-xl sm:text-2xl text-white text-center sm:text-left">
          5. 번호별 이미지
        </h2>
      </div>
      <div className="p-4 sm:p-5 space-y-3">
        <p className="text-sm text-ink-600">
          보고서가 확정된 뒤, 팩트체크 항목(1·2·3…)에 참고 이미지를 붙입니다.
          FC 단계에서는 이미지를 붙이지 않습니다. 본문 안 이미지는 위 보고서
          편집에서도 넣을 수 있습니다.
        </p>
        <NumberedFactCheckImages
          video={video}
          onVideoUpdate={setVideo}
          variant="after_confirm"
        />
      </div>
    </section>
  );
}
