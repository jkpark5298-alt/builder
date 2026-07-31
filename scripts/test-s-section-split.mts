import {
  extractNumberedClaimsFromPlain,
  inspectImportedReportText,
  normalizeAiReportPaste,
  splitNumberedClaimsInReport,
} from "../src/lib/report";
import type { TypedReport } from "../src/lib/types";

const sMarked = `S1. 시대에 따라 동이 의미는 변했다.
판정: 사실
근거(출처): 삼국지

S2. 산동 구동이가 한민족 조상이다.
판정: 거짓
근거(출처): 근거 부족

S3. 골각문이 갑골문으로 진화했다.
판정: 거짓
근거(출처): 미확인
`;

const lone = `주장 하나 긴 문장입니다 첫번째 블록입니다.

S

주장 둘 긴 문장입니다 두번째 블록입니다.

S

주장 셋 긴 문장입니다 세번째 블록입니다.
`;

const a = extractNumberedClaimsFromPlain(sMarked);
const b = extractNumberedClaimsFromPlain(lone);
console.log("S1 extract", a.length, a.map((x) => x.n));
console.log("lone S", b.length, b.map((x) => x.fromS));

const cleaned = normalizeAiReportPaste(sMarked);
const info = inspectImportedReportText(cleaned);
console.log("norm sections", info.count, info.headings);

const report: TypedReport = {
  meta: { title: "t", channel: "c", url: "", writtenAt: "" },
  reportType: "H",
  reportTypeLabel: "역사",
  sections: [
    {
      heading: "본문",
      body: `<p>${sMarked.replace(/\n/g, "<br>")}</p>`,
      rich: true,
    },
  ],
  summaryExcerpt: "",
  factChecks: [],
};
const split = splitNumberedClaimsInReport(report);
console.log(
  "split",
  split.sections.length,
  split.sections.map((s) => s.heading)
);

if (a.length < 3 || b.length < 3 || info.count < 3 || split.sections.length < 3) {
  process.exit(1);
}
console.log("OK");
