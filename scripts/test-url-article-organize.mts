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

console.log("url article organize ok");
