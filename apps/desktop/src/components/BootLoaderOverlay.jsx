import { useMemo } from "react";
import { useBootLoaderStore } from "../stores/bootLoader";
import { AppLoader } from "./AppLoader";

// Mounted once at a fixed position in the tree (see AppEntry.jsx) so it
// survives every boot-phase transition instead of being unmounted and
// remounted alongside the gate that currently needs it.
export function BootLoaderOverlay() {
  const reasons = useBootLoaderStore((s) => s.reasons);
  const message = useMemo(() => {
    for (const value of reasons.values()) {
      if (typeof value === "string") return value;
    }
    return undefined;
  }, [reasons]);

  if (reasons.size === 0) return null;
  return <AppLoader message={message} />;
}
