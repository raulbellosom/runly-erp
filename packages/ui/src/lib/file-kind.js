import { fileKindOf, fileKindLabel, fileKindAccent } from "@runly/core";

// Facade over @runly/core so existing imports in this module keep working.
// getFileKind now takes the whole file (name + mime) so the extension
// fallback in fileKindOf applies — pass the file object, not file.mimeType.
export function getFileKind(file) {
  if (typeof file === "string") return fileKindOf({ mimeType: file });
  return fileKindOf(file ?? {});
}

export function getKindLabel(kind) {
  return fileKindLabel(kind);
}

function prefersDark() {
  if (typeof document !== "undefined" && document.documentElement.classList.contains("dark")) return true;
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  return false;
}

export function getKindAccent(kind) {
  return fileKindAccent(kind, { dark: prefersDark() });
}

export function formatBytes(bytes = 0) {
  const size = Math.max(0, Number(bytes || 0));
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(value) {
  try {
    return new Date(value).toLocaleString("es-MX", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return String(value ?? "—");
  }
}
