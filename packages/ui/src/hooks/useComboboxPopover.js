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

  // Close on any interaction outside the trigger and the panel. `pointerdown`
  // in the capture phase, because Radix triggers (menus, dropdowns) call
  // preventDefault on pointerdown, which suppresses the legacy `mousedown`.
  // `focusin` covers keyboard jumps that involve no click at all, e.g. the
  // Ctrl+K command palette taking focus (Escape is handled by the combobox keys).
  useEffect(() => {
    if (!open) return undefined;
    const isInside = (node) =>
      node instanceof Node &&
      (containerRef.current?.contains(node) || dropdownRef.current?.contains(node));
    function closeIfOutside(e) {
      if (!isInside(e.target)) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("pointerdown", closeIfOutside, true);
    document.addEventListener("focusin", closeIfOutside, true);
    return () => {
      document.removeEventListener("pointerdown", closeIfOutside, true);
      document.removeEventListener("focusin", closeIfOutside, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const id = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  // The dropdown is portaled to <body>, outside any open Radix Dialog/Sheet.
  // Their focus trap listens for focusin/focusout on `document` and pulls
  // focus back into the dialog, so the search input could never be typed in.
  // Stop those events before they reach `document` while focus moves between
  // the trigger and the dropdown.
  useEffect(() => {
    if (!open) return undefined;
    const dropdown = dropdownRef.current;
    const container = containerRef.current;
    if (!dropdown || !container) return undefined;
    const inDropdown = (node) => node instanceof Node && dropdown.contains(node);
    const stopFocusIn = (e) => { if (inDropdown(e.target)) e.stopPropagation(); };
    const stopFocusOut = (e) => { if (inDropdown(e.relatedTarget)) e.stopPropagation(); };
    dropdown.addEventListener("focusin", stopFocusIn);
    dropdown.addEventListener("focusout", stopFocusOut);
    container.addEventListener("focusout", stopFocusOut);
    return () => {
      dropdown.removeEventListener("focusin", stopFocusIn);
      dropdown.removeEventListener("focusout", stopFocusOut);
      container.removeEventListener("focusout", stopFocusOut);
    };
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

  // Keep the fixed-position panel glued to its trigger while an ancestor
  // (page, Dialog body, Sheet) scrolls or the window resizes. Scrolls inside
  // the panel itself are ignored.
  useEffect(() => {
    if (!open) return undefined;
    let frame = 0;
    function reposition(e) {
      if (e?.type === "scroll" && dropdownRef.current?.contains(e.target)) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (containerRef.current) {
          setDropdownStyle(computeDropdownStyle(containerRef.current, dropHeight, minWidth, true));
        }
      });
    }
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, dropHeight, minWidth]);

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
