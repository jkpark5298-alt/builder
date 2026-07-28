import { Mark, mergeAttributes } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fcAnchor: {
      setFcAnchor: (itemId: string) => ReturnType;
      unsetFcAnchor: () => ReturnType;
    };
  }
}

/**
 * 보고서 본문의 팩트체크 앵커 (data-fc-item).
 * 문장 매칭 대신 itemId로 F마커를 고정한다.
 */
export const FcAnchor = Mark.create({
  name: "fcAnchor",
  inclusive: false,
  excludes: "",
  keepOnSplit: false,

  addAttributes() {
    return {
      itemId: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute("data-fc-item") ||
          element.getAttribute("data-fc-key"),
        renderHTML: (attributes) => {
          if (!attributes.itemId) return {};
          return {
            "data-fc-item": attributes.itemId,
            class: "fc-anchor",
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      { tag: "span.fc-anchor[data-fc-item]" },
      { tag: "span[data-fc-item]" },
      {
        tag: "span.fc-target",
        getAttrs: (node) => {
          if (!(node instanceof HTMLElement)) return false;
          const itemId =
            node.getAttribute("data-fc-item") ||
            node.getAttribute("data-fc-key");
          return itemId ? { itemId } : false;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes({ class: "fc-anchor" }, HTMLAttributes),
      0,
    ];
  },

  addCommands() {
    return {
      setFcAnchor:
        (itemId: string) =>
        ({ commands }) =>
          commands.setMark(this.name, { itemId }),
      unsetFcAnchor:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});
