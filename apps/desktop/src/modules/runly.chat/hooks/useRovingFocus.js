import { useCallback } from "react";

// Arrow-key navigation between sibling `[data-connector-row]` buttons inside
// a results container. Tab already reaches every row one at a time (they're
// plain buttons), this just makes Up/Down feel like a normal list picker
// instead of tabbing through rows one by one — attach as the container's
// onKeyDown.
export function useRovingFocus() {
  return useCallback((e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const rows = Array.from(e.currentTarget.querySelectorAll("[data-connector-row]"));
    if (!rows.length) return;
    e.preventDefault();
    const currentIndex = rows.indexOf(document.activeElement);
    const nextIndex = e.key === "ArrowDown"
      ? (currentIndex + 1) % rows.length
      : (currentIndex - 1 + rows.length) % rows.length;
    rows[nextIndex]?.focus();
  }, []);
}
