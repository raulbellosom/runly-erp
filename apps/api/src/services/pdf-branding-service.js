import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const apiPackageRequire = createRequire(
  new URL("../../../../apps/api/package.json", import.meta.url),
);

let pdfDocumentCtorPromise = null;
let supabaseCreateClientPromise = null;
let supabaseAdminClientPromise = null;
let sharpFactoryPromise = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function toSafeText(value, fallback = "-") {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : fallback;
}

export function compact(values = []) {
  return values.map((item) => String(item ?? "").trim()).filter(Boolean);
}

export function normalizeHexColor(color, fallback = "#0F766E") {
  const raw = String(color ?? "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw.toUpperCase() : fallback;
}

export function lightenHex(hex, t = 0.88) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lr = Math.round(r + (255 - r) * t).toString(16).padStart(2, "0");
  const lg = Math.round(g + (255 - g) * t).toString(16).padStart(2, "0");
  const lb = Math.round(b + (255 - b) * t).toString(16).padStart(2, "0");
  return `#${lr}${lg}${lb}`.toUpperCase();
}

export function formatDateEs(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("es-MX");
}

// ─── PDFKit loader ─────────────────────────────────────────────────────────────

export async function resolvePdfDocumentCtor() {
  if (!pdfDocumentCtorPromise) {
    pdfDocumentCtorPromise = (async () => {
      try {
        const moduleNs = await import("pdfkit");
        const fn = moduleNs?.default ?? moduleNs?.PDFDocument ?? null;
        if (typeof fn === "function") return fn;
      } catch {}
      try {
        const resolvedPath = apiPackageRequire.resolve("pdfkit");
        const moduleNs = await import(pathToFileURL(resolvedPath).href);
        const fn = moduleNs?.default ?? moduleNs?.PDFDocument ?? null;
        if (typeof fn === "function") return fn;
      } catch {}
      try {
        const required = apiPackageRequire("pdfkit");
        return required?.default ?? required?.PDFDocument ?? required ?? null;
      } catch {}
      return null;
    })();
  }
  return pdfDocumentCtorPromise;
}

// ─── Logo loading (Supabase Storage + sharp normalization) ─────────────────────

async function resolveSupabaseCreateClient() {
  if (!supabaseCreateClientPromise) {
    supabaseCreateClientPromise = (async () => {
      try {
        const moduleNs = await import("@supabase/supabase-js");
        const fn = moduleNs?.createClient ?? moduleNs?.default?.createClient ?? null;
        if (typeof fn === "function") return fn;
      } catch {}
      try {
        const resolvedPath = apiPackageRequire.resolve("@supabase/supabase-js");
        const moduleNs = await import(pathToFileURL(resolvedPath).href);
        const fn = moduleNs?.createClient ?? moduleNs?.default?.createClient ?? null;
        if (typeof fn === "function") return fn;
      } catch {}
      try {
        const required = apiPackageRequire("@supabase/supabase-js");
        const fn = required?.createClient ?? required?.default?.createClient ?? null;
        if (typeof fn === "function") return fn;
      } catch {}
      return null;
    })();
  }
  return supabaseCreateClientPromise;
}

async function resolveSupabaseAdminClient() {
  if (!supabaseAdminClientPromise) {
    supabaseAdminClientPromise = (async () => {
      const createClient = await resolveSupabaseCreateClient();
      const supabaseUrl = String(process.env.SUPABASE_URL ?? "").trim();
      const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
      if (!createClient || !supabaseUrl || !serviceRoleKey) return null;
      try {
        return createClient(supabaseUrl, serviceRoleKey);
      } catch {
        return null;
      }
    })();
  }
  return supabaseAdminClientPromise;
}

function isPngBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) return false;
  return (
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  );
}

function isJpegBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return false;
  return (
    buffer[0] === 0xff && buffer[1] === 0xd8 &&
    buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9
  );
}

function hasExtension(fileName, ext) {
  return String(fileName ?? "").toLowerCase().endsWith(ext);
}

