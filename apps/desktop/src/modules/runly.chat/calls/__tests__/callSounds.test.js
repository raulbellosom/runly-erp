import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { CALL_SOUND_URLS } from "../callSounds.js";

const globals = ["Audio", "AudioContext", "webkitAudioContext", "fetch", "navigator"];
const originals = new Map(globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
let moduleId = 0;
const flush = () => new Promise((resolve) => setImmediate(resolve));
const isolatedSounds = () => import(`../callSounds.js?test=${++moduleId}`);

afterEach(() => {
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});

function browser() {
  const state = {
    elements: [], sources: [], fetches: [], resumeCalls: 0,
    rejectElement: false, rejectResume: false, rejectDecode: false,
    mediaSession: { playbackState: "playing", metadata: { title: "Nota de voz" } },
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true, value: { mediaSession: state.mediaSession },
  });
  globalThis.webkitAudioContext = undefined;
  globalThis.Audio = class {
    constructor(src) {
      this.src = src;
      this.paused = true;
      this.playCalls = 0;
      state.elements.push(this);
    }
    load() {}
    play() {
      this.playCalls++;
      if (state.rejectElement) return Promise.reject(new Error("NotAllowedError"));
      this.paused = false;
      return Promise.resolve();
    }
    pause() { this.paused = true; }
  };
  globalThis.AudioContext = class {
    constructor() {
      this.state = "suspended";
      this.destination = {};
      state.context = this;
    }
    resume() {
      state.resumeCalls++;
      if (state.rejectResume) return Promise.reject(new Error("NotAllowedError"));
      this.state = "running";
      return Promise.resolve();
    }
    decodeAudioData(data) {
      if (state.rejectDecode) return Promise.reject(new Error("Decode failed"));
      return Promise.resolve(data);
    }
    createGain() {
      return { gain: {}, connect() { return this; } };
    }
    createBufferSource() {
      const source = {
        connect() { return this; },
        start() { this.started = true; },
        stop() { this.stopped = true; },
      };
      state.sources.push(source);
      return source;
    }
  };
  globalThis.fetch = async (url) => {
    state.fetches.push(url);
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
  };
  return state;
}

