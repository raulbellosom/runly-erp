import { useEffect, useRef, useState } from "react";
import { advanceSpeakingFocus, orderBySpeakingFocus, SPEAKING_FOCUS_STABLE_MS } from "../lib/callLayout";

const TICK_MS = 300;

// Re-evaluates every TICK_MS which identity (if any) has been the top active
// speaker for SPEAKING_FOCUS_STABLE_MS, and returns `entries` reordered to
// put that identity first. `speakingIds` is a Set of identities currently in
// room.activeSpeakers (LiveKit already orders that array loudest-first).
export function useSpeakingOrder(entries, speakingIds) {
  const [focusedId, setFocusedId] = useState(null);
  const stateRef = useRef(null);

  useEffect(() => {
    const tick = () => {
      const candidateId = speakingIds.size ? [...speakingIds][0] : null;
      const next = advanceSpeakingFocus(stateRef.current, { candidateId, now: Date.now(), stableMs: SPEAKING_FOCUS_STABLE_MS });
      stateRef.current = next;
      setFocusedId((current) => (current === next.focusedId ? current : next.focusedId));
    };
    tick();
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, [speakingIds]);

  return orderBySpeakingFocus(entries, focusedId);
}
