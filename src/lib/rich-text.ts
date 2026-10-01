/** Rich caption helpers — HTML subset for bold/underline/color/highlight/images */

const ALLOWED_TAGS = new Set([
  "B",
  "STRONG",
  "I",
  "EM",
  "U",
  "SPAN",
  "BR",
  "DIV",
  "P",
  "IMG",
]);

export function looksLikeHtml(value: string) {
  return /<\/?[a-z][\s\S]*>/i.test(String(value || "").trim());
}

export const INLINE_IMG_CLASS = "rich-inline-img";
export const INLINE_IMG_WRAP_CLASS = "rich-inline-img-wrap";
export const INLINE_IMG_DEL_CLASS = "rich-inline-img-del";
export const IMG_SLOT_CLASS = "rich-img-slot";

export function stripInlineImageControls(html: string) {
  return String(html || "").replace(
    /<span\b[^>]*class=["'][^"']*rich-inline-img-del[^"']*["'][^>]*>[\s\S]*?<\/span>/gi,
    "",
  );
}

export function htmlToPlainText(html: string) {
  const value = stripInlineImageControls(html);
  if (!value) return "";
  if (typeof document === "undefined") {
    return value
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .trim();
  }
  const el = document.createElement("div");
  el.innerHTML = value;
  el.querySelectorAll(`.${INLINE_IMG_DEL_CLASS}`).forEach((node) => node.remove());
  el.querySelectorAll(`.${INLINE_IMG_WRAP_CLASS}`).forEach((wrap) => {
    const img = wrap.querySelector("img");
    if (img) wrap.replaceWith(img);
    else wrap.remove();
  });
  el.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  el.querySelectorAll("img").forEach((img) => {
    const alt = img.getAttribute("alt") || "이미지";
    img.replaceWith(`[${alt}]`);
  });
  el.querySelectorAll("[data-img-slot]").forEach((slot) => {
    const id = slot.getAttribute("data-img-slot") || "S";
    slot.replaceWith(`[${id}]`);
  });
  return (el.innerText || el.textContent || "")
    .replace(/\u00a0/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Normalize #hex / rgb(a) to #rrggbb for sanitize + editor tools. */
export function toHexColor(value: string): string | null {
  const v = String(value || "").trim();
  const hex = v.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    const body = hex[1];
    if (body.length === 3) {
      return `#${body
        .split("")
        .map((ch) => `${ch}${ch}`)
        .join("")
        .toLowerCase()}`;
    }
    return `#${body.slice(0, 6).toLowerCase()}`;
  }
  const rgb = v.match(
    /^rgba?\(\s*(\d+)\s*[,/\s]\s*(\d+)\s*[,/\s]\s*(\d+)/i,
  );
  if (rgb) {
    const h = (n: number) =>
      Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
    return `#${h(Number(rgb[1]))}${h(Number(rgb[2]))}${h(Number(rgb[3]))}`;
  }
  return null;
}

export type InlineStyleOpts = {
  color?: string;
  backgroundColor?: string;
  bold?: boolean;
  underline?: boolean;
};

function styleFromInlineAttrs(style: InlineStyleOpts) {
  const parts: string[] = [];
  const colorHex = style.color ? toHexColor(style.color) : null;
  const bgHex = style.backgroundColor
    ? toHexColor(style.backgroundColor)
    : null;
  if (colorHex) parts.push(`color:${colorHex}`);
  if (bgHex) parts.push(`background-color:${bgHex}`);
  if (style.bold) parts.push("font-weight:700");
  if (style.underline) parts.push("text-decoration:underline");
  return parts.join(";");
}

/**
 * Wrap a live selection in a styled span (bold/underline/color/highlight).
 * More reliable than execCommand when the toolbar steals focus.
 */
export function wrapRangeWithStyle(
  root: HTMLElement,
  range: Range,
  style: InlineStyleOpts,
): Range | null {
  if (!root.contains(range.commonAncestorContainer)) return null;
  if (range.collapsed) return null;

  const css = styleFromInlineAttrs(style);
  if (!css) return null;

  // Prefer semantic tags when only bold or only underline is requested.
  let wrapper: HTMLElement;
  if (style.bold && !style.underline && !style.color && !style.backgroundColor) {
    wrapper = document.createElement("b");
  } else if (
    style.underline &&
    !style.bold &&
    !style.color &&
    !style.backgroundColor
  ) {
    wrapper = document.createElement("u");
  } else {
    wrapper = document.createElement("span");
    wrapper.setAttribute("style", css);
  }

  try {
    range.surroundContents(wrapper);
  } catch {
    const contents = range.extractContents();
    wrapper.appendChild(contents);
    range.insertNode(wrapper);
  }

  const next = document.createRange();
  next.selectNodeContents(wrapper);
  return next;
}

function sanitizeStyle(style: string) {
  const out: string[] = [];
  const color = style.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i)?.[1]?.trim();
  const bg =
    style.match(/(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/i)?.[1]?.trim();
  const weight = style.match(/(?:^|;)\s*font-weight\s*:\s*([^;]+)/i)?.[1]?.trim();
  const decoration = style
    .match(/(?:^|;)\s*text-decoration(?:-line)?\s*:\s*([^;]+)/i)?.[1]
    ?.trim();
  const colorHex = color ? toHexColor(color) : null;
  const bgHex = bg ? toHexColor(bg) : null;
  if (colorHex) out.push(`color:${colorHex}`);
  if (bgHex) out.push(`background-color:${bgHex}`);
  if (weight && /^(bold|700|800|900)$/i.test(weight)) out.push("font-weight:700");
  if (decoration && /underline/i.test(decoration)) {
    out.push("text-decoration:underline");
  }
  return out.join(";");
}

export function sanitizeRichHtml(html: string) {
  const value = String(html || "");
  if (!value || typeof document === "undefined") return value;
  const root = document.createElement("div");
  root.innerHTML = value;

  const walk = (node: Node) => {
    const children = Array.from(node.childNodes);
    for (const child of children) {
      if (child.nodeType === Node.TEXT_NODE) continue;
      if (child.nodeType !== Node.ELEMENT_NODE) {
        child.parentNode?.removeChild(child);
        continue;
      }
      const el = child as HTMLElement;
      const tag = el.tagName.toUpperCase();
      if (tag === "FONT" || tag === "MARK") {
        const color =
          toHexColor(el.getAttribute("color") || "") ||
          toHexColor(el.style.color || "");
        const bg =
          toHexColor(el.style.backgroundColor || "") ||
          toHexColor(el.style.background || "") ||
          (tag === "MARK" ? "#fef08a" : null);
        const span = document.createElement("span");
        const css = styleFromInlineAttrs({
          color: color || undefined,
          backgroundColor: bg || undefined,
        });
        if (css) span.setAttribute("style", css);
        while (el.firstChild) span.appendChild(el.firstChild);
        el.replaceWith(span);
        walk(node);
        return;
      }
      if (!ALLOWED_TAGS.has(tag)) {
        const frag = document.createDocumentFragment();
        while (el.firstChild) frag.appendChild(el.firstChild);
        el.replaceWith(frag);
        walk(node);
        return;
      }
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        if (name === "style") {
          const cleaned = sanitizeStyle(attr.value);
          if (cleaned) el.setAttribute("style", cleaned);
          else el.removeAttribute("style");
          continue;
        }
        if (tag === "IMG" && (name === "src" || name === "alt")) {
          const src = el.getAttribute("src") || "";
          if (
            !src.startsWith("/") &&
            !src.startsWith("https://") &&
            !src.startsWith("http://") &&
            !src.startsWith("data:image/")
          ) {
            el.remove();
          }
          continue;
        }
        if (
          name === "data-img-slot" ||
          name === "data-fc-item" ||
          name === "data-fc-key" ||
          name === "data-fc-n" ||
          name === "class" ||
          name === "contenteditable"
        ) {
          continue;
        }
        if (name === "role" || name === "aria-label") continue;
        el.removeAttribute(attr.name);
      }
      if (el.classList.contains(INLINE_IMG_WRAP_CLASS)) {
        el.setAttribute("contenteditable", "false");
        el.classList.remove(IMG_SLOT_CLASS);
        walk(el);
        continue;
      }
      if (tag === "IMG") {
        if (!el.parentNode) continue;
        el.setAttribute("contenteditable", "false");
        el.classList.add(INLINE_IMG_CLASS);
        el.classList.remove(IMG_SLOT_CLASS);
        ensureInlineImageWrap(el as HTMLImageElement);
        continue;
      }
      if (el.getAttribute("data-img-slot")) {
        el.setAttribute("contenteditable", "false");
        el.classList.add(IMG_SLOT_CLASS);
      }
      walk(el);
    }
  };

  walk(root);
  return root.innerHTML;
}

export function plainToHtml(text: string) {
  const value = String(text || "");
  if (!value) return "";
  if (looksLikeHtml(value)) return sanitizeRichHtml(value);
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}

export const TEXT_COLORS = [
  { id: "ink", label: "검정", value: "#1e293b" },
  { id: "orange", label: "주황", value: "#c45c26" },
  { id: "blue", label: "파랑", value: "#2563eb" },
  { id: "red", label: "빨강", value: "#dc2626" },
  { id: "green", label: "녹색", value: "#15803d" },
] as const;

export const HIGHLIGHT_COLORS = [
  { id: "yellow", label: "노랑 형광", value: "#fef08a" },
  { id: "sky", label: "파랑 형광", value: "#bfdbfe" },
  { id: "pink", label: "빨강 형광", value: "#fecaca" },
  { id: "mint", label: "녹색 형광", value: "#bbf7d0" },
] as const;

function ensureDeleteControl(wrap: HTMLElement, img: HTMLImageElement) {
  let del = wrap.querySelector(`:scope > .${INLINE_IMG_DEL_CLASS}`) as HTMLElement | null;
  if (!del) {
    del = document.createElement("span");
    del.className = INLINE_IMG_DEL_CLASS;
    wrap.appendChild(del);
  }
  const alt = img.getAttribute("alt") || "이미지";
  del.setAttribute("contenteditable", "false");
  del.setAttribute("role", "button");
  del.setAttribute("aria-label", `${alt} 삭제`);
  del.textContent = "×";
}

/** Wrap a pasted/inline image so the editor can show a delete control. */
export function ensureInlineImageWrap(img: HTMLImageElement) {
  const parent = img.parentElement;
  if (parent?.classList.contains(INLINE_IMG_WRAP_CLASS)) {
    parent.setAttribute("contenteditable", "false");
    parent.classList.remove(IMG_SLOT_CLASS);
    ensureDeleteControl(parent, img);
    return parent;
  }
  const wrap = document.createElement("span");
  wrap.className = INLINE_IMG_WRAP_CLASS;
  wrap.setAttribute("contenteditable", "false");
  img.replaceWith(wrap);
  wrap.appendChild(img);
  ensureDeleteControl(wrap, img);
  return wrap;
}

export function createInlineImage(src: string, alt: string, slotId?: string) {
  const img = document.createElement("img");
  img.src = src;
  img.alt = alt;
  img.className = INLINE_IMG_CLASS;
  img.setAttribute("contenteditable", "false");
  if (slotId) img.setAttribute("data-img-slot", slotId);
  return ensureInlineImageWrap(img);
}

export function nextSlotId(html: string) {
  const used = new Set<number>();
  const re = /data-img-slot=["']S(\d+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    used.add(Number(m[1]));
  }
  let n = 1;
  while (used.has(n)) n += 1;
  return `S${n}`;
}

export type RichContentPart =
  | { type: "text"; value: string }
  | { type: "image"; src: string; alt: string };

function decodeBasicEntities(value: string) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function attrFromTag(tag: string, name: string) {
  const m = tag.match(
    new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"),
  );
  return (m?.[1] ?? m?.[2] ?? "").trim();
}

function htmlTextFragment(html: string) {
  return decodeBasicEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div)>/gi, "\n")
      .replace(/<(p|div)[^>]*>/gi, "")
      .replace(/<[^>]+>/g, ""),
  ).replace(/\u00a0/g, " ");
}

