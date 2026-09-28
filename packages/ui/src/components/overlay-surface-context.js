import { createContext, useContext } from "react";

// True inside DialogContent / SheetContent. Lets reusable blocks (e.g. the
// RunlyForm action bar) drop their own card surface when the overlay already
// provides one, while keeping it on full-page screens.
export const OverlaySurfaceContext = createContext(false);

export function useInsideOverlay() {
  return useContext(OverlaySurfaceContext);
}
