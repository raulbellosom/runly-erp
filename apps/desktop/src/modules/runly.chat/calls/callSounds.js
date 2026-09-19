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

let audioContext = null;
const bufferPromises = new Map();
const audioElements = new Map();

function clampVolume(value) {
  return Math.min(1, Math.max(0, value));
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

// Unlock only Web Audio inside a user gesture. Playing silent HTML audio here
// claims iOS's Now Playing UI even when the user is only navigating the app.
// HTML audio remains available for real sounds (including ringtone retries).
export async function unlockCallSounds() {
  try {
    const context = getAudioContext();
    if (!context) return false;
    if (context.state !== "running") await context.resume();
    if (context.state !== "running") return false;
    // Fetch/decode without starting a source or delaying gesture completion.
    void Promise.allSettled(
      Object.keys(CALL_SOUND_URLS).map((name) => loadBuffer(name, context)),
    );
    return true;
  } catch {
    return false;
  }
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
    if (stopped) return true;
    elementAudio = ensureAudioElement(name);
    if (!elementAudio) return false;
    elementAudio.muted = false;
    elementAudio.loop = loop;
    elementAudio.volume = clampVolume(volume);
    try { elementAudio.currentTime = 0; } catch {}
    await elementAudio.play();
    if (stopped) {
      elementAudio.pause();
      return true;
    }
    return true;
  }

  async function playWithWebAudio() {
    if (stopped) return true;
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
  };
}
