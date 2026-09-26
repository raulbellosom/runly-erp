// apps/api/src/routes/hr-routes.js
//
// runly.hr: employees (CRUD, export, audit), departments, job titles, and
// the org chart. Extracted from index.js on 2026-09-25 to keep that file
// under the CLAUDE.md 1000-line limit, following the same createXxxRouter +
// mountWithAuth pattern already used for ledger/pfm/fleet/catalog/pos/
// calendar/company/contacts/etc. Mounted via mountWithAuth(), which applies
// authMiddleware globally — route handlers here never call it themselves.
import { Hono } from "hono";
import {
  hrCatalogCreateSchema,
  hrCatalogEnabledSchema,
  hrCatalogUpdateSchema,
  hrEmployeeCreateSchema,
  hrEmployeeEnabledSchema,
  hrEmployeeUpdateSchema,
} from "@runly/validators";
import { toLocalIso } from "@runly/core";
import { createHrService, HrServiceError } from "../services/hr-service.js";
import { buildEmployeesExcelBuffer } from "../services/hr-export-service.js";
import { buildAvatarUrlMapByFileIds } from "../lib/avatar-url-map.js";

export function createHrRouter({ prisma, supabaseAdmin, requirePermission }) {
  const app = new Hono();
  const hrService = createHrService({ prisma });

  app.get(
    "/hr/employees/export",
    requirePermission("hr.employee.read"),
    async (c) => {
      try {
        const authUserId = c.get("authUserId");
        const idsParam = c.req.query("ids");
        const ids = idsParam
          ? idsParam.split(",").map((s) => s.trim()).filter(Boolean)
          : null;
        const rows = await hrService.listEmployeesForExport({
          authUserId,
          companyId: c.get("companyId"),
          ids,
        });
        const buffer = await buildEmployeesExcelBuffer({ rows });
        c.header(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
        c.header(
          "Content-Disposition",
          `attachment; filename="colaboradores-${toLocalIso()}.xlsx"`,
        );
        return new Response(buffer, { status: 200, headers: c.res.headers });
      } catch (err) {
        if (err instanceof HrServiceError) {
          return c.json({ error: err.message }, err.status);
        }
        return c.json({ error: "No se pudo exportar los colaboradores." }, 500);
      }
    },
  );

  app.get(
    "/hr/employees/export/pdf",
    requirePermission("hr.employee.read"),
    async (c) => {
      try {
        const authUserId = c.get("authUserId");
        const idsParam = c.req.query("ids");
        const ids = idsParam
          ? idsParam.split(",").map((s) => s.trim()).filter(Boolean)
          : null;
        const rows = await hrService.listEmployeesForExport({
          authUserId,
          companyId: c.get("companyId"),
          ids,
        });
        const {
          resolveCompanyBranding, resolvePdfDocumentCtor,
          toSafeText, normalizeHexColor, lightenHex,
          drawPdfHeader, drawPdfFooter,
        } = await import("../services/pdf-branding-service.js");
        // requirePermission() already resolved and set companyId on the context —
        // querying Membership again with authUserId (the Supabase auth id, not a
        // Membership.userId, which is a userProfile.id) would always miss and
        // silently fall back to generic "Runly ERP" branding instead of the
        // real company's logo/name (same bug class as the ledger export fix).
        const companyId = c.get("companyId");
        const branding = await resolveCompanyBranding({ prisma, companyId: companyId ?? "" });
        const PDFDocument = await resolvePdfDocumentCtor();
        if (typeof PDFDocument !== "function") {
          return c.json({ error: "PDF no disponible." }, 503);
        }

        const brandColor = normalizeHexColor(branding.primaryColor, "#0F766E");
        const brandLight = lightenHex(brandColor, 0.9);
        const C_DARK = "#0F172A";
        const C_MID = "#334155";
        const C_MUTED = "#64748B";
        const C_BORDER = "#E2E8F0";
        const MARGIN = 44;

        const STATUS_LABELS = { active: "Activo", vacation: "Vacaciones", inactive: "Inactivo", terminated: "Baja" };
        const TYPE_LABELS = { full_time: "T. completo", part_time: "Medio tiempo", contractor: "Contratista", intern: "Practicante" };

        const doc = new PDFDocument({ margin: 0, size: "LETTER", layout: "portrait", bufferPages: true });
        const chunks = [];
        const done = new Promise((resolve, reject) => {
          doc.on("data", (chunk) => chunks.push(chunk));
          doc.on("end", () => resolve(Buffer.concat(chunks)));
          doc.on("error", reject);
        });

        const pageWidth = doc.page.width;
        const right = pageWidth - MARGIN;
        const contentWidth = right - MARGIN;
        const date = new Date().toLocaleDateString("es-MX");

        let y = drawPdfHeader(doc, {
          branding,
          title: "Directorio de Colaboradores",
          subtitle: `${rows.length} colaborador${rows.length !== 1 ? "es" : ""}`,
          folio: date,
        });

        const COL = { name: 150, code: 65, title: 110, dept: 100, status: 60, type: 75 };
        const headers = [
          { key: "full_name", label: "Nombre", w: COL.name },
          { key: "employee_code", label: "Codigo", w: COL.code },
          { key: "job_title", label: "Puesto", w: COL.title },
          { key: "department", label: "Depto.", w: COL.dept },
          { key: "status", label: "Estado", w: COL.status },
          { key: "employment_type", label: "Tipo", w: COL.type },
        ];

        const HEADER_ROW_H = 20;
        const ROW_H = 18;

        function drawTableHeader(doc, y) {
          doc.rect(MARGIN, y, contentWidth, HEADER_ROW_H).fill(brandColor);
          let cx = MARGIN + 6;
          for (const h of headers) {
            doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#FFFFFF")
              .text(h.label, cx, y + 6, { width: h.w - 8, lineBreak: false });
            cx += h.w;
          }
          return y + HEADER_ROW_H;
        }

        y = drawTableHeader(doc, y);

        for (let i = 0; i < rows.length; i++) {
          const emp = rows[i];
          if (y + ROW_H > doc.page.height - 44) {
            drawPdfFooter(doc, { branding, pageNumber: doc.bufferedPageRange().count, totalPages: 0 });
            doc.addPage();
            y = drawPdfHeader(doc, { branding, title: "Directorio de Colaboradores", subtitle: "Continuacion", folio: date });
            y = drawTableHeader(doc, y);
          }
          const rowBg = i % 2 === 0 ? "#FFFFFF" : brandLight;
          doc.rect(MARGIN, y, contentWidth, ROW_H).fill(rowBg);
          doc.lineWidth(0.3).rect(MARGIN, y, contentWidth, ROW_H).stroke(C_BORDER);

          const values = [
            toSafeText(emp.full_name ?? `${emp.first_name ?? ""} ${emp.last_name ?? ""}`.trim()),
            toSafeText(emp.employee_code),
            toSafeText(emp.job_title),
            toSafeText(emp.department),
            STATUS_LABELS[emp.status] ?? toSafeText(emp.status),
            TYPE_LABELS[emp.employment_type] ?? toSafeText(emp.employment_type),
          ];

          let cx = MARGIN + 6;
          for (let j = 0; j < headers.length; j++) {
            const color = j === 0 ? C_DARK : j === 4 ? brandColor : C_MID;
            const weight = j === 0 ? "Helvetica-Bold" : "Helvetica";
            doc.font(weight).fontSize(7.5).fillColor(color)
              .text(values[j], cx, y + 5, { width: headers[j].w - 10, lineBreak: false, ellipsis: true });
            cx += headers[j].w;
          }
          y += ROW_H;
        }

        if (rows.length === 0) {
          doc.font("Helvetica").fontSize(9).fillColor(C_MUTED)
            .text("No hay colaboradores para mostrar.", MARGIN, y + 12, { width: contentWidth, align: "center" });
        }

        const range = doc.bufferedPageRange();
        for (let p = range.start; p < range.start + range.count; p++) {
          doc.switchToPage(p);
          drawPdfFooter(doc, { branding, pageNumber: p - range.start + 1, totalPages: range.count });
        }

        doc.end();
        const buffer = await done;
        const filename = `colaboradores-${toLocalIso()}.pdf`;
        c.header("Content-Type", "application/pdf");
        c.header("Content-Disposition", `attachment; filename="${filename}"`);
        c.header("X-Atlas-Export-Count", String(rows.length));
        return new Response(buffer, { status: 200, headers: c.res.headers });
      } catch (err) {
        console.error("[hr/employees/export/pdf]", err);
        if (err instanceof HrServiceError) return c.json({ error: err.message }, err.status);
        return c.json({ error: "No se pudo generar el PDF." }, 500);
      }
    },
  );

  app.get(
    "/hr/employees",
    requirePermission("hr.employee.read"),
    async (c) => {
      try {
        const authUserId = c.get("authUserId");
        const search = c.req.query("search") ?? c.req.query("q") ?? "";
        const status = c.req.query("status");
        const enabledRaw = c.req.query("enabled");
        const enabled =
          enabledRaw === undefined ? undefined : enabledRaw === "true";
        const limit = c.req.query("limit");
        const page = c.req.query("page");
        const pageSize = c.req.query("pageSize");
        const sortBy = c.req.query("sortBy");
        const sortDir = c.req.query("sortDir") === "desc" ? "desc" : "asc";

        const result = await hrService.listEmployees({
          authUserId,
          companyId: c.get("companyId"),
          search,
          status,
          enabled,
          limit,
          page,
          pageSize,
          sortBy,
          sortDir,
        });

        if (page !== undefined || pageSize !== undefined) {
          const take = Math.min(Math.max(1, Number(pageSize) || 20), 200);
          const currentPage = Math.max(1, Number(page) || 1);
          return c.json({
            data: result.rows,
            pagination: {
              page: currentPage,
              pageSize: take,
              total: result.total,
            },
          });
        }
        return c.json({ data: result });
      } catch (err) {
        if (err instanceof HrServiceError) {
          return c.json({ error: err.message }, err.status);
        }
        console.error("[GET /hr/employees]", err);
        return c.json({ error: "No se pudieron cargar colaboradores." }, 500);
      }
    },
  );

  app.get(
    "/hr/employees/:id",
    requirePermission("hr.employee.read"),
    async (c) => {
      try {
        const authUserId = c.get("authUserId");
        const id = c.req.param("id");
        const row = await hrService.getEmployee({ authUserId, companyId: c.get("companyId"), id });
        return c.json({ data: row });
      } catch (err) {
        if (err instanceof HrServiceError) {
          return c.json({ error: err.message }, err.status);
        }
        return c.json({ error: "No se pudo cargar el colaborador." }, 500);
      }
    },
  );

  app.post(
    "/hr/employees",
    requirePermission("hr.employee.create"),
    async (c) => {
      try {
        const authUserId = c.get("authUserId");
        const parsed = hrEmployeeCreateSchema.safeParse(await c.req.json());
        if (!parsed.success) {
          return c.json(
            { error: parsed.error.errors?.[0]?.message ?? "Datos invalidos." },
            400,
          );
        }
        const row = await hrService.createEmployee({
          authUserId,
          companyId: c.get("companyId"),
          payload: parsed.data,
        });
        return c.json({ data: row }, 201);
      } catch (err) {
        if (err instanceof HrServiceError) {
          return c.json({ error: err.message }, err.status);
        }
        return c.json({ error: "No se pudo crear el colaborador." }, 500);
      }
    },
  );

  app.put(
    "/hr/employees/:id",
    requirePermission("hr.employee.update"),
    async (c) => {
      try {
        const authUserId = c.get("authUserId");
        const id = c.req.param("id");
        const parsed = hrEmployeeUpdateSchema.safeParse(await c.req.json());
        if (!parsed.success) {
          return c.json(
            { error: parsed.error.errors?.[0]?.message ?? "Datos invalidos." },
            400,
          );
        }
        const row = await hrService.updateEmployee({
          authUserId,
          companyId: c.get("companyId"),
          id,
          payload: parsed.data,
        });
        return c.json({ data: row });
      } catch (err) {
        if (err instanceof HrServiceError) {
          return c.json({ error: err.message }, err.status);
        }
        return c.json({ error: "No se pudo actualizar el colaborador." }, 500);
      }
    },
  );

  // PATCH alias — RunlyForm (the shared blueprint-driven form renderer) always
  // submits edits via PATCH, matching the convention already used by
  // PATCH /fleet/vehicles/:id and PATCH /inventory/items/:id. The PUT route
  // above is kept for any other caller.
  app.patch(
    "/hr/employees/:id",
    requirePermission("hr.employee.update"),
    async (c) => {
      try {
        const authUserId = c.get("authUserId");
        const id = c.req.param("id");
        const parsed = hrEmployeeUpdateSchema.safeParse(await c.req.json());
        if (!parsed.success) {
          return c.json(
            { error: parsed.error.errors?.[0]?.message ?? "Datos invalidos." },
            400,
          );
        }
        const row = await hrService.updateEmployee({
          authUserId,
          companyId: c.get("companyId"),
          id,
          payload: parsed.data,
        });
        return c.json({ data: row });
      } catch (err) {
        if (err instanceof HrServiceError) {
          return c.json({ error: err.message }, err.status);
        }
        return c.json({ error: "No se pudo actualizar el colaborador." }, 500);
      }
    },
  );

  app.patch(
    "/hr/employees/:id/enabled",
    requirePermission("hr.employee.delete"),
    async (c) => {
      try {
        const authUserId = c.get("authUserId");
        const id = c.req.param("id");
        const parsed = hrEmployeeEnabledSchema.safeParse(await c.req.json());
        if (!parsed.success) {
          return c.json({ error: "Estado invalido." }, 400);
        }
        const row = await hrService.setEmployeeEnabled({
          authUserId,
          companyId: c.get("companyId"),
          id,
          enabled: parsed.data.enabled,
        });
        return c.json({ data: row });
      } catch (err) {
        if (err instanceof HrServiceError) {
          return c.json({ error: err.message }, err.status);
        }
        return c.json({ error: "No se pudo actualizar el estado." }, 500);
      }
    },
  );

  app.get(
    "/hr/employees/:id/audit",
    requirePermission("hr.employee.read"),
    async (c) => {
      try {
        const authUserId = c.get("authUserId");
        const id = c.req.param("id");
        const limit = c.req.query("limit");
        const rows = await hrService.getEmployeeAudit({
          authUserId,
          companyId: c.get("companyId"),
          id,
          limit,
        });
        return c.json({ data: rows });
      } catch (err) {
        if (err instanceof HrServiceError) {
          return c.json({ error: err.message }, err.status);
        }
        return c.json({ error: "No se pudo cargar el historial." }, 500);
      }
    },
  );

  app.get(
    "/hr/departments",
    requirePermission("hr.department.read"),
    async (c) => {
      try {
        const authUserId = c.get("authUserId");
        const q = c.req.query("q") ?? "";
        const enabledRaw = c.req.query("enabled");
        const enabled =
          enabledRaw === undefined ? undefined : enabledRaw === "true";
        const limit = c.req.query("limit");
        const rows = await hrService.listDepartments({
          authUserId,
          companyId: c.get("companyId"),
          search: q,
          enabled,
          limit,
        });
        return c.json({ data: rows });
      } catch (err) {
        if (err instanceof HrServiceError) {
          return c.json({ error: err.message }, err.status);
        }
        return c.json({ error: "No se pudieron cargar los departamentos." }, 500);
      }
    },
  );

  app.post(
    "/hr/departments",
    requirePermission("hr.department.create"),
    async (c) => {
      try {
        const authUserId = c.get("authUserId");
        const parsed = hrCatalogCreateSchema.safeParse(await c.req.json());
        if (!parsed.success) {
          return c.json(
            { error: parsed.error.errors?.[0]?.message ?? "Datos inválidos." },
            400,
          );
        }
        const row = await hrService.createDepartment({
          authUserId,
          companyId: c.get("companyId"),
          payload: parsed.data,
        });
        return c.json({ data: row }, 201);
      } catch (err) {
        if (err instanceof HrServiceError) {
          return c.json({ error: err.message }, err.status);
        }
        return c.json({ error: "No se pudo crear el departamento." }, 500);
      }
    },
  );

  app.put(
    "/hr/departments/:id",
    requirePermission("hr.department.update"),
    async (c) => {
      try {
        const authUserId = c.get("authUserId");
        const id = c.req.param("id");
        const parsed = hrCatalogUpdateSchema.safeParse(await c.req.json());
        if (!parsed.success) {
          return c.json(
            { error: parsed.error.errors?.[0]?.message ?? "Datos inválidos." },
            400,
          );
        }
        const row = await hrService.updateDepartment({
          authUserId,
          companyId: c.get("companyId"),
          id,
          payload: parsed.data,
        });
        return c.json({ data: row });
      } catch (err) {
        if (err instanceof HrServiceError) {
          return c.json({ error: err.message }, err.status);
        }
        return c.json({ error: "No se pudo actualizar el departamento." }, 500);
      }
    },
  );

  app.patch(
    "/hr/departments/:id/enabled",
    requirePermission("hr.department.delete"),
    async (c) => {
      try {
        const authUserId = c.get("authUserId");
        const id = c.req.param("id");
        const parsed = hrCatalogEnabledSchema.safeParse(await c.req.json());
        if (!parsed.success) {
          return c.json({ error: "Estado inválido." }, 400);
        }
        const row = await hrService.setDepartmentEnabled({
          authUserId,
          companyId: c.get("companyId"),
          id,
          enabled: parsed.data.enabled,
        });
        return c.json({ data: row });
      } catch (err) {
        if (err instanceof HrServiceError) {
          return c.json({ error: err.message }, err.status);
        }
        return c.json(
          { error: "No se pudo actualizar el estado del departamento." },
          500,
        );
      }
    },
  );

  app.get(
    "/hr/job-titles",
    requirePermission("hr.job_title.read"),
    async (c) => {
      try {
        const authUserId = c.get("authUserId");
        const q = c.req.query("q") ?? "";
        const enabledRaw = c.req.query("enabled");
        const enabled =
          enabledRaw === undefined ? undefined : enabledRaw === "true";
        const limit = c.req.query("limit");
        const rows = await hrService.listJobTitles({
          authUserId,
          companyId: c.get("companyId"),
          search: q,
          enabled,
          limit,
        });
        return c.json({ data: rows });
      } catch (err) {
        if (err instanceof HrServiceError) {
          return c.json({ error: err.message }, err.status);
        }
        return c.json({ error: "No se pudieron cargar los puestos." }, 500);
      }
    },
  );

  app.post(
    "/hr/job-titles",
    requirePermission("hr.job_title.create"),
    async (c) => {
      try {
        const authUserId = c.get("authUserId");
        const parsed = hrCatalogCreateSchema.safeParse(await c.req.json());
        if (!parsed.success) {
          return c.json(
            { error: parsed.error.errors?.[0]?.message ?? "Datos inválidos." },
            400,
          );
        }
        const row = await hrService.createJobTitle({
          authUserId,
          companyId: c.get("companyId"),
          payload: parsed.data,
        });
        return c.json({ data: row }, 201);
      } catch (err) {
        if (err instanceof HrServiceError) {
          return c.json({ error: err.message }, err.status);
        }
        return c.json({ error: "No se pudo crear el puesto." }, 500);
      }
    },
  );

  app.put(
    "/hr/job-titles/:id",
    requirePermission("hr.job_title.update"),
    async (c) => {
      try {
        const authUserId = c.get("authUserId");
        const id = c.req.param("id");
        const parsed = hrCatalogUpdateSchema.safeParse(await c.req.json());
        if (!parsed.success) {
          return c.json(
            { error: parsed.error.errors?.[0]?.message ?? "Datos inválidos." },
            400,
          );
        }
        const row = await hrService.updateJobTitle({
          authUserId,
          companyId: c.get("companyId"),
          id,
          payload: parsed.data,
        });
        return c.json({ data: row });
      } catch (err) {
        if (err instanceof HrServiceError) {
          return c.json({ error: err.message }, err.status);
        }
        return c.json({ error: "No se pudo actualizar el puesto." }, 500);
      }
    },
  );

  app.patch(
    "/hr/job-titles/:id/enabled",
    requirePermission("hr.job_title.delete"),
    async (c) => {
      try {
        const authUserId = c.get("authUserId");
        const id = c.req.param("id");
        const parsed = hrCatalogEnabledSchema.safeParse(await c.req.json());
        if (!parsed.success) {
          return c.json({ error: "Estado inválido." }, 400);
        }
        const row = await hrService.setJobTitleEnabled({
          authUserId,
          companyId: c.get("companyId"),
          id,
          enabled: parsed.data.enabled,
        });
        return c.json({ data: row });
      } catch (err) {
        if (err instanceof HrServiceError) {
          return c.json({ error: err.message }, err.status);
        }
        return c.json(
          { error: "No se pudo actualizar el estado del puesto." },
          500,
        );
      }
    },
  );

  app.get(
    "/hr/org-chart",
    requirePermission("hr.org_chart.read"),
    async (c) => {
      try {
        const authUserId = c.get("authUserId");
        const rootEmployeeId = c.req.query("rootEmployeeId") ?? null;
        const enabledRaw = c.req.query("enabled");
        const enabled = enabledRaw === undefined ? true : enabledRaw === "true";
        const chart = await hrService.getOrgChart({
          authUserId,
          companyId: c.get("companyId"),
          rootEmployeeId,
          enabled,
        });

        // Batch-collect all avatarFileIds from the tree, load in one query, then assign.
        function collectNodes(node, out = []) {
          out.push(node);
          if (Array.isArray(node.children))
            node.children.forEach((c) => collectNodes(c, out));
          return out;
        }
        const allNodes = (chart.roots ?? []).flatMap((r) => collectNodes(r));
        const orgAvatarFileIds = allNodes
          .map((n) => n.linkedUser?.avatarFileId)
          .filter(Boolean);
        const orgAvatarUrlMap = await buildAvatarUrlMapByFileIds(
          orgAvatarFileIds,
          "card",
          { prisma, supabaseAdmin },
        );
        for (const node of allNodes) {
          if (node.linkedUser?.avatarFileId) {
            node.linkedUser.avatarUrl =
              orgAvatarUrlMap.get(node.linkedUser.avatarFileId) ?? null;
          }
        }

        // Batch-load profileImageFileId signed URLs — avoids N per-node frontend requests.
        const orgProfileFileIds = allNodes
          .map((n) => n.profileImageFileId)
          .filter(Boolean);
        const orgProfileUrlMap = await buildAvatarUrlMapByFileIds(
          orgProfileFileIds,
          "card",
          { prisma, supabaseAdmin },
        );
        for (const node of allNodes) {
          if (node.profileImageFileId) {
            node.profileImageUrl =
              orgProfileUrlMap.get(node.profileImageFileId) ?? null;
          }
        }

        return c.json({ data: chart });
      } catch (err) {
        if (err instanceof HrServiceError) {
          return c.json({ error: err.message }, err.status);
        }
        return c.json({ error: "No se pudo cargar el organigrama." }, 500);
      }
    },
  );

  app.get(
    "/hr/user-options",
    requirePermission("hr.employee.read"),
    async (c) => {
      try {
        const authUserId = c.get("authUserId");
        const q = c.req.query("q") ?? "";
        const limit = c.req.query("limit");
        const rows = await hrService.listUserOptions({
          authUserId,
          companyId: c.get("companyId"),
          search: q,
          limit,
        });
        return c.json({ data: rows });
      } catch (err) {
        if (err instanceof HrServiceError) {
          return c.json({ error: err.message }, err.status);
        }
        return c.json(
          { error: "No se pudieron cargar las cuentas disponibles." },
          500,
        );
      }
    },
  );

  return app;
}
