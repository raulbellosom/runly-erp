import test from "node:test";
import assert from "node:assert/strict";
import { createModuleComponentRegistry } from "../module-component-registry-core.js";

test("component registry resolves registered components", () => {
  const registry = createModuleComponentRegistry();
  const ComponentA = () => null;

  registry.register("custom.fleet:VehicleStatusBadge", ComponentA);

  assert.equal(registry.has("custom.fleet:VehicleStatusBadge"), true);
  assert.equal(
    registry.resolve("custom.fleet:VehicleStatusBadge"),
    ComponentA,
  );
});

test("component registry blocks namespaced components when module is inactive", () => {
  const registry = createModuleComponentRegistry();
  const ComponentA = () => null;

  registry.register("custom.fleet:VehicleStatusBadge", ComponentA);
  registry.setActiveModules(["atlas.core"]);

  assert.equal(registry.resolve("custom.fleet:VehicleStatusBadge"), null);
  assert.equal(registry.resolve("atlas.core:Anything"), null);
});

test("component registry allows namespaced components when module is active", () => {
  const registry = createModuleComponentRegistry();
  const ComponentA = () => null;

  registry.register("custom.fleet:VehicleStatusBadge", ComponentA);
  registry.setActiveModules(["custom.fleet"]);

  assert.equal(
    registry.resolve("custom.fleet:VehicleStatusBadge"),
    ComponentA,
  );
});

test("component registry keeps non-namespaced keys always resolvable", () => {
  const registry = createModuleComponentRegistry();
  const SharedComponent = () => null;

  registry.register("RunlyTable", SharedComponent);
  registry.setActiveModules(["atlas.core"]);

  assert.equal(registry.resolve("RunlyTable"), SharedComponent);
});

test("component registry warns and replaces duplicate keys", () => {
  const warnings = [];
  const registry = createModuleComponentRegistry({
    warn: (msg) => warnings.push(msg),
  });
  const ComponentA = () => null;
  const ComponentB = () => null;

  registry.register("custom.fleet:VehicleStatusBadge", ComponentA);
  registry.register("custom.fleet:VehicleStatusBadge", ComponentB);

  assert.equal(
    registry.resolve("custom.fleet:VehicleStatusBadge"),
    ComponentB,
  );
  assert.equal(
    warnings.some((msg) => msg.includes("Duplicate registration")),
    true,
  );
});

test("component registry ignores re-registration of the same component", () => {
  const warnings = [];
  const registry = createModuleComponentRegistry({
    warn: (msg) => warnings.push(msg),
  });
  const ComponentA = () => null;

  registry.register("custom.dispatch:DispatchKiosk", ComponentA);
  registry.register("custom.dispatch:DispatchKiosk", ComponentA);

  assert.equal(registry.resolve("custom.dispatch:DispatchKiosk"), ComponentA);
  assert.deepEqual(warnings, []);
});

test("component registry notifies subscribers when state changes", () => {
  const registry = createModuleComponentRegistry();
  let calls = 0;
  const unsubscribe = registry.subscribe(() => {
    calls += 1;
  });
  const ComponentA = () => null;

  registry.register("custom.fleet:VehicleStatusBadge", ComponentA);
  registry.setActiveModules(["custom.fleet"]);
  unsubscribe();
  registry.setActiveModules(["atlas.core"]);

  assert.equal(calls >= 2, true);
  assert.equal(typeof registry.getVersion(), "number");
});

test('official component namespaces resolve aliases against the active persisted identity in both directions', () => {
  for (const [registered, active] of [['atlas.fleet', 'runly.fleet'], ['runly.fleet', 'atlas.fleet']]) {
    const registry = createModuleComponentRegistry();
    const Component = () => null;
    registry.register(`${registered}:Badge`, Component);
    registry.setActiveModules([active]);
    assert.equal(registry.resolve(`${active}:Badge`), Component);
    assert.equal(registry.resolve(`${registered}:Badge`), Component);
    assert.deepEqual(registry.list(), [`${registered}:Badge`]);
  }
});

test('exact registered components win and known inactive ownership cannot fall through to an active counterpart', () => {
  const registry = createModuleComponentRegistry();
  const Legacy = () => null;
  const Current = () => null;
  registry.register('atlas.fleet:Badge', Legacy);
  registry.register('runly.fleet:Badge', Current);
  registry.register('atlas.fleet:LegacyOnly', Legacy);
  registry.setActiveModules(['atlas.fleet', 'runly.fleet']);
  assert.equal(registry.resolve('atlas.fleet:Badge'), Legacy);
  assert.equal(registry.resolve('runly.fleet:Badge'), Current);
  assert.equal(registry.resolve('runly.fleet:LegacyOnly'), null);
  registry.setActiveModules(['runly.fleet'], ['atlas.fleet', 'runly.fleet']);
  assert.equal(registry.resolve('atlas.fleet:Badge'), null);
  assert.equal(registry.resolve('runly.fleet:Badge'), Current);
});

test('clearing or invalidating the active catalog denies namespaced components and notifies consumers', () => {
  const registry = createModuleComponentRegistry();
  const Component = () => null;
  registry.register('atlas.fleet:Badge', Component);
  registry.register('SharedBadge', Component);
  registry.setActiveModules(['runly.fleet']);
  const version = registry.getVersion();
  for (const active of [[], null]) {
    registry.setActiveModules(active);
    assert.equal(registry.resolve('atlas.fleet:Badge'), null);
    assert.equal(registry.resolve('runly.fleet:Badge'), null);
    assert.equal(registry.resolve('SharedBadge'), Component);
  }
  assert.ok(registry.getVersion() > version);
});

test('unknown and custom component namespaces do not alias', () => {
  const registry = createModuleComponentRegistry();
  registry.register('atlas.unknown:Badge', () => null);
  registry.register('custom.atlas.fleet:Badge', () => null);
  registry.setActiveModules(['runly.unknown', 'custom.runly.fleet']);
  assert.equal(registry.resolve('runly.unknown:Badge'), null);
  assert.equal(registry.resolve('custom.runly.fleet:Badge'), null);
});
