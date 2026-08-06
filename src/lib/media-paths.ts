/** 리포트 본문·룸·S칸 공통 저장 prefix — 동일 바이트는 해시로 1회만 저장 */
export function reportImagePrefix(videoId: string): string {
  return `videos/${videoId}/img`;
}
