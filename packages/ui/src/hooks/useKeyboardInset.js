import { useEffect, useState } from "react";
import { computeKeyboardInset } from "../lib/keyboardInset.js";

const IDLE = { inset: 0, visibleHeight: null };

// Tracks the on-screen keyboard on touch devices via the visualViewport API.
// iOS Safari does not shrink the layout viewport when the keyboard opens, so
// `position: fixed; bottom: 0` surfaces end up hidden behind it; callers use
// `inset` to lift/pad content and `visibleHeight` to cap their height.
// Returns { inset: 0, visibleHeight: null } on desktop/mouse devices and
// browsers without visualViewport.
export function useKeyboardViewport({ enabled = true } = {}) {
  const [state, setState] = useState(IDLE);

  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!enabled || !vv || !window.matchMedia?.("(pointer: coarse)")?.matches) {
      setState(IDLE);
      return undefined;
    }

    function update() {
      const inset = computeKeyboardInset(window.innerHeight, vv.height, vv.offsetTop);
      setState((prev) =>
        prev.inset === inset && prev.visibleHeight === vv.height
          ? prev
          : { inset, visibleHeight: vv.height },
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
