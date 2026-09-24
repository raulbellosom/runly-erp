// apps/api/src/routes/fleet/__tests__/pdf-branding.test.js
//
// Guards the 2026 branding convergence: fleet PDFs and Excel exports must be
// authored by the real company, with "Runly ERP" only as a discreet watermark.
//   - report-pdf.js / vehicle-pdf.js must delegate to the shared
//     services/pdf-branding-service.js and keep no private branding resolver.
//   - Excel workbooks must set `creator` to the company name, not "Runly ERP".
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import ExcelJS from "exceljs";
import { resolveCompanyName } from "../../../services/pdf-branding-service.js";
import { buildVehiclesExcelBuffer } from "../fleet-export-service.js";

async function workbookMeta(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(buffer));
  return { creator: wb.creator, company: wb.company };
}

function readSibling(relPath) {
  return readFileSync(
    fileURLToPath(new URL(relPath, import.meta.url)),
    "utf8",
  );
}

describe("fleet PDF generators converge on the shared branding service", () => {
  for (const file of ["../report-pdf.js", "../vehicle-pdf.js"]) {
    const src = readSibling(file);

    it(`${file} imports the shared pdf-branding-service`, () => {
      assert.match(
        src,
        /from\s+["']\.\.\/\.\.\/services\/pdf-branding-service\.js["']/,
      );
    });

    it(`${file} does not define its own resolveCompanyBranding body`, () => {
      // The only allowed mention is a thin re-export/adapter, never a
      // "prisma.brandingConfig.findUnique" of its own logo pipeline.
      assert.doesNotMatch(
        src,
        /createSignedUrl\(/,
        `${file} must not re-implement Supabase logo loading`,
      );
    });

    it(`${file} never hardcodes "Generado por Runly ERP"`, () => {
      assert.doesNotMatch(src, /Generado por Runly ERP/);
    });
  }
});

describe("resolveCompanyName", () => {
  it("returns the company name when the row exists", async () => {
    const prisma = {
      company: { findUnique: async () => ({ name: "ACME S.A. de C.V." }) },
    };
    assert.equal(
      await resolveCompanyName({ prisma, companyId: "x" }),
      "ACME S.A. de C.V.",
    );
  });

  it("returns an empty string (never 'Runly ERP') when there is no company", async () => {
    const prisma = { company: { findUnique: async () => null } };
    assert.equal(await resolveCompanyName({ prisma, companyId: "x" }), "");
  });

  it("returns an empty string when companyId is missing", async () => {
    const prisma = {
      company: {
        findUnique: async () => {
          throw new Error("should not be called");
        },
      },
    };
    assert.equal(await resolveCompanyName({ prisma, companyId: null }), "");
  });
});

describe("Excel exports are authored by the company", () => {
  it("buildVehiclesExcelBuffer stamps the company name as workbook creator", async () => {
    const buffer = await buildVehiclesExcelBuffer({
      rows: [],
      companyName: "ACME S.A. de C.V.",
    });
    const meta = await workbookMeta(buffer);
    assert.equal(meta.creator, "ACME S.A. de C.V.");
    assert.equal(meta.company, "ACME S.A. de C.V.");
    assert.notEqual(meta.creator, "Runly ERP");
  });

  it("falls back to 'Runly ERP' only when no company name is provided", async () => {
    const buffer = await buildVehiclesExcelBuffer({ rows: [] });
    const meta = await workbookMeta(buffer);
    assert.equal(meta.creator, "Runly ERP");
  });
});
