import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shouldShowMiraiTab, moduleKeyFromPath, buildMiraiPageContext, openMiraiSidebar } from "../miraiPageContext.js";

describe("shouldShowMiraiTab", () => {
  it("hides the tab on runly.chat", () => {
    assert.equal(shouldShowMiraiTab({ moduleKey: "runly.chat", canUse: true, available: true }), false);
  });

  it("shows the tab on runly.pfm (MirAI replaces the PFM assistant there)", () => {
    assert.equal(shouldShowMiraiTab({ moduleKey: "runly.pfm", canUse: true, available: true }), true);
  });

  it("shows the tab on runly.inventory (MirAI replaces the inventory assistant there)", () => {
    assert.equal(shouldShowMiraiTab({ moduleKey: "runly.inventory", canUse: true, available: true }), true);
  });

  it("hides the tab when the user cannot use MirAI or it is not available", () => {
    assert.equal(shouldShowMiraiTab({ moduleKey: "runly.calendar", canUse: false, available: true }), false);
    assert.equal(shouldShowMiraiTab({ moduleKey: "runly.calendar", canUse: true, available: false }), false);
  });

  it("shows the tab on runly.calendar and on home (null moduleKey)", () => {
    assert.equal(shouldShowMiraiTab({ moduleKey: "runly.calendar", canUse: true, available: true }), true);
    assert.equal(shouldShowMiraiTab({ moduleKey: null, canUse: true, available: true }), true);
  });
});

describe("moduleKeyFromPath", () => {
  it("extracts the module key from an /app/m/<key>/... path", () => {
    assert.equal(moduleKeyFromPath("/app/m/runly.calendar/x"), "runly.calendar");
  });

  it("returns null for non-module paths", () => {
    assert.equal(moduleKeyFromPath("/app/home"), null);
    assert.equal(moduleKeyFromPath(""), null);
    assert.equal(moduleKeyFromPath(undefined), null);
  });
});

describe("buildMiraiPageContext", () => {
  it("returns null when the path has no module", () => {
    assert.equal(buildMiraiPageContext("/app/home", null), null);
  });

  it("builds a page context with the module key and current record merged in", () => {
    const ctx = buildMiraiPageContext("/app/m/runly.calendar/x", { recordType: "event", recordId: "e1" });
    assert.equal(ctx.moduleKey, "runly.calendar");
    assert.equal(ctx.path, "/app/m/runly.calendar/x");
    assert.equal(ctx.recordType, "event");
    assert.equal(ctx.recordId, "e1");
  });

  it("merges a selection (inventory list filters/selected rows) into the page context", () => {
    const selection = { mode: "selected", ids: ["a", "b"], filters: {} };
    const ctx = buildMiraiPageContext("/app/m/runly.inventory/inventory", { selection });
    assert.equal(ctx.moduleKey, "runly.inventory");
    assert.deepEqual(ctx.selection, selection);
  });
});

describe("openMiraiSidebar", () => {
  it("is callable with no subscribers (MiraiSidebarHost may not be mounted yet)", () => {
    assert.doesNotThrow(() => openMiraiSidebar());
  });
});
