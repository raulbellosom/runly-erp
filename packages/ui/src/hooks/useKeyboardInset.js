import { useEffect, useState } from "react";
import { computeKeyboardInset, isKeyboardOpen } from "../lib/keyboardInset.js";

const IDLE = { inset: 0, visibleHeight: null, offsetTop: 0, open: false };

// Tracks the on-screen keyboard on touch devices via the visualViewport API.
// iOS Safari does not shrink the layout viewport when the keyboard opens, so
// `position: fixed; bottom: 0` surfaces end up hidden behind it; callers use
// `inset` to lift/pad content and `visibleHeight` to cap their height.
// `open` is the reliable "keyboard is up" signal (see isKeyboardOpen) and
// `offsetTop` the visual viewport's pan inside the layout viewport.
// Returns IDLE on desktop/mouse devices and browsers without visualViewport.
export function useKeyboardViewport({ enabled = true } = {}) {
  const [state, setState] = useState(IDLE);

  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!enabled || !vv || !window.matchMedia?.("(pointer: coarse)")?.matches) {
      setState(IDLE);
      return undefined;
    }

    let baseline = { width: window.innerWidth, height: Math.max(window.innerHeight, vv.height) };
    function update() {
      if (window.innerWidth !== baseline.width) {
        baseline = { width: window.innerWidth, height: Math.max(window.innerHeight, vv.height) };
      } else {
        baseline.height = Math.max(baseline.height, window.innerHeight, vv.height);
      }
      const inset = computeKeyboardInset(window.innerHeight, vv.height, vv.offsetTop);
      const open = isKeyboardOpen(baseline.height, vv.height);
      const offsetTop = Math.max(0, Math.round(vv.offsetTop));
      setState((prev) =>
        prev.inset === inset &&
        prev.visibleHeight === vv.height &&
        prev.offsetTop === offsetTop &&
        prev.open === open
          ? prev
          : { inset, visibleHeight: vv.height, offsetTop, open },
      );
    }
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [enabled]);

  return state;
}

export function useKeyboardInset() {
  return useKeyboardViewport().inset;
}

export function useKeyboardOpen() {
  return useKeyboardViewport().open;
}