function supportsPdfkitImage({ mimeType, originalName, buffer }) {
  const mime = String(mimeType ?? "").toLowerCase();
  if (mime === "image/png" || mime === "image/jpeg" || mime === "image/jpg") return true;
  if (
    hasExtension(originalName, ".png") ||
    hasExtension(originalName, ".jpg") ||
    hasExtension(originalName, ".jpeg")
  ) return true;
  return isPngBuffer(buffer) || isJpegBuffer(buffer);
}

async function resolveSharpFactory() {
  if (!sharpFactoryPromise) {
    sharpFactoryPromise = (async () => {
      try {
        const moduleNs = await import("sharp");
        const fn = moduleNs?.default ?? moduleNs?.sharp ?? null;
        if (typeof fn === "function") return fn;
      } catch {}
      try {
        const resolvedPath = apiPackageRequire.resolve("sharp");
        const moduleNs = await import(pathToFileURL(resolvedPath).href);
        const fn = moduleNs?.default ?? moduleNs?.sharp ?? null;
        if (typeof fn === "function") return fn;
      } catch {}
      try {
        const required = apiPackageRequire("sharp");
        const fn = required?.default ?? required?.sharp ?? required ?? null;
        if (typeof fn === "function") return fn;
      } catch {}
      return null;
    })();
  }
  return sharpFactoryPromise;
}

async function normalizeLogoBufferForPdf({ buffer, mimeType, originalName }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null;
  if (supportsPdfkitImage({ mimeType, originalName, buffer })) return buffer;

  const sharp = await resolveSharpFactory();
  if (!sharp) return null;
  try {
    const converted = await sharp(buffer).png({ compressionLevel: 9 }).toBuffer();
    if (isPngBuffer(converted)) return converted;
  } catch {}
  return null;
}

async function loadCompanyLogoBuffer({ prisma, logoFileId }) {
  if (!logoFileId) return null;
  const fileAsset = await prisma.fileAsset
    .findFirst({
      where: { id: logoFileId, enabled: true },
      select: { bucket: true, objectKey: true, mimeType: true, originalName: true },
    })
    .catch(() => null);
  if (!fileAsset?.bucket || !fileAsset?.objectKey) return null;

  const supabaseAdmin = await resolveSupabaseAdminClient();
  if (!supabaseAdmin?.storage?.from) return null;
  try {
    const { data, error: signErr } = await supabaseAdmin.storage
      .from(fileAsset.bucket)
      .createSignedUrl(fileAsset.objectKey, 1800);
    if (signErr || !data?.signedUrl) return null;
    const response = await fetch(data.signedUrl);
    if (!response.ok) return null;
    const rawBuffer = Buffer.from(await response.arrayBuffer());
    return await normalizeLogoBufferForPdf({
      buffer: rawBuffer,
      mimeType: fileAsset.mimeType || response.headers.get("content-type"),
      originalName: fileAsset.originalName,
    });
  } catch {
    return null;
  }
}

// ─── Lightweight company-name resolver ────────────────────────────────────────
// For contexts (Excel exports, filenames) that only need the display name and
// must not pay the cost of loading the logo from storage.

export async function resolveCompanyName({ prisma, companyId }) {
  if (!companyId) return "";
  const company = await prisma.company
    .findUnique({ where: { id: companyId }, select: { name: true } })
    .catch(() => null);
  return toSafeText(company?.name, "");
}

// ─── Company branding resolver ─────────────────────────────────────────────────
// Returns: { companyName, taxId, rfc, phone, email, website, addressLines,
//            primaryColor, logoBuffer }

