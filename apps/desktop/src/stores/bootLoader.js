import { useEffect } from "react";
import { create } from "zustand";

// Several independent gates (brand loading, instance/auth verification,
// active company resolution) each need to show the full-screen boot loader
// in sequence while the app starts up. Rendering <AppLoader/> separately at
// each gate unmounts/remounts it as the tree swaps between them, which
// restarts its CSS animations and reads as flicker. Routing all of them
// through one reason map lets a single, persistently-mounted overlay
// (BootLoaderOverlay) decide visibility, so the loader appears once and
// disappears once per boot sequence.
export const useBootLoaderStore = create((set) => ({
  reasons: new Map(),
  setReason(id, value) {
    set((state) => {
      const reasons = new Map(state.reasons);
      if (value) reasons.set(id, value);
      else reasons.delete(id);
      return { reasons };
    });
  },
}));

export function useBootLoader(id, active, message) {
  const setReason = useBootLoaderStore((s) => s.setReason);
  useEffect(() => {
    setReason(id, active ? (message ?? true) : null);
    return () => setReason(id, null);
  }, [id, active, message, setReason]);
}
