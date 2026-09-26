// apps/api/src/routes/contacts-routes.js
//
// runly.contacts CRUD + picker + bulk actions + Excel/PDF export. Extracted
// from index.js on 2026-09-25 to keep that file under the CLAUDE.md
// 1000-line limit, following the same createXxxRouter + mountWithAuth
// pattern already used for ledger/pfm/fleet/catalog/pos/calendar/company/etc.
// Mounted via mountWithAuth(), which applies authMiddleware globally — route
// handlers here never call it themselves (same convention as
// calendar-routes.js/company-routes.js).
import { Hono } from "hono";
import ExcelJS from "exceljs";
import { formatLocalDateTime, toLocalIso } from "@runly/core";
import { createContactsService, ContactsServiceError } from "../services/contacts-service.js";
import { publishActivityFromContext, getActivityContext } from "../services/activity-publisher.js";

export function createContactsRouter({ prisma, requirePermission }) {
  const app = new Hono();
  const contactsService = createContactsService({ prisma });

  app.get(
    "/contacts",
    requirePermission("contacts.contacts.read"),
    async (c) => {
      try {
        const authUserId = c.get("authUserId");
        const search = c.req.query("search") ?? c.req.query("q") ?? "";
        const page = c.req.query("page") ?? "1";
        const pageSize = c.req.query("pageSize") ?? c.req.query("limit") ?? "20";
        const sortBy = c.req.query("sortBy") ?? "";
        const sortDir = c.req.query("sortDir") ?? "asc";
        const enabledRaw = c.req.query("enabled");
        const enabled = enabledRaw === "false" ? false : true;
        const result = await contactsService.list({
          authUserId,
          companyId: c.get("companyId"),
          search,
          page,
          pageSize,
          sortBy,
          sortDir,
          enabled,
        });
        return c.json({
          data: result.rows,
          pagination: {
            page: result.page,
            pageSize: result.pageSize,
            total: result.total,
          },
        });
      } catch (err) {
        if (err instanceof ContactsServiceError) {
          return c.json({ error: err.message }, err.status);
        }
        return c.json({ error: "No se pudieron cargar los contactos." }, 500);
      }
    },
  );

  app.get(
    "/contacts/picker",
    requirePermission("contacts.contacts.read"),
    async (c) => {
      try {
        const authUserId = c.get("authUserId");
        const query = c.req.query("q") ?? "";
        const limit = c.req.query("limit");
        const options = await contactsService.picker({
          authUserId,
          companyId: c.get("companyId"),
          query,
          limit,
        });
        return c.json({ data: options });
      } catch (err) {
        if (err instanceof ContactsServiceError) {
          return c.json({ error: err.message }, err.status);
        }
        return c.json(
          { error: "No se pudieron cargar opciones de contacto." },
          500,
        );
      }
    },
  );

  app.post(
    "/contacts",
    requirePermission("contacts.contacts.create"),
    async (c) => {
      try {
        const authUserId = c.get("authUserId");
        const payload = await c.req.json();
        const contact = await contactsService.create({ authUserId, companyId: c.get("companyId"), payload });
        const { actorName } = getActivityContext(c);
        await publishActivityFromContext(prisma, c, {
          type: "contacts.contact.create",
          severity: "success",
          entityType: "Contact",
          entityId: contact.id,
          summary: `${actorName} creó el contacto "${contact.name ?? ""}"`.trim(),
        });
        return c.json({ data: contact }, 201);
      } catch (err) {
        if (err?.name === "ZodError") {
          return c.json(
            { error: err.errors?.[0]?.message ?? "Datos de contacto invalidos." },
            400,
          );
        }
        if (err instanceof ContactsServiceError) {
          return c.json({ error: err.message }, err.status);
        }
        return c.json({ error: "No se pudo crear el contacto." }, 500);
      }
    },
  );

  app.patch(
    "/contacts/bulk/enabled",
    requirePermission("contacts.contacts.update"),
    async (c) => {
      try {
        const authUserId = c.get("authUserId");
        const { ids, enabled } = await c.req.json();
        await contactsService.bulkSetEnabled({ authUserId, companyId: c.get("companyId"), ids, enabled });
        const { actorName } = getActivityContext(c);
        await publishActivityFromContext(prisma, c, {
          type: enabled
            ? "contacts.contact.bulk_enable"
            : "contacts.contact.bulk_disable",
          severity: enabled ? "info" : "warning",
          entityType: "Contact",
          summary: `${actorName} ${enabled ? "habilitó" : "deshabilitó"} ${Array.isArray(ids) ? ids.length : 0} contacto(s)`,
        });
        return c.json({ ok: true });
      } catch (err) {
        if (err instanceof ContactsServiceError) {
          return c.json({ error: err.message }, err.status);
        }
        return c.json(
          { error: "No se pudo actualizar el estado de los contactos." },
          500,
        );
      }
    },
  );

  app.delete(
    "/contacts/bulk",
    requirePermission("contacts.contacts.delete"),
    async (c) => {
      try {
        const authUserId = c.get("authUserId");
        const { ids } = await c.req.json();
        await contactsService.bulkDelete({ authUserId, companyId: c.get("companyId"), ids });
        const { actorName } = getActivityContext(c);
        await publishActivityFromContext(prisma, c, {
          type: "contacts.contact.bulk_delete",
          severity: "warning",
          entityType: "Contact",
          summary: `${actorName} eliminó ${Array.isArray(ids) ? ids.length : 0} contacto(s)`,
        });
        return c.json({ ok: true });
      } catch (err) {
        if (err instanceof ContactsServiceError) {
          return c.json({ error: err.message }, err.status);
        }
        return c.json({ error: "No se pudieron eliminar los contactos." }, 500);
      }
    },
  );

  app.post(
    "/contacts/export/excel",
    requirePermission("contacts.contacts.read"),
    async (c) => {
      try {
        const authUserId = c.get("authUserId");
        const body = await c.req.json().catch(() => ({}));
        const ids = Array.isArray(body?.ids) ? body.ids.filter(Boolean) : [];
        const contacts = await contactsService.getContactsForExport({
          authUserId,
          companyId: c.get("companyId"),
          ids,
        });

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet("Contactos");
        sheet.columns = [
          { header: "ID", key: "id", width: 40 },
          { header: "Nombre", key: "name", width: 30 },
          { header: "Razon social", key: "legalName", width: 36 },
          { header: "Tipo", key: "type", width: 16 },
          { header: "Correo", key: "email", width: 32 },
          { header: "Telefono", key: "phone", width: 18 },
          { header: "RFC / ID fiscal", key: "taxId", width: 20 },
          { header: "Estado", key: "enabled", width: 12 },
          { header: "Creado", key: "createdAt", width: 22 },
        ];
        sheet.getRow(1).font = { bold: true };

        for (const contact of contacts) {
          sheet.addRow({
            id: contact.id,
            name: contact.name ?? "",
            legalName: contact.legalName ?? "",
            type: contact.type ?? "",
            email: contact.email ?? "",
            phone: contact.phone ?? "",
            taxId: contact.taxId ?? "",
            enabled: contact.enabled ? "Activo" : "Inactivo",
            createdAt: contact.createdAt
              ? formatLocalDateTime(contact.createdAt)
              : "",
          });
        }

        const buffer = await workbook.xlsx.writeBuffer();
        const filename = `contactos-${toLocalIso()}.xlsx`;
        c.header(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
        c.header("Content-Disposition", `attachment; filename="${filename}"`);
        c.header("X-Atlas-Export-Count", String(contacts.length));
        return c.body(buffer);
      } catch {
        return c.json({ error: "No se pudo generar el archivo Excel." }, 500);
      }
    },
  );

  app.post(
    "/contacts/export/pdf",
    requirePermission("contacts.contacts.read"),
    async (c) => {
      try {
        const authUserId = c.get("authUserId");
        const body = await c.req.json().catch(() => ({}));
        const ids = Array.isArray(body?.ids) ? body.ids.filter(Boolean) : [];
        const contacts = await contactsService.getContactsForExport({ authUserId, companyId: c.get("companyId"), ids });
        const { resolveCompanyBranding, resolvePdfDocumentCtor, toSafeText, normalizeHexColor, lightenHex, drawPdfHeader, drawPdfFooter } =
          await import("../services/pdf-branding-service.js");
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
        const brandColorLight = lightenHex(brandColor, 0.9);
        const C_DARK = "#0F172A";
        const C_MID = "#334155";
        const C_MUTED = "#64748B";
        const C_BORDER = "#E2E8F0";
        const MARGIN = 44;
        const TYPE_LABELS = { customer: "Cliente", supplier: "Proveedor", person: "Persona", company: "Empresa" };

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
          title: "Directorio de Contactos",
          subtitle: `${contacts.length} contacto${contacts.length !== 1 ? "s" : ""}`,
          folio: date,
        });

        const COL_WIDTHS = { name: 160, type: 70, email: 140, phone: 90, taxId: 90 };
        const headers = [
          { key: "name", label: "Nombre", w: COL_WIDTHS.name },
          { key: "type", label: "Tipo", w: COL_WIDTHS.type },
          { key: "email", label: "Correo", w: COL_WIDTHS.email },
          { key: "phone", label: "Telefono", w: COL_WIDTHS.phone },
          { key: "taxId", label: "RFC / ID fiscal", w: COL_WIDTHS.taxId },
        ];

        // Table header row
        const ROW_H = 18;
        const HEADER_ROW_H = 20;
        doc.rect(MARGIN, y, contentWidth, HEADER_ROW_H).fill(brandColor);
        let cx = MARGIN + 6;
        for (const h of headers) {
          doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#FFFFFF")
            .text(h.label, cx, y + 6, { width: h.w - 8, lineBreak: false });
          cx += h.w;
        }
        y += HEADER_ROW_H;

        // Table rows
        for (let i = 0; i < contacts.length; i++) {
          const ct = contacts[i];
          const rowBg = i % 2 === 0 ? "#FFFFFF" : brandColorLight;

          if (y + ROW_H > doc.page.height - 44) {
            drawPdfFooter(doc, { branding, pageNumber: doc.bufferedPageRange().count, totalPages: 0 });
            doc.addPage();
            y = drawPdfHeader(doc, { branding, title: "Directorio de Contactos", subtitle: `Continuacion`, folio: date });
            doc.rect(MARGIN, y, contentWidth, HEADER_ROW_H).fill(brandColor);
            let cx2 = MARGIN + 6;
            for (const h of headers) {
              doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#FFFFFF")
                .text(h.label, cx2, y + 6, { width: h.w - 8, lineBreak: false });
              cx2 += h.w;
            }
            y += HEADER_ROW_H;
          }

          doc.rect(MARGIN, y, contentWidth, ROW_H).fill(rowBg);
          doc.lineWidth(0.3).rect(MARGIN, y, contentWidth, ROW_H).stroke(C_BORDER);

          const values = [
            toSafeText(ct.name),
            TYPE_LABELS[ct.type] ?? toSafeText(ct.type),
            toSafeText(ct.email),
            toSafeText(ct.phone),
            toSafeText(ct.taxId),
          ];

          cx = MARGIN + 6;
          for (let j = 0; j < headers.length; j++) {
            const color = j === 0 ? C_DARK : C_MID;
            const weight = j === 0 ? "Helvetica-Bold" : "Helvetica";
            doc.font(weight).fontSize(7.5).fillColor(color)
              .text(values[j], cx, y + 5, { width: headers[j].w - 10, lineBreak: false, ellipsis: true });
            cx += headers[j].w;
          }
          y += ROW_H;
        }

        if (contacts.length === 0) {
          doc.font("Helvetica").fontSize(9).fillColor(C_MUTED)
            .text("No hay contactos para mostrar.", MARGIN, y + 12, { width: contentWidth, align: "center" });
        }

        const totalPages = doc.bufferedPageRange().count;
        const range = doc.bufferedPageRange();
        for (let p = range.start; p < range.start + range.count; p++) {
          doc.switchToPage(p);
          drawPdfFooter(doc, { branding, pageNumber: p - range.start + 1, totalPages });
        }

        doc.end();
        const buffer = await done;
        const filename = `contactos-${toLocalIso()}.pdf`;
        c.header("Content-Type", "application/pdf");
        c.header("Content-Disposition", `attachment; filename="${filename}"`);
        c.header("X-Atlas-Export-Count", String(contacts.length));
        return c.body(buffer);
      } catch (err) {
        console.error("[contacts/export/pdf]", err);
        return c.json({ error: "No se pudo generar el PDF." }, 500);
      }
    },
  );

  app.get(
    "/contacts/:id",
    requirePermission("contacts.contacts.read"),
    async (c) => {
      try {
        const authUserId = c.get("authUserId");
        const id = c.req.param("id");
        const contact = await contactsService.getById({ authUserId, companyId: c.get("companyId"), id });
        return c.json({ data: contact });
      } catch (err) {
        if (err instanceof ContactsServiceError) {
          return c.json({ error: err.message }, err.status);
        }
        return c.json({ error: "No se pudo cargar el contacto." }, 500);
      }
    },
  );

  app.put(
    "/contacts/:id",
    requirePermission("contacts.contacts.update"),
    async (c) => {
      try {
        const authUserId = c.get("authUserId");
        const id = c.req.param("id");
        const payload = await c.req.json();
        const contact = await contactsService.update({ authUserId, companyId: c.get("companyId"), id, payload });
        const { actorName } = getActivityContext(c);
        await publishActivityFromContext(prisma, c, {
          type: "contacts.contact.update",
          severity: "info",
          entityType: "Contact",
          entityId: id,
          summary:
            `${actorName} actualizó el contacto "${contact.name ?? ""}"`.trim(),
        });
        return c.json({ data: contact });
      } catch (err) {
        if (err?.name === "ZodError") {
          return c.json(
            { error: err.errors?.[0]?.message ?? "Datos de contacto invalidos." },
            400,
          );
        }
        if (err instanceof ContactsServiceError) {
          return c.json({ error: err.message }, err.status);
        }
        return c.json({ error: "No se pudo actualizar el contacto." }, 500);
      }
    },
  );

  app.patch(
    "/contacts/:id/enabled",
    requirePermission("contacts.contacts.update"),
    async (c) => {
      try {
        const authUserId = c.get("authUserId");
        const id = c.req.param("id");
        const { enabled } = await c.req.json();
        const contact = await contactsService.setEnabled({
          authUserId,
          companyId: c.get("companyId"),
          id,
          enabled,
        });
        const { actorName } = getActivityContext(c);
        await publishActivityFromContext(prisma, c, {
          type: contact.enabled
            ? "contacts.contact.enable"
            : "contacts.contact.disable",
          severity: contact.enabled ? "info" : "warning",
          entityType: "Contact",
          entityId: id,
          summary:
            `${actorName} ${contact.enabled ? "habilitó" : "deshabilitó"} el contacto "${contact.name ?? ""}"`.trim(),
        });
        return c.json({ data: contact });
      } catch (err) {
        if (err instanceof ContactsServiceError) {
          return c.json({ error: err.message }, err.status);
        }
        return c.json(
          { error: "No se pudo actualizar el estado del contacto." },
          500,
        );
      }
    },
  );

  app.delete(
    "/contacts/:id",
    requirePermission("contacts.contacts.delete"),
    async (c) => {
      try {
        const authUserId = c.get("authUserId");
        const id = c.req.param("id");
        await contactsService.delete({ authUserId, companyId: c.get("companyId"), id });
        const { actorName } = getActivityContext(c);
        await publishActivityFromContext(prisma, c, {
          type: "contacts.contact.delete",
          severity: "warning",
          entityType: "Contact",
          entityId: id,
          summary: `${actorName} eliminó un contacto`,
        });
        return c.json({ ok: true });
      } catch (err) {
        if (err instanceof ContactsServiceError) {
          return c.json({ error: err.message }, err.status);
        }
        return c.json({ error: "No se pudo eliminar el contacto." }, 500);
      }
    },
  );

  return app;
}
