// Safari accepts touchend/click/keydown as media activation gestures.
const UNLOCK_EVENTS = ["touchend", "click", "keydown"];

export function listenForCallSoundUnlock(target, unlockSounds) {
  let disposed = false;
  let unlocked = false;
  let visibilityGeneration = 0;

  function disarm() {
    UNLOCK_EVENTS.forEach((name) => target.removeEventListener(name, unlock, true));
  }

  function arm() {
    UNLOCK_EVENTS.forEach((name) => target.addEventListener(name, unlock, true));
  }

  async function unlock() {
    if (disposed || unlocked || target.visibilityState === "hidden") return;
    const generation = visibilityGeneration;
    // A blocked resume() can stay pending. Allow the next real gesture to
    // retry rather than locking the audio pipeline behind that promise.
    const ok = await unlockSounds().catch(() => false);
    if (disposed || generation !== visibilityGeneration || !ok) return;
    unlocked = true;
    disarm();
  }

  function handleVisibilityChange() {
    visibilityGeneration += 1;
    unlocked = false;
    // Returning to the PWA only re-arms gestures; it must not activate audio.
    if (target.visibilityState === "visible") arm();
  }

  arm();
  target.addEventListener("visibilitychange", handleVisibilityChange);
  return () => {
    disposed = true;
    disarm();
    target.removeEventListener("visibilitychange", handleVisibilityChange);
  };
}
