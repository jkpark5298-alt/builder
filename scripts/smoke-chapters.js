const description = `오늘은 허준님과 중동학자 박현도 교수님, 유라시아 고고학자 강인욱 교수님, 몽골사학자 김장구 교수님과 함께 유럽이 기록한 몽골부대에 대해 알아보았습니다!

00:00 인트로
03:47 몽골의 정체성은 어디까지일까?
06:47 유럽 한복판에 뜬금없이 등장한 동양인 국가의 비밀
19:06 유럽 인구 절반을 몰살 시킨 흑사병을 정말 몽골이 퍼트렸을까?
21:36 유럽인들이 몽골인을 악마라고 생각한 이유
25:38 칭기즈칸이 유럽까지 서진한 진짜 이유
34:39 역사 속에 악마로 기록된 또 다른 군대들`;

const re = /^\s*((?:\d{1,2}:)?\d{1,2}:\d{2})\s*[-–—.]?\s*(.+?)\s*$/;
const chapters = [];
for (const line of description.split(/\n/)) {
  const m = line.match(re);
  if (m) chapters.push({ timestamp: m[1], title: m[2] });
}
console.log("chapters", chapters.length, chapters.map((c) => c.title));
const claims = chapters.filter((c) => !/인트로/i.test(c.title));
console.log("claim chapters", claims.length);
