import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotificationPromptCooldown } from '../notificationPromptCooldown.js';

function fakeStorage() {
  const store = new Map();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
  };
}

test('does not cool down until a dismissal is recorded', () => {
  const cooldown = createNotificationPromptCooldown({ storage: fakeStorage(), now: () => 0 });
  assert.equal(cooldown.isOnCooldown(), false);
});

test('suppresses re-prompting for the cooldown window after a dismissal', () => {
  let now = 0;
  const storage = fakeStorage();
  const cooldown = createNotificationPromptCooldown({ storage, now: () => now, cooldownMs: 1000 });

  cooldown.markDismissed();
  assert.equal(cooldown.isOnCooldown(), true);

  now = 999;
  assert.equal(cooldown.isOnCooldown(), true);

  now = 1000;
  assert.equal(cooldown.isOnCooldown(), false);
});

test('shares dismissal state across instances backed by the same storage', () => {
  const storage = fakeStorage();
  const first = createNotificationPromptCooldown({ storage, now: () => 0 });
  first.markDismissed();

  const second = createNotificationPromptCooldown({ storage, now: () => 500, cooldownMs: 1000 });
  assert.equal(second.isOnCooldown(), true);
});