describe("call sounds", () => {
  it("maps every call event to its packaged public asset", () => {
    assert.deepEqual(CALL_SOUND_URLS, {
      ringtone: "/sounds/calls/ringtone.mp3",
      join: "/sounds/calls/join-call-sound.mp3",
      exit: "/sounds/calls/exit-call-sound.mp3",
      notification: "/sounds/notification.mp3",
    });
  });

  it("preloads and unlocks without any media playback or Media Session changes", async () => {
    const state = browser();
    const sounds = await isolatedSounds();
    sounds.preloadCallSounds();
    assert.equal(state.context, undefined);
    assert.equal(await sounds.unlockCallSounds(), true);
    await flush();
    assert.equal(state.elements.length, 4);
    assert.ok(state.elements.every((element) => element.playCalls === 0 && element.paused));
    assert.equal(state.sources.length, 0);
    assert.deepEqual(state.fetches.sort(), Object.values(CALL_SOUND_URLS).sort());
    assert.equal(state.mediaSession.playbackState, "playing");
    assert.deepEqual(state.mediaSession.metadata, { title: "Nota de voz" });
  });

  it("retries a rejected Web Audio unlock on the next gesture", async () => {
    const state = browser();
    state.rejectResume = true;
    const sounds = await isolatedSounds();
    assert.equal(await sounds.unlockCallSounds(), false);
    state.rejectResume = false;
    assert.equal(await sounds.unlockCallSounds(), true);
    assert.equal(state.resumeCalls, 2);
    assert.equal(state.elements.length, 0);
    assert.equal(state.sources.length, 0);
  });

  it("keeps actual element playback synchronous for ringtone gesture retries", async () => {
    const state = browser();
    const sounds = await isolatedSounds();
    const stop = sounds.playCallSound("ringtone", { loop: true, volume: 0.4 });
    const audio = state.elements[0];
    assert.equal(audio.src, CALL_SOUND_URLS.ringtone);
    assert.equal(audio.loop, true);
    assert.equal(audio.volume, 0.4);
    assert.equal(audio.preload, "auto");
    assert.equal(audio.playCalls, 1);
    stop();
    await flush();
    assert.equal(audio.paused, true);
    assert.equal(audio.currentTime, 0);
    assert.equal(audio.loop, false);
    assert.equal(state.mediaSession.playbackState, "playing");
    assert.deepEqual(state.mediaSession.metadata, { title: "Nota de voz" });
  });

  it("unlocking during a ringtone never replaces or pauses the real sound", async () => {
    const state = browser();
    const sounds = await isolatedSounds();
    const stop = sounds.playCallSound("ringtone", { loop: true });
    await sounds.unlockCallSounds();
    const audio = state.elements[0];
    assert.equal(audio.src, CALL_SOUND_URLS.ringtone);
    assert.equal(audio.paused, false);
    assert.equal(audio.loop, true);
    assert.equal(audio.playCalls, 1);
    stop();
  });

  it("plays notifications, join and exit cues through the unlocked Web Audio context", async () => {
    const state = browser();
    const sounds = await isolatedSounds();
    await sounds.unlockCallSounds();
    for (const name of ["notification", "join", "exit"]) {
      const stop = sounds.playCallSound(name);
      await flush();
      const source = state.sources.at(-1);
      assert.equal(source.started, true);
      assert.equal(source.loop, false);
      stop();
      assert.equal(source.stopped, true);
    }
    assert.equal(state.elements.length, 0);
    assert.equal(state.sources.length, 3);
    assert.equal(state.resumeCalls, 1);
  });

  it("falls back to Web Audio when the unprimed ringtone element is blocked", async () => {
    const state = browser();
    state.rejectElement = true;
    const sounds = await isolatedSounds();
    await sounds.unlockCallSounds();
    const stop = sounds.playCallSound("ringtone", { loop: true });
    await flush();
    assert.equal(state.sources.length, 1);
    assert.equal(state.sources[0].started, true);
    assert.equal(state.sources[0].loop, true);
    stop();
    assert.equal(state.sources[0].stopped, true);
  });

  it("retains real HTML audio fallback if Web Audio is unavailable", async () => {
    const state = browser();
    globalThis.AudioContext = undefined;
    const sounds = await isolatedSounds();
    assert.equal(await sounds.unlockCallSounds(), false);
    assert.equal(state.elements.length, 0);
    const stop = sounds.playCallSound("notification");
    await flush();
    assert.equal(state.elements[0].src, CALL_SOUND_URLS.notification);
    assert.equal(state.elements[0].playCalls, 1);
    stop();
  });

  it("falls back to HTML audio if decoding the real effect fails", async () => {
    const state = browser();
    state.rejectDecode = true;
    const sounds = await isolatedSounds();
    const stop = sounds.playCallSound("notification");
    await flush();
    assert.equal(state.elements[0].playCalls, 1);
    assert.equal(state.sources.length, 0);
    stop();
  });

  it("does not start a late fallback after a ringtone was cancelled", async () => {
    const state = browser();
    state.rejectElement = true;
    const sounds = await isolatedSounds();
    const stop = sounds.playCallSound("ringtone", { loop: true });
    stop();
    await flush();
    assert.equal(state.sources.length, 0);
    assert.equal(state.resumeCalls, 0);
  });

  it("resumes an interrupted context without replaying silent media", async () => {
    const state = browser();
    const sounds = await isolatedSounds();
    await sounds.unlockCallSounds();
    state.context.state = "interrupted";
    await sounds.unlockCallSounds();
    assert.equal(state.context.state, "running");
    assert.equal(state.resumeCalls, 2);
    assert.equal(state.sources.length, 0);
    assert.equal(state.elements.length, 0);
  });

  it("reports when every ringtone playback path is blocked", async () => {
    const state = browser();
    state.rejectElement = true;
    state.rejectResume = true;
    const sounds = await isolatedSounds();
    const blocked = new Promise((resolve) => {
      sounds.playCallSound("ringtone", { loop: true, onBlocked: resolve });
    });
    assert.match((await blocked).message, /NotAllowedError/);
  });
});
