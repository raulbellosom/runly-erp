import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeRelationDescriptor,
  normalizeToFilterBarFilters,
  shouldUsePageMode,
} from "../renderer-adapters.js";

test("shouldUsePageMode enables page mode for large forms", () => {
  const fields = Array.from({ length: 7 }).map((_, index) => ({
    name: `field_${index}`,
  }));
  assert.equal(shouldUsePageMode({}, fields), true);
});

test("shouldUsePageMode keeps sheet mode for short forms", () => {
  const fields = Array.from({ length: 3 }).map((_, index) => ({
    name: `field_${index}`,
  }));
  assert.equal(shouldUsePageMode({}, fields), false);
});

test("normalizeRelationDescriptor rejects invalid remote relation without apiPath", () => {
  const descriptor = normalizeRelationDescriptor({
    name: "contactId",
    required: false,
    relation: { source: "remote" },
  });
  assert.equal(descriptor, null);
});

test("normalizeRelationDescriptor normalizes modal inline-create config", () => {
  const descriptor = normalizeRelationDescriptor({
    name: "contactId",
    required: true,
    relation: {
      source: "remote",
      apiPath: "/contacts",
      create: {
        enabled: true,
        mode: "modal",
        viewKey: "contacts.contact.form",
      },
    },
  });
  assert.equal(descriptor.source, "remote");
  assert.equal(descriptor.create.enabled, true);
  assert.equal(descriptor.create.mode, "modal");
  assert.equal(descriptor.create.apiPath, "/contacts");
  assert.equal(descriptor.clearable, false);
});

test("normalizeRelationDescriptor normalizes quick inline-create config", () => {
  const descriptor = normalizeRelationDescriptor({
    name: "jobTitleId",
    required: false,
    relation: {
      source: "remote",
      apiPath: "/hr/job-titles",
      create: {
        enabled: true,
        mode: "quick",
        label: "Crear puesto",
      },
    },
  });
  assert.equal(descriptor.create.enabled, true);
  assert.equal(descriptor.create.mode, "quick");
  assert.equal(descriptor.create.apiPath, "/hr/job-titles");
  assert.equal(descriptor.create.nameField, "name");
  assert.equal(descriptor.create.viewKey, undefined);
});

test("normalizeRelationDescriptor ignores quick create without an apiPath", () => {
  const descriptor = normalizeRelationDescriptor({
    name: "jobTitleId",
    relation: {
      source: "static",
      options: [{ value: "1", label: "Uno" }],
      create: { enabled: true, mode: "quick" },
    },
  });
  assert.equal(descriptor.create, null);
});

test("normalizeToFilterBarFilters includes only select filters", () => {
  const filters = normalizeToFilterBarFilters([
    {
      key: "status",
      label: "Estado",
      type: "select",
      options: [{ value: "active", label: "Activo" }],
    },
    {
      key: "query",
      label: "Buscar",
      type: "text",
      options: [],
    },
  ]);
  assert.equal(filters.length, 1);
  assert.deepEqual(filters[0], {
    key: "status",
    label: "Estado",
    options: [{ value: "active", label: "Activo" }],
  });
});
