import assert from "node:assert/strict";
import {
  countTrailingSMarkers,
  ensureTrailingSMarkers,
  htmlWithSImages,
} from "../src/lib/report-body-s-slots.ts";

const base = "<p>혈관 건강이 중요합니다.</p>";
const one = ensureTrailingSMarkers(base, 1);
assert.equal(countTrailingSMarkers(one), 1, one);

const two = ensureTrailingSMarkers(one, 2);
assert.equal(countTrailingSMarkers(two), 2, two);

const three = ensureTrailingSMarkers(base, 3);
assert.equal(countTrailingSMarkers(three), 3, three);

const view = htmlWithSImages(two, [
  "https://example.com/a.jpg",
  "https://example.com/b.jpg",
]);
assert.ok(view.includes("a.jpg"), view);
assert.ok(view.includes("b.jpg"), view);
assert.ok(view.includes('s-slot-badge">S1'), view);
assert.ok(view.includes('s-slot-badge">S2'), view);

// S 없이 images만 있어도 보기에서 표시
const orphan = htmlWithSImages("<p>본문만</p>", ["https://example.com/c.jpg"]);
assert.ok(orphan.includes("c.jpg"), orphan);

console.log("ensureTrailingSMarkers + view images OK");
console.log("1 slot:", one);
console.log("2 slots:", two);
