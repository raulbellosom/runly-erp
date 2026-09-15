import { useState, useRef, useEffect, useCallback } from "react";

// Calculates `position:fixed` coordinates for a floating dropdown anchored to
// `containerEl`. Works correctly even when the dropdown is rendered inside an
// ancestor that has `backdrop-filter` or `transform` — both properties create a
// new containing block for `position:fixed` descendants (CSS spec). In that case
// the browser treats the fixed element's top/left as relative to that ancestor,
// so we subtract the ancestor's getBoundingClientRect offsets.
export function computeDropdownStyle(
  containerEl,
  dropHeight = 320,
  minWidth = 220,
  forPortal = false,
) {
  const r = containerEl.getBoundingClientRect();
  const spaceBelow = window.innerHeight - r.bottom;
  const flipped = spaceBelow < dropHeight;
  const viewportLeft = r.left;
  const width = Math.max(r.width, minWidth);

  if (forPortal) {
    if (flipped) {
      return { bottom: window.innerHeight - r.top + 4, left: viewportLeft, width, flipped: true };
    }
    return { top: r.bottom + 4, left: viewportLeft, width, flipped: false };
  }

  const viewportTop = flipped
    ? Math.max(0, r.top - dropHeight - 4)
    : r.bottom + 4;

  let el = containerEl.parentElement;
  while (el && el !== document.documentElement) {
    const cs = window.getComputedStyle(el);
    const bf = cs.backdropFilter || cs.webkitBackdropFilter || "none";
    const tf = cs.transform || "none";
    if (bf !== "none" || (tf !== "none" && tf !== "matrix(1, 0, 0, 1, 0, 0)")) {
      const pr = el.getBoundingClientRect();
      return { top: viewportTop - pr.top, left: viewportLeft - pr.left, width };
    }
    el = el.parentElement;
  }

  return { top: viewportTop, left: viewportLeft, width };
}

// Shared plumbing behind ComboboxField/RelationSelectField/CreatableComboboxField:
// open state, portal position, outside-click-to-close, and reliable autofocus of
// the search input (a requestAnimationFrame after `open` flips true — fires right
// after the browser commits/paints the newly-rendered portal content, unlike the
// fixed setTimeout(50) each of the three fields used to hand-roll independently).
export function useComboboxPopover({ dropHeight = 260, minWidth = 220 } = {}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [dropdownStyle, setDropdownStyle] = useState({});
  const containerRef = useRef(null);
  const dropdownRef = useRef(null);
  const searchRef = useRef(null);

  useEffect(() => {
    function handleOutside(e) {
      if (
        !containerRef.current?.contains(e.target) &&
        !dropdownRef.current?.contains(e.target)
      ) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const id = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  const handleOpen = useCallback(
    (onWillOpen) => {
      const willOpen = !open;
      if (willOpen && containerRef.current) {
        setDropdownStyle(computeDropdownStyle(containerRef.current, dropHeight, minWidth, true));
      }
      setOpen((o) => !o);
      if (willOpen) onWillOpen?.();
    },
    [open, dropHeight, minWidth],
  );

  const close = useCallback(() => {
    setOpen(false);
    setSearch("");
  }, []);

  return {
    open,
    setOpen,
    search,
    setSearch,
    dropdownStyle,
    containerRef,
    dropdownRef,
    searchRef,
    handleOpen,
    close,
  };
}
