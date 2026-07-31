import assert from "node:assert/strict";
import {
  buildBulkFactCheckPrompt,
  parseBulkFactCheckPaste,
  parseClaimBlocks,
  parseVerdictToken,
} from "../src/lib/bulk-factcheck-paste.ts";
import type { SummaryItem } from "../src/lib/types.ts";

function item(id: string, statement: string): SummaryItem {
  return {
    id,
    type: "claim",
    statement,
    evidence: [],
    needsFactCheck: true,
  };
}

const sample = `
1.시대에 따라 '동이'의 의미는 변했으며, 산동 지역 '구동이'는 중국에 흡수되고 만주·한반도의 '신동이'가 한민족의 실제 기원이다.(판정: 사실(100%)
-근거(출처):《삼국지》 위서 동이전 등 고문헌 및 한·중 주류 역사학·고고학계 정설

2.산동 지역의 동이족(구동이)이 한민족의 직접적인 조상이다.0판정:거짓(69-0%)
-근거(출처):** 한·중 고고학 및 분자인류학계 (직접적 연결을 증명할 유전학적, 고고학적 근거 부족)

 3. 산동의 골각문이 한자인 갑골문으로 진화했다.거짓(69-0%)
 -근거(출처):주류 문자학계 및 고고학계 (일부 학자의 가설일 뿐, 학술적으로 공인되지 않은 미확인 주장)
`;

assert.equal(parseVerdictToken("사실(100%)"), "true");
assert.equal(parseVerdictToken("거짓(69-0%)"), "false");

const claims = parseClaimBlocks(sample);
assert.equal(claims.length, 3, `expected 3 claims got ${claims.length}`);
assert.equal(claims[0].verdict, "true");
assert.equal(claims[1].verdict, "false");
assert.equal(claims[2].verdict, "false");
assert.ok(claims[0].evidence.includes("삼국지"));
assert.ok(claims[1].statement.includes("구동이"));

const oneItem = [item("a", "기존 요약에서 뽑은 한 줄")];
const parsed = parseBulkFactCheckPaste(sample, oneItem);
assert.equal(parsed.claimCount, 3);
assert.equal(parsed.entries.length, 3);
assert.equal(parsed.entries[0].isNew, false);
assert.equal(parsed.entries[1].isNew, true);
assert.equal(parsed.entries[2].isNew, true);
assert.equal(parsed.entries[0].verdict, "true");
assert.equal(parsed.entries[1].verdict, "false");

const prompt = buildBulkFactCheckPrompt(oneItem);
assert.ok(prompt.includes("판정: 사실|대체로 사실|거짓|검증 불가"));
assert.ok(prompt.includes("근거(출처)"));

console.log("claim-style paste ok", parsed.notice);
