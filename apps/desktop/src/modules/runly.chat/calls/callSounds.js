// The deployed SPA is served under a base path (VITE_BASE_PATH=/app/ in
// infra/docker/web.Dockerfile), and nginx only has explicit rules for
// /brand/ and /module-logos/ — a root-absolute "/sounds/..." falls through to
// the public-website proxy and comes back as index.html, so decodeAudioData /
// <audio>.play() fail and NO sound plays anywhere. Resolve against Vite's
// BASE_URL so it becomes "/app/sounds/..." in prod and "/sounds/..." in dev.
const BASE = import.meta.env?.BASE_URL || "/";

export const CALL_SOUND_URLS = Object.freeze({
  ringtone: `${BASE}sounds/calls/ringtone.mp3`,
  join: `${BASE}sounds/calls/join-call-sound.mp3`,
  exit: `${BASE}sounds/calls/exit-call-sound.mp3`,
  notification: `${BASE}sounds/notification.mp3`,
});

const SILENT_UNLOCK_WAV = "data:audio/wav;base64,UklGRsQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YaAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA";

let audioContext = null;
const bufferPromises = new Map();
const audioElements = new Map();
const elementUnlockPromises = new Map();
const unlockedElements = new Set();

function clampVolume(value) {
  return Math.min(1, Math.max(0, value));
}

// Every real <audio> element here (unlike the WebAudio path) stays attached
// to the DOM for the whole session — iOS ties autoplay permission to the
// element instance, so it can't be torn down after use. But the moment one
// of them is `.play()`ed — even the silent unlock WAV that primes autoplay
// on the very first tap anywhere in the app — iOS Safari treats it as an
// active media session and shows a persistent lock-screen "Now Playing"
// widget (falling back to the document title, since no MediaMetadata is
// ever set) even though nothing is audibly playing. Telling the OS
// explicitly that nothing is playing clears/suppresses that widget without
// touching the autoplay-unlock mechanics themselves.
function clearMediaSession() {
  try {
    if (navigator.mediaSession) {
      navigator.mediaSession.playbackState = "none";
      navigator.mediaSession.metadata = null;
    }
  } catch {}
}

function getAudioContext() {
  if (audioContext?.state === "closed") audioContext = null;
  if (audioContext) return audioContext;
  const AudioContextImpl = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!AudioContextImpl) return null;
  audioContext = new AudioContextImpl();
  return audioContext;
}

function ensureAudioElement(name) {
  if (!CALL_SOUND_URLS[name] || typeof globalThis.Audio !== "function") return null;
  let element = audioElements.get(name);
  if (element) return element;

  element = new globalThis.Audio(CALL_SOUND_URLS[name]);
  element.preload = "auto";
  element.playsInline = true;
  element.setAttribute?.("playsinline", "");
  element.setAttribute?.("aria-hidden", "true");
  element.tabIndex = -1;

  // Keeping the same media element attached for the whole session is
  // important on iOS: autoplay permission is granted per element.
  if (globalThis.document?.body && !element.isConnected) {
    globalThis.document.body.appendChild(element);
  }
  audioElements.set(name, element);
  return element;
}

async function loadBuffer(name, context) {
  if (!CALL_SOUND_URLS[name]) return null;
  if (!bufferPromises.has(name)) {
    bufferPromises.set(name, fetch(CALL_SOUND_URLS[name])
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .then((data) => context.decodeAudioData(data))
      .catch((error) => {
        bufferPromises.delete(name);
        throw error;
      }));
  }
  return bufferPromises.get(name);
}

function primeAudioElement(name) {
  if (unlockedElements.has(name)) return Promise.resolve(true);
  if (elementUnlockPromises.has(name)) return elementUnlockPromises.get(name);

  const element = ensureAudioElement(name);
  if (!element) return Promise.resolve(false);

  // Do not use `muted` here. WebKit permits muted autoplay but can pause the
  // element as soon as it becomes audible. Play real (but silent) PCM inside
  // the gesture, then restore the target on this same reusable element.
  element.muted = false;
  element.volume = 1;
  element.loop = false;
  // Setting .src already schedules a load. Calling .load() explicitly and then
  // .play() on the very next line makes iOS reject the play() promise with an
  // AbortError ("interrupted by a call to load()"), so the silent unlock never
  // "counts" and the real ringtone stays blocked. Just set src + play.
  element.src = SILENT_UNLOCK_WAV;
  try { element.currentTime = 0; } catch {}

  function restoreTarget() {
    element.pause();
    try { element.currentTime = 0; } catch {}
    element.src = CALL_SOUND_URLS[name];
    try { element.load?.(); } catch {}
    clearMediaSession();
  }

  let playResult;
  try {
    playResult = element.play();
  } catch {
    restoreTarget();
    return Promise.resolve(false);
  }

  const unlockPromise = Promise.resolve(playResult)
    .then(() => {
      restoreTarget();
      unlockedElements.add(name);
      return true;
    })
    .catch(() => {
      restoreTarget();
      return false;
    })
    .finally(() => elementUnlockPromises.delete(name));
  elementUnlockPromises.set(name, unlockPromise);
  return unlockPromise;
}

