import assert from "node:assert/strict";
import { unwrapSoftLineBreaks } from "../src/lib/paste.ts";
import { wrapPlainPasteText } from "../src/lib/report-editor-format.ts";
import { sanitizeAiPasteText } from "../src/lib/report.ts";

const softWrapped = `이것은 긴 한글 문장이 중간에
줄바꿈되어 있던 내용입니다.
다음 문장도 이어집니다.`;

const joined = unwrapSoftLineBreaks(softWrapped);
assert.equal(
  joined,
  "이것은 긴 한글 문장이 중간에줄바꿈되어 있던 내용입니다. 다음 문장도 이어집니다."
);

const withBlank = `첫 문단입니다.
이어서 같은 문단.

둘째 문단입니다.`;
assert.equal(
  unwrapSoftLineBreaks(withBlank),
  "첫 문단입니다. 이어서 같은 문단.\n\n둘째 문단입니다."
);

const withList = `서론 문장입니다.

- 첫 항목이
길어서 잘림
- 둘째 항목`;
const listOut = unwrapSoftLineBreaks(withList);
assert.ok(listOut.includes("- 첫 항목이길어서 잘림"), listOut);
assert.ok(listOut.includes("- 둘째 항목"), listOut);

const html = wrapPlainPasteText(softWrapped);
assert.ok(!html.includes("</p><p><span"), `should be one paragraph-ish: ${html}`);
assert.ok(html.includes("중간에줄바꿈되어"), html);

const sanitized = sanitizeAiPasteText(softWrapped);
assert.equal(
  sanitized,
  "이것은 긴 한글 문장이 중간에줄바꿈되어 있던 내용입니다. 다음 문장도 이어집니다."
);

console.log("unwrap soft breaks OK");
