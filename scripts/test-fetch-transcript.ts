import { fetchTranscript } from "../src/lib/transcript";

async function main() {
  const id = "l7N6O8M6ehs";

  const local = await fetchTranscript(id);
  console.log("LOCAL:", local.source, local.text.length);

  process.env.VERCEL = "1";
  const vercel = await fetchTranscript(id);
  console.log(
    "VERCEL:",
    vercel.source,
    vercel.text.length,
    vercel.notice?.slice(0, 70)
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