function kickAudioContext(context) {
  try {
    const buffer = context.createBuffer(1, 1, 22050);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start(0);
  } catch {}
}

export async function unlockCallSounds() {
  // Invoke every play() synchronously before the first await so all attempts
  // remain inside the pointer/touch/key activation that called this function.
  const elementAttempts = Object.keys(CALL_SOUND_URLS).map(primeAudioElement);
  const context = getAudioContext();
  let contextReady = false;

  if (context) {
    try {
      if (context.state !== "running" && context.state !== "closed") {
        kickAudioContext(context);
        await context.resume();
      }
      contextReady = context.state === "running";
      if (contextReady) {
        await Promise.allSettled(
          Object.keys(CALL_SOUND_URLS).map((name) => loadBuffer(name, context)),
        );
      }
    } catch {}
  }

  const elementResults = await Promise.all(elementAttempts);
  return contextReady || elementResults.some(Boolean);
}

// The "call ended" cue fires from several independent places almost at once
// when a call tears down: the local hang-up handler, RoomEvent.Disconnected,
// RoomEvent.ParticipantDisconnected and the CallsProvider "call.ended" path.
// Collapse repeats inside a short window so hanging up plays the sound once,
// not two or three times.
let lastEndSoundAt = 0;
export function playCallEndSound() {
  const now = Date.now();
  if (now - lastEndSoundAt < 1500) return () => {};
  lastEndSoundAt = now;
  return playCallSound("exit");
}

export function preloadCallSounds() {
  Object.keys(CALL_SOUND_URLS).forEach((name) => {
    try { ensureAudioElement(name)?.load?.(); } catch {}
  });
}

export function playCallSound(name, {
  loop = false,
  volume = 0.65,
  onBlocked,
} = {}) {
  if (!CALL_SOUND_URLS[name] || typeof globalThis === "undefined") return () => {};

  let stopped = false;
  let sourceNode = null;
  let elementAudio = null;

  async function playWithElement() {
    elementAudio = ensureAudioElement(name);
    if (!elementAudio) return false;
    elementAudio.muted = false;
    elementAudio.loop = loop;
    elementAudio.volume = clampVolume(volume);
    try { elementAudio.currentTime = 0; } catch {}
    await elementAudio.play();
    clearMediaSession();
    if (stopped) {
      elementAudio.pause();
      return true;
    }
    unlockedElements.add(name);
    return true;
  }

  async function playWithWebAudio() {
    const context = getAudioContext();
    if (!context) return false;
    if (context.state !== "running" && context.state !== "closed") await context.resume();
    if (context.state !== "running") return false;
    const buffer = await loadBuffer(name, context);
    if (stopped || !buffer) return true;
    const gain = context.createGain();
    gain.gain.value = clampVolume(volume);
    sourceNode = context.createBufferSource();
    sourceNode.buffer = buffer;
    sourceNode.loop = loop;
    sourceNode.connect(gain).connect(context.destination);
    sourceNode.start();
    return true;
  }

  async function start() {
    let lastError = null;
    const attempts = loop
      ? [playWithElement, playWithWebAudio]
      : [playWithWebAudio, playWithElement];

    for (const attempt of attempts) {
      try {
        if (await attempt()) return;
      } catch (error) {
        lastError = error;
      }
    }

    if (!stopped) {
      console.warn(`[atlas.calls] El navegador bloqueo el sonido ${name}:`, lastError);
      onBlocked?.(lastError);
    }
  }

  start();

  return () => {
    stopped = true;
    try { sourceNode?.stop(); } catch {}
    if (elementAudio) {
      elementAudio.pause();
      try { elementAudio.currentTime = 0; } catch {}
      elementAudio.loop = false;
    }
    clearMediaSession();
  };
}
