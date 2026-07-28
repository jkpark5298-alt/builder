import { writeFileSync } from "fs";
import { JSDOM } from "jsdom";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle, FontSize } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import { FcAnchor } from "../src/lib/report-tiptap-fc-anchor.ts";
import {
  wrapFcAnchorText,
  stabilizeSectionFcAnchors,
} from "../src/lib/fc-markers.ts";
import { sanitizePastedHtml } from "../src/lib/report-editor-format.ts";

const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "http://localhost/",
});
const { window } = dom;
Object.defineProperty(globalThis, "window", { value: window, configurable: true });
Object.defineProperty(globalThis, "document", {
  value: window.document,
  configurable: true,
});
Object.defineProperty(globalThis, "DOMParser", {
  value: window.DOMParser,
  configurable: true,
});
Object.defineProperty(globalThis, "Node", { value: window.Node, configurable: true });
Object.defineProperty(globalThis, "HTMLElement", {
  value: window.HTMLElement,
  configurable: true,
});
Object.defineProperty(globalThis, "DocumentFragment", {
  value: window.DocumentFragment,
  configurable: true,
});
Object.defineProperty(globalThis, "MutationObserver", {
  value: window.MutationObserver,
  configurable: true,
});
Object.defineProperty(globalThis, "getComputedStyle", {
  value: window.getComputedStyle.bind(window),
  configurable: true,
});
Object.defineProperty(globalThis, "requestAnimationFrame", {
  value: (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0),
  configurable: true,
});
Object.defineProperty(globalThis, "cancelAnimationFrame", {
  value: (id: number) => clearTimeout(id),
  configurable: true,
});

const mount = document.createElement("div");
document.body.appendChild(mount);

const editor = new Editor({
  element: mount,
  extensions: [
    StarterKit.configure({
      heading: false,
      codeBlock: false,
      code: false,
      blockquote: false,
      horizontalRule: false,
      undoRedo: false,
    }),
    TextStyle,
    Color,
    Highlight.configure({ multicolor: true }),
    FontSize,
    FcAnchor,
  ],
  content: "<p>hello world</p>",
});

const results: Record<string, unknown> = {};
const fails: string[] = [];

function assert(cond: unknown, msg: string) {
  if (!cond) fails.push(msg);
}

results.initial = editor.getHTML();

editor.commands.setTextSelection({ from: 1, to: 6 });
editor
  .chain()
  .focus()
  .toggleBold()
  .setFontSize("18px")
  .setColor("#b91c1c")
  .setHighlight({ color: "#fef08a" })
  .toggleUnderline()
  .run();
results.formatted = editor.getHTML();
assert(String(results.formatted).includes("<strong>"), "bold missing");
assert(String(results.formatted).includes("18px"), "font-size missing");
assert(
  String(results.formatted).includes("#b91c1c") ||
    String(results.formatted).includes("rgb(185, 28, 28)"),
  "color missing"
);
assert(
  String(results.formatted).includes("mark") ||
    String(results.formatted).includes("fef08a"),
  "highlight missing"
);
assert(String(results.formatted).includes("<u>"), "underline missing");

const anchored = `<p>${wrapFcAnchorText("item_1", "정부는 예산을 늘렸다")}</p>`;
editor.commands.setContent(anchored, { emitUpdate: false });
results.anchorIn = editor.getHTML();
assert(String(results.anchorIn).includes("data-fc-item"), "anchor parse failed");

const paste = sanitizePastedHtml(
  '<p><span data-fc-item="item_2" class="fc-anchor">붙여넣기 앵커</span> 그리고 <b>굵게</b></p>'
);
results.sanitized = paste;
assert(paste.includes("data-fc-item"), "sanitize dropped data-fc-item");
editor.commands.setContent("<p></p>");
editor.commands.insertContent(paste);
results.afterPaste = editor.getHTML();
assert(
  String(results.afterPaste).includes("data-fc-item"),
  "paste lost anchor"
);
assert(
  String(results.afterPaste).includes("<strong>") ||
    String(results.afterPaste).includes("<b>"),
  "paste lost bold"
);

const stab = stabilizeSectionFcAnchors("<p>정부는 예산을 늘렸다. 끝.</p>", [
  { itemId: "item_1", text: "정부는 예산을 늘렸다." },
]);
results.stab = stab;
editor.commands.setContent(stab, { emitUpdate: false });
let html = editor.getHTML();
html = html.replace("정부는 예산을 늘렸다.", "정부는 예산을 대폭 늘렸다.");
editor.commands.setContent(html, { emitUpdate: false });
results.editedHtml = editor.getHTML();
assert(
  editor.getHTML().includes('data-fc-item="item_1"'),
  "edited text lost itemId anchor"
);

const a = editor.getHTML();
editor.commands.setContent(a, { emitUpdate: false });
assert(editor.getHTML() === a, "roundtrip HTML mismatch");

editor.commands.setContent("<p><br></p>", { emitUpdate: false });
results.emptyBr = editor.getHTML();

editor.destroy();
results.ok = fails.length === 0;
results.fails = fails;

writeFileSync(
  new URL("./tiptap-smoke-out.json", import.meta.url),
  JSON.stringify(results, null, 2),
  "utf8"
);

if (fails.length) {
  console.error("FAIL", fails);
  process.exit(1);
}
console.log("PASS TipTap smoke");
