import test from "node:test";
import assert from "node:assert/strict";
import { isolateScroll } from "../../hooks/useIsolatedScroll.js";

function fakeNode() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type, fn) => { if (listeners.get(type) === fn) listeners.delete(type); },
  };
}

test("isolateScroll stops wheel/touch propagation and cleans up", () => {
  const node = fakeNode();
  const cleanup = isolateScroll(node);
  assert.deepEqual([...node.listeners.keys()].sort(), ["touchmove", "touchstart", "wheel"]);
  let stopped = false;
  node.listeners.get("wheel")({ stopPropagation: () => { stopped = true; } });
  assert.equal(stopped, true);
  cleanup();
  assert.equal(node.listeners.size, 0);
  assert.doesNotThrow(() => isolateScroll(null)());
});
