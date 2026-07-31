import {
  inspectImportedReportText,
  normalizeAiReportPaste,
  splitNumberedClaimsInReport,
  extractNumberedClaimsFromPlain,
} from "../src/lib/report";
import type { TypedReport } from "../src/lib/types";

const sample = `1. 시대에 따라 '동이'의 의미는 변했으며, 산동 지역 '구동이'는 중국에 흡수되고 만주·한반도의 '신동이'가 한민족의 실제 기원이다. (판정: 사실)
- 근거(출처): 《삼국지》 위서 동이전 등 고문헌 및 한·중 주류 역사학·고고학계 정설

2. 산동 지역의 동이족(구동이)이 한민족의 직접적인 조상이다. (판정: 거짓)
- 근거(출처): 한·중 고고학 및 분자인류학계 (직접적 연결을 증명할 유전학적, 고고학적 근거 부족)

3. 산동의 골각문이 한자인 갑골문으로 진화했다. (판정: 거짓)
- 근거(출처): 주류 문자학계 및 고고학계 (일부 학자의 가설일 뿐, 학술적으로 공인되지 않은 미확인 주장)
`;

const cleaned = normalizeAiReportPaste(sample);
console.log("--- cleaned ---\n" + cleaned + "\n");
const info = inspectImportedReportText(cleaned);
console.log("sections:", info.count, info.headings);
if (info.count < 3) {
  console.error("FAIL: expected >= 3 claim sections");
  process.exit(1);
}

const bundled: TypedReport = {
  meta: { title: "t", channel: "c", url: "", writtenAt: "" },
  reportType: "H",
  reportTypeLabel: "역사",
  sections: [
    {
      heading: "항목별 팩트체크",
      body: `<p>${sample.replace(/\n/g, "<br>")}</p>`,
      rich: true,
    },
  ],
  summaryExcerpt: "",
  factChecks: [],
};

const split = splitNumberedClaimsInReport(bundled);
console.log(
  "split sections:",
  split.sections.length,
  split.sections.map((s) => s.heading)
);
if (split.sections.length < 3) {
  console.error("FAIL: split expected >= 3");
  process.exit(1);
}

const extracted = extractNumberedClaimsFromPlain(sample);
console.log("extracted:", extracted.length);
if (extracted.length < 3) {
  console.error("FAIL: extract");
  process.exit(1);
}

console.log("OK");