function pushTextPart(parts: RichContentPart[], html: string) {
  const value = htmlTextFragment(html);
  if (!value) return;
  const last = parts[parts.length - 1];
  if (last?.type === "text") last.value += value;
  else parts.push({ type: "text", value });
}

/** Split caption HTML into text and inline images, preserving document order. */
export function htmlToContentParts(html: string): RichContentPart[] {
  const value = stripInlineImageControls(html);
  if (!value.trim()) return [];
  const parts: RichContentPart[] = [];
  const re =
    /<img\b[^>]*>|<span\b[^>]*data-img-slot=["'][^"']+["'][^>]*>[\s\S]*?<\/span>/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value))) {
    pushTextPart(parts, value.slice(last, m.index));
    const tag = m[0];
    if (/^<img\b/i.test(tag)) {
      const src = attrFromTag(tag, "src");
      const alt = attrFromTag(tag, "alt") || "이미지";
      if (src) parts.push({ type: "image", src, alt });
      else pushTextPart(parts, `[${alt}]`);
    } else {
      const id = attrFromTag(tag, "data-img-slot") || "S";
      pushTextPart(parts, `[${id}]`);
    }
    last = m.index + tag.length;
  }
  pushTextPart(parts, value.slice(last));
  return parts;
}

export function inlineImageSrcs(html: string): string[] {
  return htmlToContentParts(html)
    .filter(
      (part): part is Extract<RichContentPart, { type: "image" }> =>
        part.type === "image",
    )
    .map((part) => part.src);
}
