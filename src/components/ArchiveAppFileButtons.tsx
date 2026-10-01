"use client";

import { Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { VideoRecord } from "@/lib/types";
import { downloadArchiveAppFile } from "@/lib/archive-app-file";
import { AppFileMark } from "@/components/AppFileMark";
import { cacheVideoSnapshot } from "@/components/VideoNotFoundRecovery";

export function ArchiveAppFileSaveButton({
  video,
  className = "",
}: {
  video: VideoRecord;
  className?: string;
}) {
  async function save() {
    if (!video.report) {
      alert("저장할 보고서가 없습니다.");
      return;
    }
    try {
      await downloadArchiveAppFile(video);
    } catch (e) {
      alert(e instanceof Error ? e.message : "앱 파일을 저장하지 못했습니다.");
    }
  }

  return (
    <button
      type="button"
      onClick={() => void save()}
      title="별표(★)가 붙은 앱 파일로 저장합니다"
      className={
        className ||
        "inline-flex items-center gap-1.5 min-h-10 rounded-lg border border-accent/40 bg-accent-muted/50 px-3 text-sm font-medium text-ink-900 hover:border-accent"
      }
    >
      <AppFileMark size="sm" />
      앱 파일 저장
    </button>
  );
}

export function ArchiveAppFileLoadButton({
  className = "",
  variant = "card",
}: {
  className?: string;
  variant?: "card" | "button";
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onPick(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error("앱 파일을 읽지 못했습니다. ★ .yfc 파일을 선택하세요.");
      }
      const res = await fetch("/api/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "archive_file", archiveFile: parsed }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        video?: VideoRecord;
      };
      if (!res.ok || !data.video?.id) {
        throw new Error(data.error || "앱 파일을 불러오지 못했습니다.");
      }
      cacheVideoSnapshot(data.video);
      window.dispatchEvent(
        new CustomEvent("yfc-archive-saved", { detail: data.video })
      );
      router.refresh();
      window.location.assign(`/videos/${data.video.id}`);
    } catch (e) {
      alert(e instanceof Error ? e.message : "앱 파일을 불러오지 못했습니다.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const trigger = (
    <button
      type="button"
      disabled={busy}
      onClick={() => inputRef.current?.click()}
      className={
        className ||
        (variant === "card"
          ? "w-full text-left"
          : "inline-flex items-center gap-1.5 min-h-10 rounded-lg border border-ink-200 bg-white px-3 text-sm font-medium hover:border-accent disabled:opacity-50")
      }
    >
      {variant === "card" ? (
        <>
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 text-ink-900">
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <AppFileMark />}
          </span>
          <span className="mt-4 block font-display text-xl text-ink-900 group-hover:text-accent">
            앱 파일 불러오기
          </span>
          <span className="mt-1.5 block text-sm text-ink-500 leading-relaxed">
            별표(★)가 있는 .yfc 파일을 열어 유튜브·정보 보관소 보고서에 반영합니다.
          </span>
        </>
      ) : (
        <>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <AppFileMark size="sm" />}
          {busy ? (
            "불러오는 중…"
          ) : (
            <>
              <span className="sm:hidden">불러오기</span>
              <span className="hidden sm:inline">앱 파일 불러오기</span>
            </>
          )}
        </>
      )}
    </button>
  );

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".yfc,application/json,.json"
        className="sr-only"
        onChange={(e) => void onPick(e.target.files)}
      />
      {trigger}
    </>
  );
}
