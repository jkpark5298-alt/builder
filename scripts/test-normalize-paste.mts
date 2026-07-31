import assert from "node:assert/strict";
import {
  normalizeAiFactCheckPaste,
  parseBulkFactCheckPaste,
  parseClaimBlocks,
} from "../src/lib/bulk-factcheck-paste.ts";
import type { SummaryItem } from "../src/lib/types.ts";

const messy = `
**1.**

* **A -> Fact check 대상 구분(내용):** 시대에 따라 '동이'의 의미는 변했으며, 산동 지역 '구동이'는 중국에 흡수되고 만주·한반도의 '신동이'가 한민족의 실제 기원이다.
* **2. 판정:** 사실(100%)
* **3. 근거(출처):** 《삼국지》 위서 동이전 등 고문헌 및 한·중 주류 역사학·고고학계 정설

**2.**

* **A -> Fact check 대상 구분(내용):** 산동 지역의 동이족(구동이)이 한민족의 직접적인 조상이다.
* **2. 판정:** 거짓(69%)
* **3. 근거(출처):** 한·중 고고학 및 분자인류학계
`;

const cleaned = normalizeAiFactCheckPaste(messy);
console.log("--- cleaned ---\n" + cleaned + "\n---");
assert.ok(cleaned.includes("신동이"), cleaned);
assert.ok(/판정:\s*사실/.test(cleaned), cleaned);
assert.ok(cleaned.includes("근거(출처)"), cleaned);
assert.ok(/^1\./m.test(cleaned), cleaned);
assert.ok(/^2\./m.test(cleaned), cleaned);

const claims = parseClaimBlocks(cleaned);
assert.ok(claims.length >= 2, `claims=${claims.length}`);

const items: SummaryItem[] = [
  {
    id: "a",
    type: "claim",
    statement: "placeholder",
    evidence: [],
    needsFactCheck: true,
  },
];
const parsed = parseBulkFactCheckPaste(cleaned, items);
assert.ok(parsed.entries.length >= 2, parsed.notice);

console.log("normalize + parse ok", parsed.notice);
