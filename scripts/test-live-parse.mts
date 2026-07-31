import { parseBulkFactCheckPasteRobust } from "../src/lib/bulk-factcheck-paste.ts";

const sample = `1.시대에 따라 '동이'의 의미는 변했으며 신동이가 기원이다.(판정: 사실(100%)
-근거(출처):《삼국지》 위서 동이전 등 고문헌

2.산동 지역의 동이족이 한민족의 직접 조상이다.판정:거짓(69%)
-근거(출처): 한·중 고고학 및 분자인류학계

3. 산동의 골각문이 갑골문으로 진화했다.거짓(69%)
-근거(출처):주류 문자학계 및 고고학계`;

const r = parseBulkFactCheckPasteRobust(sample, [
  {
    id: "a",
    type: "claim",
    statement: "x",
    evidence: [],
    needsFactCheck: true,
  },
]);

console.log(
  JSON.stringify(
    {
      notice: r.notice,
      n: r.entries.length,
      entries: r.entries.map((e) => ({
        i: e.index,
        v: e.verdict,
        isNew: e.isNew,
      })),
    },
    null,
    2
  )
);
