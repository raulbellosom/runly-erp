// packages/ui/src/components/combobox-parts.jsx
//
// Headless helpers behind the unified Combobox (Combobox.jsx): search
// matching, the "offer Crear?" rule and keyboard navigation (ArrowUp/Down,
// Tab/Shift+Tab, Home/End, Enter, Escape). Visual pieces live in
// combobox-rows.jsx.
import { useEffect, useRef, useState } from "react";

// Every search word must appear in the option label, description, hint or
// its optional `keywords` string, so "dell 2023" matches "XPS 15 · Dell · 2023".
export function optionMatchesSearch(option, search) {
  const haystack = [
    option.label,
    option.keywords,
    option.description,
    option.hint,
    option.meta?.title,
    option.meta?.subtitle,
    option.meta?.badge,
  ]
    .filter((part) => typeof part === "string" || typeof part === "number")
    .join(" ")
    .toLowerCase();
  return search.toLowerCase().split(/\s+/).filter(Boolean).every((word) => haystack.includes(word));
}

// True when the typed text should offer a "Crear" row: non-empty and not an
// exact (case-insensitive) match of an existing option label.
export function shouldOfferCreate(search, options) {
  const term = search.trim().toLowerCase();
  if (!term) return false;
  return !options.some((o) => String(o.label ?? "").trim().toLowerCase() === term);
}

// `count` = number of navigable rows (options + optional create row).
// `onPick(index)` runs on Enter. Rows must render `data-nav-index={i}` so the
// active one can be scrolled into view.
export function useListboxNav({ open, count, initialIndex = 0, onPick, onClose, listRef }) {
  const [activeIndex, setActiveIndex] = useState(-1);
  const countRef = useRef(count);
  countRef.current = count;

  useEffect(() => {
    if (open) setActiveIndex(count > 0 ? Math.min(Math.max(initialIndex, 0), count - 1) : -1);
    // Only on open: typing resets explicitly via resetActive().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Options can arrive after opening (remote search) or shrink while typing.
  useEffect(() => {
    if (!open) return;
    setActiveIndex((i) => (count === 0 ? -1 : i < 0 ? 0 : Math.min(i, count - 1)));
  }, [open, count]);

  useEffect(() => {
    if (activeIndex < 0 || !listRef?.current) return;
    const el = listRef.current.querySelector(`[data-nav-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, listRef]);

  function move(delta) {
    const n = countRef.current;
    if (n === 0) return;
    setActiveIndex((i) => (i < 0 ? (delta > 0 ? 0 : n - 1) : (i + delta + n) % n));
  }

  function onKeyDown(e) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        move(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        move(-1);
        break;
      case "Tab":
        e.preventDefault();
        move(e.shiftKey ? -1 : 1);
        break;
      case "Home":
        if (countRef.current > 0) { e.preventDefault(); setActiveIndex(0); }
        break;
      case "End":
        if (countRef.current > 0) { e.preventDefault(); setActiveIndex(countRef.current - 1); }
        break;
      case "Enter":
      case " ":
        // Space only picks when focus is on the listbox itself (no search box).
        if (e.key === " " && e.target instanceof HTMLInputElement) break;
        e.preventDefault();
        if (activeIndex >= 0 && activeIndex < countRef.current) onPick(activeIndex);
        break;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        onClose?.();
        break;
      default:
    }
  }

  function resetActive(nextCount) {
    setActiveIndex(nextCount > 0 ? 0 : -1);
  }

  return { activeIndex, setActiveIndex, onKeyDown, resetActive };
}
