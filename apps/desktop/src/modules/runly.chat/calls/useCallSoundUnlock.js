import { useEffect } from "react";
import { preloadCallSounds, unlockCallSounds } from "./callSounds.js";
import { listenForCallSoundUnlock } from "./callSoundActivation.js";

export function useCallSoundUnlock() {
  useEffect(() => {
    preloadCallSounds();
    return listenForCallSoundUnlock(document, unlockCallSounds);
  }, []);
}
