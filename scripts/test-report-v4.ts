/**
 * 규칙 기반 보고서(v4) 스모크 테스트 — 요약 논리 + 이미지/FC 매칭
 * 실행: npx tsx scripts/test-report-v4.ts
 */
import {
  buildTypedReport,
  parseOverviewNarrative,
} from "../src/lib/report";
import type { FactCheckResult, SummaryItem, VideoRecord } from "../src/lib/types";

const overview = `강연 녹취록의 논리와 근거를 살린 상세 요약입니다.

1. 영장류 계통수와 공통 조상
• 오랑우탄·고릴라·침팬지·보노보·사람은 공통 조상에서 갈라진다.
• 다윈의 노트 스케치는 생명의 나무를 처음 구상한 기록이다.

2. 골격 비교와 직립보행
• A~D 골격은 네발걷기에서 직립보행으로의 해부학적 변화를 보여준다.
• 골반·다리 형태가 이족보행의 핵심 증거다.

3. 석기 도구의 출현
• 핸드액스·스크래퍼 등 석기 유형이 기술 진화를 나타낸다.
• 실제 석기 사진과 도면은 제작 기법을 교차 확인하는 자료다.

4. 사피엔스만 살아남은 세 가지 비밀
• 인지혁명과 새로운 언어 습득으로 정보 공유·집단 협력이 가능해졌다.
• 눈 뚫린 바늘로 가죽옷을 지어 한랭 환경에 적응했다.
• 긴 유아기는 학습과 양육 투자를 늘려 생존에 기여했다.

최종 결론
사피엔스의 생존은 생물학적 변화와 문화·기술 혁신이 함께 작용한 결과다.`;

function item(
  id: string,
  statement: string,
  detail: string,
  imageUrls: string[]
): SummaryItem {
  return {
    id,
    type: "claim",
    statement,
    detail,
    imageUrl: imageUrls[0],
    imageUrls,
    evidence: [],
    needsFactCheck: true,
  };
}

function fc(
  itemId: string,
  verdict: FactCheckResult["verdict"],
  explanation: string,
  answerImageUrls: string[]
): FactCheckResult {
  return {
    itemId,
    mode: "manual",
    verdict,
    explanation,
    sources: [],
    checkedAt: new Date().toISOString(),
    answerImageUrl: answerImageUrls[0],
    answerImageUrls,
  };
}

const items: SummaryItem[] = [
  item("i1", "사람과 침팬지는 공통 조상에서 갈라졌다", "영장류 계통수", [
    "data:image/png;base64,AAA_TREE",
  ]),
  item("i2", "직립보행은 골격 비교로 확인할 수 있다", "골격 A~D", [
    "data:image/png;base64,AAA_SKELETON",
  ]),
  item("i3", "석기 핸드액스는 초기 인류의 기술이다", "석기 도구", [
    "data:image/png;base64,AAA_TOOL_DRAW",
    "data:image/png;base64,AAA_TOOL_PHOTO",
  ]),
  item(
    "i4",
    "인지혁명과 언어가 사피엔스 정보 공유의 핵심이다",
    "문화 진화·언어",
    ["data:image/png;base64,AAA_COGNITIVE"]
  ),
  item("i5", "눈 뚫린 바늘로 가죽옷을 지어 한랭 적응했다", "기술 적응", [
    "data:image/png;base64,AAA_NEEDLE",
  ]),
];

const factChecks: FactCheckResult[] = [
  fc("i1", "true", "1. 계통학적으로 사람과 침팬지는 공통 조상을 공유한다.", [
    "data:image/png;base64,AAA_DARWIN",
  ]),
  fc("i2", "mostly_true", "1. 골격 비교는 직립보행 가설을 지지한다.", []),
  fc("i3", "true", "1. 올도완·아슐리안 석기 전통이 문서화되어 있다.", []),
  fc(
    "i4",
    "mostly_true",
    "1. 언어·정보 공유는 문화 진화 논의의 중심이다.",
    []
  ),
  fc("i5", "true", "1. 세안 바늘 유물이 한랭 적응과 연결된다.", []),
];

const video = {
  title: "사피엔스 생존의 비밀",
  channel: "테스트채널",
  youtubeUrl: "https://youtube.com/watch?v=test",
  overview,
  summaryBullets: items.map((it, i) => `${i + 1}. ${it.statement}`),
  items,
  factChecks,
  reportType: "C" as const,
  updatedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  thumbnailUrl: "https://i.ytimg.com/vi/test/hqdefault.jpg",
  videoId: "test",
};

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`OK  ${msg}`);
}

const parsed = parseOverviewNarrative(overview);
assert(parsed.sections.length >= 4, `소주제 ${parsed.sections.length}개 (기대 ≥4)`);
assert(!!parsed.conclusion, "최종 결론 파싱");
console.log(
  "  sections:",
  parsed.sections.map((s) => s.title).join(" | ")
);

const report = buildTypedReport(video);
assert(report.format === "general_v4", "format=general_v4");
assert(report.sections[0]?.heading === "결론", "첫 섹션=결론");
assert(
  !report.sections[0]?.images?.length,
  "결론에 이미지 몰아넣기 없음"
);

const narrative = report.sections.filter(
  (s) => !["결론", "도입", "추가 검증"].includes(s.heading)
);
assert(narrative.length >= 4, `논리 소주제 ${narrative.length}개`);

let withImages = 0;
for (const sec of narrative) {
  const imgs = sec.images?.length ?? 0;
  if (imgs > 0) withImages += 1;
  console.log(
    `  · ${sec.heading.slice(0, 28)} | imgs=${imgs} | fc=${sec.entries?.length ?? 0}`
  );
}
assert(withImages >= 3, `이미지 매칭 섹션 ${withImages}개 (기대 ≥3)`);

// 석기 섹션에 도구 이미지가 가는지
const toolSec = narrative.find((s) => /석기/.test(s.heading));
assert(!!toolSec, "석기 소주제 존재");
assert(
  !!toolSec!.images?.some((u) => /TOOL/.test(u)),
  "석기 섹션 ↔ 석기 이미지 매칭"
);

const langSec = narrative.find((s) => /사피엔스|비밀/.test(s.heading));
assert(!!langSec, "사피엔스 비밀 소주제 존재");
assert(
  !!langSec!.images?.some((u) => /COGNITIVE|NEEDLE/.test(u)),
  "사피엔스 섹션 ↔ 인지/바늘 이미지"
);

// youtube thumb이 섹션 이미지에 안 들어갔는지
const allImgs = report.sections.flatMap((s) => s.images ?? []);
assert(
  allImgs.every((u) => !/ytimg/.test(u)),
  "유튜브 썸네일 제외"
);

console.log("\n=== ALL PASSED ===");
console.log(`sections total: ${report.sections.length}`);
console.log(report.sections.map((s) => s.heading).join(" → "));
