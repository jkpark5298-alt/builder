/** 앱 파일 아이콘 — 파일 위에 별표. 잘리지 않게 박스 안에 둡니다. */
export function AppFileMark({
  size = "md",
}: {
  size?: "sm" | "md";
}) {
  const box = size === "sm" ? "h-6 w-6" : "h-7 w-7";
  const file = size === "sm" ? "h-5 w-5" : "h-6 w-6";
  const star = size === "sm" ? "text-[11px]" : "text-sm";
  return (
    <span
      className={`relative inline-flex ${box} shrink-0 items-center justify-center overflow-visible`}
      aria-hidden
    >
      <svg
        viewBox="0 0 24 24"
        className={`${file} text-current`}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
      </svg>
      <span
        className={`pointer-events-none absolute top-0 right-0 ${star} leading-none text-amber-500`}
      >
        ★
      </span>
    </span>
  );
}
