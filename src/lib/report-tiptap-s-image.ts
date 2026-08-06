import { Node, mergeAttributes } from "@tiptap/core";

/**
 * 본문 S 자리 이미지 (figure.report-s-image).
 * 저장 HTML 에서는 S1·S2… 표시로 되돌리고, 편집기에서는 문장 바로 아래 그림으로 보여 줍니다.
 * 아이폰: atom 블록이 커서·선택과 덜 충돌하도록 selectable은 유지하되 CSS로 컴팩트 표시.
 */
export const ReportSImage = Node.create({
  name: "reportSImage",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,
  // 주변 텍스트 편집과 분리 — iOS에서 선택·스크롤 점프 완화
  isolating: true,
  defining: true,

  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: (element) => {
          if (!(element instanceof HTMLElement)) return null;
          return element.querySelector("img")?.getAttribute("src") || null;
        },
      },
      slotIndex: {
        default: 0,
        parseHTML: (element) => {
          if (!(element instanceof HTMLElement)) return 0;
          const raw = element.getAttribute("data-s-slot");
          const n = raw != null ? Number(raw) : 0;
          return Number.isFinite(n) ? n : 0;
        },
        renderHTML: (attributes) => ({
          "data-s-slot": String(attributes.slotIndex ?? 0),
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "figure.report-s-image" }, { tag: "figure[data-s-slot]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const src =
      typeof node.attrs.src === "string" && node.attrs.src.trim()
        ? node.attrs.src.trim()
        : "";
    const slotIndex = Number(node.attrs.slotIndex) || 0;
    const n = slotIndex + 1;
    const attrs = mergeAttributes(
      {
        class: src
          ? "report-s-image"
          : "report-s-image report-s-slot-empty",
        "data-s-slot": String(slotIndex),
      },
      HTMLAttributes
    );
    if (src) {
      return [
        "figure",
        attrs,
        ["span", { class: "s-slot-badge" }, `S${n}`],
        ["img", { src, alt: "" }],
      ];
    }
    return [
      "figure",
      attrs,
      [
        "p",
        { class: "s-slot-ph" },
        ["strong", {}, `S${n} 이미지 입력칸`],
        " · 클릭 후 Ctrl+V",
      ],
    ];
  },
});
