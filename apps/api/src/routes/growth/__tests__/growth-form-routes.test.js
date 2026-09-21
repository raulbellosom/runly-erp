import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";

import { createGrowthFormRoutes } from "../growth-form-routes.js";
import { GrowthPropertyServiceError } from "../growth-property-service.js";

function buildApp() {
  const createForm = () => {
    throw new Error("should not be called");
  };
  const formsService = { createForm, listFormAssignees: async () => [] };
  const growthPropertyService = {
    assertProperty: async () => {
      throw new GrowthPropertyServiceError("Sitio no encontrado.", 404, "property_not_found");
    },
  };
  const requirePermission = () => async (c, next) => {
    c.set("companyId", "11111111-1111-7111-8111-111111111111");
    await next();
  };
  const app = new Hono();
  app.route("", createGrowthFormRoutes({ formsService, growthPropertyService, requirePermission }));
  return app;
}

test("POST /growth/forms 404s when propertyId doesn't resolve, without calling createForm", async () => {
  const app = buildApp();
  const res = await app.request("/growth/forms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ propertyId: "22222222-2222-7222-8222-222222222222", name: "Contacto" }),
  });
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.code, "property_not_found");
});
