import type { Editor } from "@tiptap/react";

let activeKey: string | null = null;
const editors = new Map<string, Editor>();

export function registerReportEditor(key: string, editor: Editor) {
  editors.set(key, editor);
  if (!activeKey) activeKey = key;
}

export function unregisterReportEditor(key: string, editor: Editor) {
  const current = editors.get(key);
  if (current === editor) editors.delete(key);
  if (activeKey === key) {
    activeKey = editors.keys().next().value ?? null;
  }
}

export function setActiveReportEditorKey(key: string) {
  activeKey = key;
}

export function getActiveReportEditor(): Editor | null {
  if (activeKey && editors.has(activeKey)) {
    return editors.get(activeKey) ?? null;
  }
  const first = editors.values().next();
  return first.value ?? null;
}

export function getReportEditor(key: string): Editor | null {
  return editors.get(key) ?? null;
}
