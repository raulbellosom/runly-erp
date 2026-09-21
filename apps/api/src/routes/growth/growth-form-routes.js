import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";

import { FormsServiceError } from "../../services/forms-service.js";
import { GrowthPropertyServiceError } from "./growth-property-service.js";
import {
  createFormFieldSchema,
  growthFormCreateSchema,
  reorderFieldsSchema,
  updateFormFieldSchema,
  updateFormSchema,
} from "./growth-validators.js";

function companyId(c) {
  return c.get("companyId") ?? null;
}

function handleError(c, error) {
  if (error instanceof FormsServiceError || error instanceof GrowthPropertyServiceError) {
    return c.json({ error: error.message, code: error.code }, error.status);
  }
  console.error("[runly.growth.forms]", error);
  return c.json({ error: "Error interno de formularios Growth." }, 500);
}

export function createGrowthFormRoutes({ formsService, growthPropertyService, requirePermission }) {
  const app = new Hono();

  app.get("/growth/forms", requirePermission("growth.forms.read"), async (c) => {
    const propertyId = c.req.query("propertyId");
    if (!propertyId) return c.json({ data: [] });
    try {
      const data = await formsService.listForms({ companyId: companyId(c), siteId: propertyId });
      return c.json({ data });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get("/growth/forms/assignees", requirePermission("growth.forms.read"), async (c) => {
    const data = await formsService.listFormAssignees({ companyId: companyId(c) });
    return c.json({ data });
  });

  app.post(
    "/growth/forms",
    requirePermission("growth.forms.create"),
    zValidator("json", growthFormCreateSchema),
    async (c) => {
      const { propertyId, ...data } = c.req.valid("json");
      try {
        await growthPropertyService.assertProperty({ companyId: companyId(c), propertyId });
        const form = await formsService.createForm({ companyId: companyId(c), siteId: propertyId, data });
        return c.json(form, 201);
      } catch (error) {
        return handleError(c, error);
      }
    },
  );

  app.get("/growth/forms/:id", requirePermission("growth.forms.read"), async (c) => {
    try {
      const form = await formsService.getForm({ companyId: companyId(c), formId: c.req.param("id") });
      return c.json(form);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.patch(
    "/growth/forms/:id",
    requirePermission("growth.forms.update"),
    zValidator("json", updateFormSchema),
    async (c) => {
      try {
        const form = await formsService.updateForm({
          companyId: companyId(c),
          formId: c.req.param("id"),
          data: c.req.valid("json"),
        });
        return c.json(form);
      } catch (error) {
        return handleError(c, error);
      }
    },
  );

  app.delete("/growth/forms/:id", requirePermission("growth.forms.delete"), async (c) => {
    try {
      await formsService.softDeleteForm({ companyId: companyId(c), formId: c.req.param("id") });
      return c.json({ success: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post(
    "/growth/forms/:id/fields",
    requirePermission("growth.forms.update"),
    zValidator("json", createFormFieldSchema),
    async (c) => {
      try {
        const field = await formsService.createFormField({
          companyId: companyId(c),
          formId: c.req.param("id"),
          data: c.req.valid("json"),
        });
        return c.json(field, 201);
      } catch (error) {
        return handleError(c, error);
      }
    },
  );

  app.post(
    "/growth/forms/:id/fields/reorder",
    requirePermission("growth.forms.update"),
    zValidator("json", reorderFieldsSchema),
    async (c) => {
      const { items } = c.req.valid("json");
      await formsService.reorderFormFields({ companyId: companyId(c), items });
      return c.json({ success: true });
    },
  );

  app.patch(
    "/growth/form-fields/:fieldId",
    requirePermission("growth.forms.update"),
    zValidator("json", updateFormFieldSchema),
    async (c) => {
      try {
        const field = await formsService.updateFormField({
          companyId: companyId(c),
          fieldId: c.req.param("fieldId"),
          data: c.req.valid("json"),
        });
        return c.json(field);
      } catch (error) {
        return handleError(c, error);
      }
    },
  );

  app.delete("/growth/form-fields/:fieldId", requirePermission("growth.forms.update"), async (c) => {
    try {
      await formsService.softDeleteFormField({ companyId: companyId(c), fieldId: c.req.param("fieldId") });
      return c.json({ success: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get("/growth/forms/:id/submissions", requirePermission("growth.forms.read"), async (c) => {
    const { page, pageSize } = c.req.query();
    try {
      const result = await formsService.listSubmissions({
        companyId: companyId(c),
        formId: c.req.param("id"),
        page: parseInt(page ?? "1", 10),
        pageSize: parseInt(pageSize ?? "20", 10),
      });
      return c.json(result);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.delete("/growth/forms/:id/submissions/:subId", requirePermission("growth.forms.delete"), async (c) => {
    try {
      await formsService.deleteSubmission({ companyId: companyId(c), submissionId: c.req.param("subId") });
      return c.json({ success: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  return app;
}