export async function resolveCompanyBranding({ prisma, companyId }) {
  const [company, brandingConfig] = await Promise.all([
    prisma.company.findUnique({ where: { id: companyId } }).catch(() => null),
    prisma.brandingConfig.findUnique({ where: { companyId } }).catch(() => null),
  ]);

  const streetLine = compact([
    company?.street,
    company?.extNumber ? `No. ${company.extNumber}` : "",
    company?.intNumber ? `Int. ${company.intNumber}` : "",
  ]).join(", ");
  const cityLine = compact([
    company?.colony ? `Col. ${company.colony}` : "",
    company?.city,
    company?.state,
    company?.country,
  ]).join(", ");
  const postalLine = company?.postalCode ? `CP ${String(company.postalCode).trim()}` : "";
  const addressLines = compact([streetLine, compact([cityLine, postalLine]).join(" ")]);

  const taxId = toSafeText(company?.rfc);
  const logoBuffer = await loadCompanyLogoBuffer({
    prisma,
    logoFileId: brandingConfig?.logoFileId ?? null,
  }).catch(() => null);

  return {
    companyName: toSafeText(company?.name, "Runly ERP"),
    legalName: toSafeText(company?.legalName, ""),
    taxId,
    rfc: taxId,
    phone: toSafeText(company?.phone),
    email: toSafeText(company?.contactEmail),
    website: toSafeText(company?.website),
    addressLines,
    primaryColor: normalizeHexColor(brandingConfig?.primaryColor, "#0F766E"),
    logoBuffer: Buffer.isBuffer(logoBuffer) ? logoBuffer : null,
  };
}

// ─── PDF header renderer ───────────────────────────────────────────────────────
// Draws a standard branded header on an open PDFDocument.
// Returns the Y position where content should start (below the header).

export function drawPdfHeader(doc, { branding, title, subtitle, folio }) {
  const pageWidth = doc.page.width;
  const MARGIN = 44;
  const left = MARGIN;
  const right = pageWidth - MARGIN;
  const HEADER_H = 86;

  const brandColor = normalizeHexColor(branding.primaryColor, "#0F766E");
  const C_BORDER = "#E2E8F0";
  const C_MUTED = "#64748B";
  const companyName = toSafeText(branding.companyName, "Runly ERP");

  doc.rect(0, 0, pageWidth, HEADER_H).fill("#FFFFFF");
  doc.rect(0, 0, 6, HEADER_H).fill(brandColor);

  const LOGO_SIZE = 54;
  const LOGO_X = left + 4;
  const LOGO_Y = Math.floor((HEADER_H - LOGO_SIZE) / 2);
  doc.lineWidth(0.75).rect(LOGO_X, LOGO_Y, LOGO_SIZE, LOGO_SIZE).stroke(C_BORDER);

  const logoBuffer = Buffer.isBuffer(branding.logoBuffer) ? branding.logoBuffer : null;
  let logoDrawn = false;
  if (logoBuffer) {
    try {
      doc.image(logoBuffer, LOGO_X + 4, LOGO_Y + 4, {
        fit: [LOGO_SIZE - 8, LOGO_SIZE - 8],
        align: "center",
        valign: "center",
      });
      logoDrawn = true;
    } catch {
      logoDrawn = false;
    }
  }
  if (!logoDrawn) {
    doc
      .font("Helvetica-Bold")
      .fontSize(18)
      .fillColor(brandColor)
      .text(companyName.slice(0, 2).toUpperCase(), LOGO_X, LOGO_Y + 18, {
        width: LOGO_SIZE,
        align: "center",
        lineBreak: false,
      });
  }

  const rBlockW = Math.max(Math.floor((right - left) * 0.38), 210);
  const rBlockX = right - rBlockW;
  const compX = LOGO_X + LOGO_SIZE + 14;
  const compW = rBlockX - compX - 12;

  doc
    .font("Helvetica-Bold")
    .fontSize(13.5)
    .fillColor(brandColor)
    .text(companyName, compX, 11, { width: compW, lineBreak: false, ellipsis: true });

  const companyMeta = compact([branding.taxId !== "-" ? branding.taxId : null, ...branding.addressLines]);
  if (companyMeta.length > 0) {
    doc
      .font("Helvetica")
      .fontSize(7.5)
      .fillColor(C_MUTED)
      .text(companyMeta.join("\n"), compX, 29, { width: compW, lineBreak: true });
  }

  // Right block: document title + folio/subtitle
  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor("#0F172A")
    .text(title, rBlockX, 10, { width: rBlockW, align: "right", lineBreak: false });

  if (subtitle) {
    doc
      .font("Helvetica")
      .fontSize(8.5)
      .fillColor(C_MUTED)
      .text(subtitle, rBlockX, 26, { width: rBlockW, align: "right", lineBreak: false });
  }
  if (folio) {
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor(C_MUTED)
      .text(folio, rBlockX, folio && subtitle ? 38 : 26, { width: rBlockW, align: "right", lineBreak: false });
  }

  // Separator line
  doc.lineWidth(0.5).moveTo(0, HEADER_H).lineTo(pageWidth, HEADER_H).stroke("#CBD5E1");

  return HEADER_H + 16;
}

