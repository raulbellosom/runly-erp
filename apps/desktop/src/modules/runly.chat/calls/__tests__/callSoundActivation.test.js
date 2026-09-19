import assert from "node:assert/strict";
import { it } from "node:test";
import { listenForCallSoundUnlock } from "../callSoundActivation.js";

const flush = () => new Promise((resolve) => setImmediate(resolve));
function page() {
  const target = new EventTarget();
  target.visibilityState = "visible";
  target.emit = (name) => target.dispatchEvent(new Event(name));
  target.visibility = (state) => {
    target.visibilityState = state;
    target.emit("visibilitychange");
  };
  return target;
}

it("opening and returning to the PWA never activates audio without a gesture", async () => {
  const target = page();
  let calls = 0;
  const cleanup = listenForCallSoundUnlock(target, async () => { calls++; return true; });
  assert.equal(calls, 0);
  target.emit("touchend");
  assert.equal(calls, 1);
  await flush();
  target.emit("click");
  assert.equal(calls, 1);
  target.visibility("hidden");
  target.visibility("visible");
  await flush();
  assert.equal(calls, 1);
  target.emit("touchend");
  assert.equal(calls, 2);
  await flush();
  cleanup();
  target.visibility("visible");
  target.emit("keydown");
  assert.equal(calls, 2);
});

it("a pending or rejected resume does not swallow the next qualifying gesture", async () => {
  const target = page();
  let calls = 0;
  let completeFirst;
  const cleanup = listenForCallSoundUnlock(target, () => {
    calls++;
    if (calls === 1) return new Promise((resolve) => { completeFirst = resolve; });
    if (calls === 2) return Promise.reject(new Error("NotAllowedError"));
    return Promise.resolve(true);
  });
  target.emit("touchend");
  target.emit("click");
  await flush();
  target.emit("keydown");
  await flush();
  assert.equal(calls, 3);
  completeFirst(true);
  await flush();
  target.emit("click");
  assert.equal(calls, 3);
  cleanup();
});

it("completion from a previous visibility period cannot disarm the next gesture", async () => {
  const target = page();
  let calls = 0;
  let completeFirst;
  const cleanup = listenForCallSoundUnlock(target, () => {
    calls++;
    if (calls === 1) return new Promise((resolve) => { completeFirst = resolve; });
    return Promise.resolve(true);
  });
  target.emit("touchend");
  target.visibility("hidden");
  target.emit("click");
  assert.equal(calls, 1);
  target.visibility("visible");
  completeFirst(true);
  await flush();
  target.emit("touchend");
  assert.equal(calls, 2);
  await flush();
  cleanup();
});

it("unmounting removes listeners even while an unlock is pending", async () => {
  const target = page();
  let calls = 0;
  let complete;
  const cleanup = listenForCallSoundUnlock(target, () => {
    calls++;
    return new Promise((resolve) => { complete = resolve; });
  });
  target.emit("touchend");
  cleanup();
  complete(true);
  await flush();
  target.visibility("visible");
  target.emit("touchend");
  assert.equal(calls, 1);
});
