/**
 * 역사 팩트체크 샘플로 B안(일괄 붙여넣기) E2E 스모크 테스트
 * 사용: npx tsx scripts/seed-history-bulk-test.mts
 */
const BASE = process.env.YFC_BASE_URL ?? "http://localhost:3000";

const OVERVIEW = `1.1. 고대 동이족과 한민족 기원 논란에 대한 핵심 요약입니다.

- 일부 연구에서는 '신동이'를 한민족의 실제 기원으로 보고, '구동이'는 중국에 흡수되었다고 주장한다.
- 골각문이 갑골문으로 발전했다는 가설이 제기된다.
- 선사·청동기와 중국 하·상·주·춘추전국, 고조선 시대를 교차해 논의한다.

* 시대: 선진 시대(신석기~청동기)
* 중국: 하·상·주 및 춘추전국
* 한국: 고조선 시대`;

async function main() {
  const createRes = await fetch(`${BASE}/api/videos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "report",
      title: "고대 동이족과 한민족 기원 논란 (역사 팩트체크 테스트)",
      channel: "역사 팩트체크",
      pastedScript: "",
    }),
  });
  const created = (await createRes.json()) as {
    error?: string;
    video?: { id: string; status: string };
  };
  if (!createRes.ok || !created.video) {
    throw new Error(created.error || "create failed");
  }
  const id = created.video.id;
  console.log("created", id, created.video.status);

  const ovRes = await fetch(`${BASE}/api/videos/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ updateOverview: { overview: OVERVIEW } }),
  });
  const ov = (await ovRes.json()) as {
    error?: string;
    video?: {
      id: string;
      items: Array<{ id: string; statement: string; needsFactCheck: boolean }>;
      factChecks: unknown[];
    };
  };
  if (!ovRes.ok || !ov.video) {
    throw new Error(ov.error || "overview failed");
  }

  const targets = ov.video.items.filter((i) => i.needsFactCheck);
  console.log(
    "fc items",
    targets.length,
    targets.map((t, i) => `${i + 1}. ${t.statement.slice(0, 40)}`)
  );

  if (targets.length === 0) {
    throw new Error("no fact-check items from overview");
  }

  const pasteBlocks = targets.map((t, i) => {
    const verdicts = ["일부 사실", "검증 불가", "대체로 사실", "사실", "대체로 거짓"];
    const v = verdicts[i % verdicts.length];
    return [
      `===항목${i + 1}===`,
      `판정: ${v}`,
      "내용:",
      `1. 「${t.statement.slice(0, 48)}」에 대한 교차 확인 결과입니다.`,
      "2. 1차 사료·학술 논의를 기준으로 사실과 가설을 구분했습니다.",
      "3. 추가 근거가 확보되면 판정을 재검토할 수 있습니다.",
    ].join("\n");
  });
  const paste = pasteBlocks.join("\n\n");

  // 파서는 서버에 없으므로 클라이언트와 동일 로직을 로컬 import
  const { parseBulkFactCheckPaste } = await import(
    "../src/lib/bulk-factcheck-paste.ts"
  );
  const parsed = parseBulkFactCheckPaste(paste, ov.video.items);
  console.log("parse", parsed.notice);

  const applyRes = await fetch(`${BASE}/api/videos/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      draft: true,
      bulkFactChecks: parsed.entries.map((e) => ({
        itemId: e.itemId,
        verdict: e.verdict,
        explanation: e.explanation,
        sources: [],
      })),
    }),
  });
  const applied = (await applyRes.json()) as {
    error?: string;
    applied?: number;
    video?: { factChecks: Array<{ verdict: string; explanation: string }> };
    progress?: { doneCount: number; total: number };
  };
  if (!applyRes.ok) {
    throw new Error(applied.error || "bulk apply failed");
  }

  console.log(
    "applied",
    applied.applied ?? applied.video?.factChecks.length,
    "progress",
    applied.progress
  );
  console.log(`OPEN ${BASE}/videos/${id}#manual-factcheck`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
