import test from "node:test";
import assert from "node:assert/strict";
import { projectSummary } from "../builderProjectSummary.js";

test("definition values win over the creation-time project row", () => {
  const summary = projectSummary({
    // Published, then edited: the draft status is DRAFT but the module is installed.
    name: "custom.encuestas", description: null, moduleKey: "custom.encuestas", status: "DRAFT", publishedAt: "2026-09-27", hasUnpublishedChanges: true,
    definition: {
      name: "Encuestas de satisfacción", description: "Captura encuestas", version: "1.2.0", icon: "ClipboardList", color: "#2563EB",
      entities: [
        { key: "encuesta", layout: { tabs: [] }, fields: [{ type: "text" }, { type: "relation" }] },
        { key: "respuesta", fields: [{ type: "file" }] },
      ],
      views: [{ kind: "KANBAN" }, { kind: "TABLE", generated: true }],
    },
  });
  assert.equal(summary.name, "Encuestas de satisfacción");
  assert.equal(summary.description, "Captura encuestas");
  assert.deepEqual([summary.entityCount, summary.fieldCount, summary.viewCount, summary.designedEntities, summary.relationCount, summary.fileCount], [2, 3, 1, 1, 1, 1]);
  assert.equal(summary.unpublishedChanges, true);
  assert.equal(summary.status, "PUBLISHED");
  assert.equal(summary.published, true);
});

test("a detached project reports advanced mode", () => {
  const summary = projectSummary({ name: "Viejo", status: "PUBLISHED", detachedAt: "2026-09-28", hasUnpublishedChanges: true, definition: {} });
  assert.equal(summary.status, "ADVANCED");
  assert.equal(summary.unpublishedChanges, false);
  assert.equal(summary.name, "Viejo");
});
