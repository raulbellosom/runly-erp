import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";

import { GrowthPropertyServiceError } from "./growth-property-service.js";
import {
  growthPropertyCreateSchema,
  growthPropertyUpdateSchema,
} from "./growth-validators.js";

function companyId(c) {
  return c.get("companyId") ?? null;
}

function handleError(c, error) {
  if (error instanceof GrowthPropertyServiceError) {
    return c.json({ error: error.message, code: error.code }, error.status);
  }
  console.error("[runly.growth.properties]", error);
  return c.json({ error: "Error interno de sitios Growth." }, 500);
}

export function createGrowthPropertyRoutes({ service, requirePermission }) {
  const app = new Hono();

  app.get("/growth/properties", requirePermission("growth.access"), async (c) => {
    try {
      const data = await service.listProperties({ companyId: companyId(c) });
      return c.json({ data });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post(
    "/growth/properties",
    requirePermission("growth.properties.manage"),
    zValidator("json", growthPropertyCreateSchema),
    async (c) => {
      try {
        const data = await service.createExternalProperty({
          companyId: companyId(c),
          ...c.req.valid("json"),
        });
        return c.json({ data }, 201);
      } catch (error) {
        return handleError(c, error);
      }
    },
  );

  app.patch(
    "/growth/properties/:id",
    requirePermission("growth.properties.manage"),
    zValidator("json", growthPropertyUpdateSchema),
    async (c) => {
      try {
        const data = await service.updateProperty({
          companyId: companyId(c),
          propertyId: c.req.param("id"),
          patch: c.req.valid("json"),
        });
        return c.json({ data });
      } catch (error) {
        return handleError(c, error);
      }
    },
  );

  app.post(
    "/growth/properties/:id/verify",
    requirePermission("growth.properties.manage"),
    async (c) => {
      try {
        const result = await service.verifyProperty({
          companyId: companyId(c),
          propertyId: c.req.param("id"),
        });
        return c.json({ data: result.property, verified: result.verified });
      } catch (error) {
        return handleError(c, error);
      }
    },
  );

  return app;
}
