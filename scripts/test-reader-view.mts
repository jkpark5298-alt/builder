import assert from "node:assert/strict";
import {
  readerDocFromArticle,
  readerDocFromReport,
} from "../src/lib/reader-view.ts";
import type { TypedReport } from "../src/lib/types.ts";

const doc = readerDocFromArticle({
  title: "폴더블 아이폰",
  source: "뉴스",
  text: "앞 문단입니다.\n\n[이미지 1]\n\n뒷 문단입니다.\n\n[광고]\n쿠팡 파트너스",
  images: ["https://ex.test/a.jpg", "https://ex.test/b.jpg"],
});
assert.equal(doc.title, "폴더블 아이폰");
assert.ok(doc.blocks.some((b) => b.type === "p" && b.text.includes("앞 문단")));
assert.ok(doc.blocks.some((b) => b.type === "img" && b.src.endsWith("a.jpg")));
assert.ok(doc.blocks.some((b) => b.type === "img" && b.src.endsWith("b.jpg")));
assert.equal(
  doc.blocks.some((b) => b.type === "p" && b.text.includes("쿠팡")),
  false
);

const report: TypedReport = {
  meta: { title: "보고서", channel: "채널", url: "https://ex.test", writtenAt: "now" },
  reportType: "C",
  reportTypeLabel: "일반",
  format: "general_v5",
  summaryExcerpt: "",
  sections: [
    {
      sectionId: "s",
      heading: "본문",
      body: "<p>핵심입니다.</p><p>S</p>",
      rich: true,
      imageRefs: ["img_1"],
    },
  ],
  imageRoom: [{ id: "img_1", url: "https://ex.test/p.jpg" }],
  factChecks: [],
};
const fromReport = readerDocFromReport(report);
assert.ok(fromReport.blocks.some((b) => b.type === "p" && b.text.includes("핵심")));
assert.ok(fromReport.blocks.some((b) => b.type === "img" && b.src.includes("p.jpg")));

console.log("reader view ok");
