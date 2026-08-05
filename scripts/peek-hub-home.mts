const res = await fetch("http://localhost:3000/");
const html = await res.text();
const strip = (s: string) =>
  s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const m1 = html.match(/정보\/요약 입력[\s\S]{0,1500}/);
const m2 = html.match(/팩트체크 보고서 현황[\s\S]{0,1500}/);

console.log("--- 정보/요약 입력 카드 ---");
console.log(m1 ? strip(m1[0]).slice(0, 500) : "not found");
console.log("");
console.log("--- 팩트체크 보고서 현황 카드 ---");
console.log(m2 ? strip(m2[0]).slice(0, 500) : "not found");
console.log("");
console.log("has numbered list markup:", /<ol class="mt-3/.test(html));
console.log("has 작업 중 N건 old label:", /작업 중 \d+건/.test(html));
console.log("has 확정 N건 old label:", /확정 \d+건/.test(html));