// ─── Runly watermark asset loader ──────────────────────────────────────────────
// Runly's own product mark for the PDF watermark — distinct from the tenant's
// uploaded company logo (loadCompanyLogoBuffer above, which comes from Supabase
// Storage per-company). This is a static asset shipped with the app, read once
// from disk and cached in memory — same "resolve a repo-relative path from
// import.meta.url" approach apps/api/src/index.js already uses in production
// to serve these same brand PNGs at GET /brand/:filename.

let runlyWatermarkBufferPromise = null;

export async function resolveRunlyWatermarkBuffer() {
  if (!runlyWatermarkBufferPromise) {
    runlyWatermarkBufferPromise = (async () => {
      try {
        const { readFile } = await import("node:fs/promises");
        const assetUrl = new URL(
          "../../../../apps/desktop/public/brand/runly-logo-isotype.png",
          import.meta.url,
        );
        return await readFile(assetUrl);
      } catch {
        return null;
      }
    })();
  }
  return runlyWatermarkBufferPromise;
}

// ─── PDF footer renderer ───────────────────────────────────────────────────────
// Draws a standard footer: "Generado por <empresa> · fecha" on the left,
// a discreet "Runly ERP" text watermark centered, page numbers on the right,
// plus (when `watermarkBuffer` is supplied) a faint Runly isotipo stamped
// across the page body — independent of any per-company branding.

export function drawPdfFooter(doc, { branding, pageNumber, totalPages, watermarkBuffer }) {
  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;
  const MARGIN = 44;
  const FOOTER_Y = pageHeight - 30;
  const brandColor = normalizeHexColor(branding.primaryColor, "#0F766E");
  const C_MUTED = "#94A3B8";
  const C_WATERMARK = "#CBD5E1";
  const companyName = toSafeText(branding.companyName, "Runly ERP");

  doc.lineWidth(0.4).moveTo(MARGIN, FOOTER_Y - 6).lineTo(pageWidth - MARGIN, FOOTER_Y - 6).stroke("#E2E8F0");

  const colW = (pageWidth - MARGIN * 2) / 3;

  doc
    .font("Helvetica")
    .fontSize(7)
    .fillColor(C_MUTED)
    .text(
      `Generado por ${companyName} · ${new Date().toLocaleDateString("es-MX")}`,
      MARGIN,
      FOOTER_Y,
      { width: colW, align: "left", lineBreak: false, ellipsis: true },
    );

  // Discreet Runly ERP watermark, centered
  doc
    .font("Helvetica")
    .fontSize(7)
    .fillColor(C_WATERMARK)
    .text("Hecho con Runly ERP", MARGIN + colW, FOOTER_Y, {
      width: colW,
      align: "center",
      lineBreak: false,
    });

  if (totalPages > 1) {
    doc
      .font("Helvetica")
      .fontSize(7)
      .fillColor(brandColor)
      .text(`Pag. ${pageNumber} / ${totalPages}`, pageWidth - MARGIN - colW, FOOTER_Y, {
        width: colW,
        align: "right",
      });
  }

  if (Buffer.isBuffer(watermarkBuffer)) {
    const markSize = Math.min(170, pageWidth * 0.28);
    const markX = (pageWidth - markSize) / 2;
    const markY = (pageHeight - markSize) / 2;
    doc.save();
    doc.opacity(0.06);
    try {
      doc.image(watermarkBuffer, markX, markY, { fit: [markSize, markSize], align: "center", valign: "center" });
    } catch {
      // Missing/unreadable watermark asset must never fail the export.
    }
    doc.restore();
  }
}
