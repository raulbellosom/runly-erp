import { createContext, useContext } from "react";

// True inside DialogContent / SheetContent. Lets reusable blocks (e.g. the
// RunlyForm action bar) drop their own card surface when the overlay already
// provides one, while keeping it on full-page screens.
export const OverlaySurfaceContext = createContext(false);

export function useInsideOverlay() {
  return useContext(OverlaySurfaceContext);
}

// Fields inside a modal/sheet are almost never credentials, cards or
// addresses, yet the OS autofill (iOS QuickType bar, Android autofill chips)
// pops over the next field while typing. Default them to autocomplete="off";
// an explicit autoComplete prop (login, contact email...) always wins.
export function useOverlayAutoComplete(explicit) {
  const inOverlay = useContext(OverlaySurfaceContext);
  return explicit ?? (inOverlay ? "off" : undefined);
}
