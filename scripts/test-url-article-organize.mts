import assert from "node:assert/strict";
import {
  dropArticleImages,
  organizeUrlArticleReport,
  organizeUrlArticleText,
  stripArticleImageMarkers,
} from "../src/lib/url-article-report.ts";
import type { TypedReport } from "../src/lib/types.ts";

const messy = `
정부는 오늘 대책을 발표했다.

[이미지 1]

현장에서는 주민 반응이 엇갈렸다.

[이미지 2]

좋아요
공유하기
관련기사
이웃집 화재 소식
다른 지역 점검 결과
무단전재 및 재배포 금지
reporter@news.co.kr
`;

const cleanedKeep = organizeUrlArticleText(messy, { keepImageMarkers: true });
assert.ok(cleanedKeep.includes("대책을 발표했다"), cleanedKeep);
assert.ok(cleanedKeep.includes("[이미지 1]"), cleanedKeep);
assert.ok(cleanedKeep.includes("[이미지 2]"), cleanedKeep);
assert.equal(cleanedKeep.includes("좋아요"), false, cleanedKeep);
assert.equal(cleanedKeep.includes("관련기사"), false, cleanedKeep);
assert.equal(cleanedKeep.includes("무단전재"), false, cleanedKeep);

const cleanedDrop = stripArticleImageMarkers(messy);
assert.ok(cleanedDrop.includes("주민 반응이 엇갈렸다"), cleanedDrop);
assert.equal(/\[이미지/.test(cleanedDrop), false, cleanedDrop);
assert.equal(cleanedDrop.includes("공유하기"), false, cleanedDrop);

const again = organizeUrlArticleText(cleanedKeep, { keepImageMarkers: true });
assert.equal(again, cleanedKeep, "정리 결과는 한 번 더 돌려도 같아야 한다");

const dropped = dropArticleImages(
  "앞\n\n[이미지 1]\n\n가운데\n\n[이미지 2]\n\n뒤\n\n[이미지 3]",
  ["a.jpg", "b.jpg", "c.jpg"],
  ["b.jpg"]
);
assert.deepEqual(dropped.images, ["a.jpg", "c.jpg"]);
assert.match(dropped.text, /\[이미지 1\]/);
assert.match(dropped.text, /\[이미지 2\]/);
assert.equal((dropped.text.match(/\[이미지/g) || []).length, 2, dropped.text);
assert.equal(dropped.text.includes("[이미지 3]"), false, dropped.text);

const report: TypedReport = {
  meta: { title: "t", channel: "c", url: "https://ex.test", writtenAt: "now" },
  reportType: "C",
  reportTypeLabel: "일반 보고서",
  format: "general_v5",
  summaryExcerpt: "핵심 내용입니다.",
  sections: [
    {
      sectionId: "sec-url-body",
      heading: "본문",
      body: "<p>핵심 내용입니다.</p><p>좋아요</p><p>S</p>",
      rich: true,
      imageRefs: ["img_1"],
    },
  ],
  imageRoom: [{ id: "img_1", url: "https://ex.test/p.jpg" }],
  factChecks: [],
};
const organized = organizeUrlArticleReport(report);
assert.equal(organized.sections[0]?.body?.includes("좋아요"), false);
assert.ok(organized.sections[0]?.body?.includes("핵심 내용"), organized.sections[0]?.body);
assert.ok(/[Ss]/.test(organized.sections[0]?.body || ""), organized.sections[0]?.body);
assert.equal(organized.imageRoom?.[0]?.url, "https://ex.test/p.jpg");

const news = `
아이폰 폴더블 예상 디자인 (사진=기사 이해를 돕기 위해 AI로 제작된 이미지) 애플이 다음 주 첫 폴더블 아이폰을 공개할 것으로 예상되는 가운데 유저들의 기대감이 높아지고 있다.

블룸버그 통신의 마크 거먼은 1일(현지시간) IT매체 톰스가이드와의 인터뷰에서 &ldquo;제가 들은 바로는 맥세이프가 폴더블폰에 탑재될 것 같다&rdquo;며 &ldquo;아이폰 에어에도 적용됐는데 폴더블폰에 적용하지 못할 이유가 없다고 생각한다&rdquo;고 밝혔다.

애플은 오는 9일(현지시간) &lsquo;깜짝 빛날 시간(Surprise and shine)&rsquo; 행사를 개최한다.
`;
const newsClean = organizeUrlArticleText(news);
assert.equal(/&l[ds]quo|&r[ds]quo/i.test(newsClean), false, newsClean);
assert.ok(newsClean.includes("맥세이프가 폴더블폰에 탑재될 것 같다"), newsClean);
assert.ok(newsClean.includes("깜짝 빛날 시간"), newsClean);
assert.ok(newsClean.includes('"'), newsClean);
assert.equal(newsClean.includes("사진="), false, newsClean);
assert.equal(newsClean.includes("AI로 제작된 이미지"), false, newsClean);

const doubleEncoded = organizeUrlArticleText(
  "인터뷰에서 &amp;ldquo;적용하지 못할 이유가 없다&amp;rdquo;고 밝혔다."
);
assert.equal(/&/.test(doubleEncoded), false, doubleEncoded);
assert.ok(doubleEncoded.includes("적용하지 못할 이유가 없다"), doubleEncoded);

const withAds = `
정부는 오늘 대책을 발표했다. 관계 부처는 세부 기준을 다음 주 공개하겠다고 밝혔다.

[광고]
쿠팡 파트너스 활동의 일환으로 수수료를 받을 수 있습니다.

AD
지금 가입하면 할인

본문은 이어서 규제 내용을 다룬다. 현장에서는 혼란이 이어지고 있다는 지적도 나온다.

관련기사
다른 뉴스
`;
const noAds = organizeUrlArticleText(withAds);
assert.ok(noAds.includes("대책을 발표했다"), noAds);
assert.ok(noAds.includes("규제 내용을 다룬다"), noAds);
assert.equal(noAds.includes("쿠팡"), false, noAds);
assert.equal(noAds.includes("지금 가입하면"), false, noAds);
assert.equal(/^AD$/m.test(noAds), false, noAds);
assert.equal(noAds.includes("관련기사"), false, noAds);

console.log("url article organize ok");
