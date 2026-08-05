/**
 * 홈 카드: 작업중/확정 제목 목록 (최신 5개) 로직 검증
 */
import assert from "node:assert/strict";

type Item = { id: string; title: string; updatedAt: string };

function latestTitles(items: Item[], limit = 5): string[] {
  return [...items]
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )
    .slice(0, limit)
    .map((v, i) => `${i + 1}. ${v.title || "제목 없음"}`);
}

const workItems: Item[] = [
  { id: "1", title: "치매", updatedAt: "2026-08-01T10:00:00Z" },
  { id: "2", title: "백세건강", updatedAt: "2026-08-05T12:00:00Z" },
  { id: "3", title: "오딧세이", updatedAt: "2026-08-04T09:00:00Z" },
  { id: "4", title: "오래된작업", updatedAt: "2026-07-01T00:00:00Z" },
  { id: "5", title: "다섯번째", updatedAt: "2026-06-01T00:00:00Z" },
  { id: "6", title: "여섯번째제외", updatedAt: "2026-05-01T00:00:00Z" },
];

const completed: Item[] = [
  {
    id: "a",
    title: "크레타<크노소스>, 궁전아니다",
    updatedAt: "2026-08-03T08:00:00Z",
  },
  { id: "b", title: "역사 체크", updatedAt: "2026-08-05T11:00:00Z" },
  { id: "c", title: "예비6번", updatedAt: "2026-07-20T00:00:00Z" },
  { id: "d", title: "예비7번", updatedAt: "2026-07-19T00:00:00Z" },
  { id: "e", title: "예비8번", updatedAt: "2026-07-18T00:00:00Z" },
  { id: "f", title: "예비9번", updatedAt: "2026-07-17T00:00:00Z" },
];

const workList = latestTitles(workItems);
const doneList = latestTitles(completed);

assert.deepEqual(workList, [
  "1. 백세건강",
  "2. 오딧세이",
  "3. 치매",
  "4. 오래된작업",
  "5. 다섯번째",
]);
assert.equal(workList.length, 5);
assert.ok(!workList.some((t) => t.includes("여섯번째제외")));
assert.equal(doneList[0], "1. 역사 체크");
assert.equal(doneList[1], "2. 크레타<크노소스>, 궁전아니다");
assert.equal(doneList.length, 5); // 최신 5개만
assert.ok(!doneList.some((t) => t.includes("예비9번"))); // 6번째 제외

console.log("=== 정보/요약 입력 (작업 중) ===");
for (const line of workList) console.log(line);
console.log("");
console.log("=== 팩트체크 보고서 현황 (확정) ===");
for (const line of doneList) console.log(line);
console.log("");
console.log("OK — 최신순 번호 제목, 최대 5개");
