import { buildVehiclePdfBuffer } from "./vehicle-pdf.js";
import {
  normalizePagination,
  normalizeSearch,
  normalizeOptionalString,
  isTableNotFoundError,
  isUniqueViolation,
  toCount,
  firstRow,
  hasOwn,
} from "./service-helpers.js";
import { createActivityService } from "../../services/activity-service.js";
import { createActivityBridge } from "../../services/activity-bridge.js";

const MODULE_KEY = "runly.fleet";
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class FleetServiceError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = "FleetServiceError";
    this.status = status;
  }
}

function normalizeEconomicNumberPart(value) {
  const normalized = normalizeOptionalString(value);
  if (normalized === undefined || normalized === null) return normalized;
  if (!/^\d+$/.test(normalized)) return normalized;
  const withoutLeadingZeros = normalized.replace(/^0+/, "");
  return withoutLeadingZeros.length > 0 ? withoutLeadingZeros : "0";
}

function normalizeOptionalBoolean(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return Boolean(value);
}

function normalizeOptionalNumber(value) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : value;
}

function normalizeVehiclePayload(data = {}) {
  const normalized = {
    ...data,
    plate: data.plate === undefined ? undefined : String(data.plate).trim(),
    brand: data.brand === undefined ? undefined : String(data.brand).trim(),
    model_name:
      data.model_name === undefined
        ? undefined
        : String(data.model_name).trim(),
    color: normalizeOptionalString(data.color),
    notes: normalizeOptionalString(data.notes),
    economic_group_number: normalizeEconomicNumberPart(
      data.economic_group_number,
    ),
    economic_individual_number: normalizeEconomicNumberPart(
      data.economic_individual_number,
    ),
    vehicle_model_id: normalizeOptionalString(data.vehicle_model_id),
    is_financed: normalizeOptionalBoolean(data.is_financed),
    financing_institution: normalizeOptionalString(data.financing_institution),
    financing_contract_number: normalizeOptionalString(
      data.financing_contract_number,
    ),
    financing_start_date: normalizeOptionalString(data.financing_start_date),
    financing_end_date: normalizeOptionalString(data.financing_end_date),
    financing_monthly_payment: normalizeOptionalNumber(
      data.financing_monthly_payment,
    ),
    financing_notes: normalizeOptionalString(data.financing_notes),
  };

  if (normalized.is_financed === false) {
    normalized.financing_institution = null;
    normalized.financing_contract_number = null;
    normalized.financing_start_date = null;
    normalized.financing_end_date = null;
    normalized.financing_monthly_payment = null;
    normalized.financing_notes = null;
  }

  return normalized;
}

function ensureCompanyId(companyId) {
  if (typeof companyId === "string" && companyId.trim())
    return companyId.trim();
  throw new FleetServiceError("companyId es requerido.", 400);
}

function toScopedCompanyUuid(companyId) {
  const normalized =
    typeof companyId === "string" && companyId.trim() ? companyId.trim() : null;
  if (!normalized) throw new FleetServiceError("companyId es requerido.", 400);
  if (!UUID_REGEX.test(normalized))
    throw new FleetServiceError("companyId debe ser UUID valido.", 400);
  return normalized.toLowerCase();
}

function normalizeRecordId(id, notFoundMessage) {
  const value = String(id ?? "").trim();
  if (!UUID_REGEX.test(value)) {
    throw new FleetServiceError(notFoundMessage, 404);
  }
  return value.toLowerCase();
}

async function withDbErrorMapping(fn) {
  try {
    return await fn();
  } catch (error) {
    if (isTableNotFoundError(error)) {
      throw new FleetServiceError(
        "Las tablas del modulo no estan disponibles aun.",
        503,
      );
    }
    throw error;
  }
}

export function createFleetService({ prisma, activityBridge }) {
  const bridge =
    activityBridge ??
    createActivityBridge({
      prisma,
      activityService: createActivityService({ prisma }),
    });

  async function logAudit({
    actorId,
    entityType,
    entityId,
    action,
    before = null,
    after = null,
    metadata = null,
    companyId,
  }) {
    await bridge.logAndPublish({
      auditEntry: {
        actorId: actorId ?? null,
        moduleKey: MODULE_KEY,
        entityType,
        entityId: entityId ?? null,
        action,
        before,
        after,
        metadata,
      },
      companyId,
    });
  }

  // Curated subset of getVehicle()'s columns, used to build before/after audit
  // snapshots for fleet.vehicle.update. Deliberately excludes internal/system
  // columns (id, company_id, created_at, updated_at, enabled) and computed
  // fields that aren't meaningful as a "changed field" (cover_image_file_asset_id,
  // active_insurance_policy, driver_phone/license/photo, the concatenated
  // display name) — only the fields a user actually edits on the vehicle form.
  function toFleetVehicleSnapshot(row) {
    if (!row) return null;
    return {
      plate: row.plate ?? null,
      vehicle_brand_name: row.vehicle_brand_name ?? row.brand ?? null,
      vehicle_model_name: row.vehicle_model_name ?? row.model_name ?? null,
      vehicle_type_name: row.vehicle_type_name ?? null,
      year: row.year ?? null,
      color: row.color ?? null,
      status: row.status ?? null,
      driver_name: row.driver_name ?? null,
      economic_group_number: row.economic_group_number ?? null,
      economic_individual_number: row.economic_individual_number ?? null,
      notes: row.notes ?? null,
      is_financed: row.is_financed ?? null,
      financing_institution: row.financing_institution ?? null,
      financing_contract_number: row.financing_contract_number ?? null,
      financing_start_date: row.financing_start_date ?? null,
      financing_end_date: row.financing_end_date ?? null,
      financing_monthly_payment:
        row.financing_monthly_payment != null ? Number(row.financing_monthly_payment) : null,
      financing_notes: row.financing_notes ?? null,
    };
  }

  async function listVehicles({ companyId, page, pageSize, status, search }) {
    const safeCompanyId = toScopedCompanyUuid(companyId);
    const pagination = normalizePagination({ page, pageSize });
    const normalizedStatus = normalizeOptionalString(status);
    const normalizedSearch = normalizeSearch(search);
    const likeValue = normalizedSearch ? `%${normalizedSearch}%` : null;

    const [rows, totalRows] = await withDbErrorMapping(async () => {
      const dataRows = await prisma.$queryRaw`
        SELECT
          fv.*,
          NULLIF(TRIM(COALESCE(fd.first_name, '') || ' ' || COALESCE(fd.last_name, '')), '') AS driver_name,
          fd.phone AS driver_phone,
          fd.license_number AS driver_license_number,
          vm.name AS vehicle_model_name,
          vm.year AS vehicle_model_year,
          COALESCE(vb_m.name, vb.name) AS vehicle_brand_name,
          COALESCE(vt_m.name, vt.name) AS vehicle_type_name,
          CASE
            WHEN COALESCE(vt_m.economic_group_number, vt.economic_group_number, fv.economic_group_number) IS NULL THEN NULL
            ELSE COALESCE(
              NULLIF(REGEXP_REPLACE(COALESCE(vt_m.economic_group_number, vt.economic_group_number, fv.economic_group_number), '^0+', ''), ''),
              '0'
            )
          END AS economic_group_number_resolved,
          CASE
            WHEN COALESCE(vt_m.economic_group_number, vt.economic_group_number, fv.economic_group_number) IS NOT NULL
              AND fv.economic_individual_number IS NOT NULL
              THEN
                COALESCE(
                  NULLIF(REGEXP_REPLACE(COALESCE(vt_m.economic_group_number, vt.economic_group_number, fv.economic_group_number), '^0+', ''), ''),
                  '0'
                ) ||
                COALESCE(NULLIF(REGEXP_REPLACE(fv.economic_individual_number, '^0+', ''), ''), '0')
            ELSE NULL
          END AS economic_number,
          CASE
            WHEN COALESCE(vt_m.economic_group_number, vt.economic_group_number, fv.economic_group_number) IS NOT NULL
              AND fv.economic_individual_number IS NOT NULL
              THEN
                COALESCE(
                  NULLIF(REGEXP_REPLACE(COALESCE(vt_m.economic_group_number, vt.economic_group_number, fv.economic_group_number), '^0+', ''), ''),
                  '0'
                ) ||
                COALESCE(NULLIF(REGEXP_REPLACE(fv.economic_individual_number, '^0+', ''), ''), '0')
            ELSE NULL
          END AS full_economic_number,
          (SELECT COUNT(*)::int FROM fleet_vehicle_document fvd
           WHERE fvd.vehicle_id::text = fv.id::text AND fvd.company_id::text = fv.company_id::text AND fvd.enabled = true) AS doc_count,
          (SELECT COUNT(*)::int FROM fleet_vehicle_document fvd2
           JOIN "file_asset" fa ON fa.id::text = fvd2.file_asset_id::text
           WHERE fvd2.vehicle_id::text = fv.id::text AND fvd2.company_id::text = fv.company_id::text AND fvd2.enabled = true
           AND fa."mime_type" ILIKE 'image/%') AS image_count,
          (SELECT fvd3.file_asset_id
           FROM fleet_vehicle_document fvd3
           JOIN "file_asset" fa3 ON fa3.id::text = fvd3.file_asset_id::text
           WHERE fvd3.vehicle_id::text = fv.id::text
             AND fvd3.company_id::text = fv.company_id::text
             AND fvd3.enabled = true
             AND fa3."mime_type" ILIKE 'image/%'
           ORDER BY fvd3.created_at ASC
           LIMIT 1) AS cover_image_file_asset_id,
          (SELECT CASE
            WHEN COUNT(*) FILTER (WHERE fip.enabled = true AND fip.expiry_date::date >= CURRENT_DATE) > 0 THEN 'active'
            WHEN COUNT(*) FILTER (WHERE fip.enabled = true AND fip.expiry_date::date < CURRENT_DATE) > 0 THEN 'expired'
            ELSE 'none'
           END
           FROM fleet_insurance_policy fip
           WHERE fip.vehicle_id = fv.id AND fip.company_id = fv.company_id) AS insurance_status,
          TRIM(CONCAT(
            fv.plate,
            CASE WHEN COALESCE(vb_m.name, vb.name) IS NOT NULL THEN ' · ' || COALESCE(vb_m.name, vb.name) ELSE '' END,
            CASE WHEN vm.name IS NOT NULL THEN ' ' || vm.name ELSE '' END,
            CASE WHEN vm.year IS NOT NULL THEN ' (' || vm.year::text || ')' ELSE '' END
          )) AS name
        FROM fleet_vehicle fv
        LEFT JOIN fleet_vehicle_model vm ON vm.id = fv.vehicle_model_id
        LEFT JOIN fleet_vehicle_brand vb_m ON vb_m.id = vm.brand_id
        LEFT JOIN fleet_vehicle_type vt_m ON vt_m.id = vm.type_id
        LEFT JOIN fleet_vehicle_type vt ON vt.id = fv.vehicle_type_id
        LEFT JOIN fleet_vehicle_brand vb ON vb.id = fv.vehicle_brand_id
        LEFT JOIN fleet_driver fd ON fd.id = fv.driver_id AND fd.company_id = fv.company_id
        WHERE fv.company_id = ${safeCompanyId}
          AND fv.enabled = true
          AND (${normalizedStatus}::text IS NULL OR fv.status = ${normalizedStatus})
          AND (
            ${likeValue}::text IS NULL
            OR fv.plate ILIKE ${likeValue}
            OR fv.brand ILIKE ${likeValue}
            OR fv.model_name ILIKE ${likeValue}
            OR vm.name ILIKE ${likeValue}
            OR vb_m.name ILIKE ${likeValue}
            OR fv.economic_individual_number ILIKE ${likeValue}
            OR (
              CASE
                WHEN COALESCE(vt_m.economic_group_number, vt.economic_group_number, fv.economic_group_number) IS NOT NULL
                  AND fv.economic_individual_number IS NOT NULL
                  THEN
                    COALESCE(
                      NULLIF(REGEXP_REPLACE(COALESCE(vt_m.economic_group_number, vt.economic_group_number, fv.economic_group_number), '^0+', ''), ''),
                      '0'
                    ) || '-' ||
                    COALESCE(NULLIF(REGEXP_REPLACE(fv.economic_individual_number, '^0+', ''), ''), '0')
                ELSE NULL
              END
            ) ILIKE ${likeValue}
            OR (
              CASE
                WHEN COALESCE(vt_m.economic_group_number, vt.economic_group_number, fv.economic_group_number) IS NOT NULL
                  AND fv.economic_individual_number IS NOT NULL
                  THEN
                    COALESCE(
                      NULLIF(REGEXP_REPLACE(COALESCE(vt_m.economic_group_number, vt.economic_group_number, fv.economic_group_number), '^0+', ''), ''),
                      '0'
                    ) ||
                    COALESCE(NULLIF(REGEXP_REPLACE(fv.economic_individual_number, '^0+', ''), ''), '0')
                ELSE NULL
              END
            ) ILIKE ${likeValue}
            OR (COALESCE(fd.first_name, '') || ' ' || COALESCE(fd.last_name, '')) ILIKE ${likeValue}
          )
        ORDER BY fv.created_at DESC
        LIMIT ${pagination.pageSize}
        OFFSET ${pagination.offset}
      `;

      const countRows = await prisma.$queryRaw`
        SELECT COUNT(*)::bigint AS total
        FROM fleet_vehicle fv
        LEFT JOIN fleet_vehicle_model vm ON vm.id = fv.vehicle_model_id
        LEFT JOIN fleet_vehicle_brand vb_m ON vb_m.id = vm.brand_id
        LEFT JOIN fleet_vehicle_type vt_m ON vt_m.id = vm.type_id
        LEFT JOIN fleet_vehicle_type vt ON vt.id = fv.vehicle_type_id
        LEFT JOIN fleet_driver fd ON fd.id = fv.driver_id AND fd.company_id = fv.company_id
        WHERE fv.company_id = ${safeCompanyId}
          AND fv.enabled = true
          AND (${normalizedStatus}::text IS NULL OR fv.status = ${normalizedStatus})
          AND (
            ${likeValue}::text IS NULL
            OR fv.plate ILIKE ${likeValue}
            OR fv.brand ILIKE ${likeValue}
            OR fv.model_name ILIKE ${likeValue}
            OR vm.name ILIKE ${likeValue}
            OR vb_m.name ILIKE ${likeValue}
            OR fv.economic_individual_number ILIKE ${likeValue}
            OR (
              CASE
                WHEN COALESCE(vt_m.economic_group_number, vt.economic_group_number, fv.economic_group_number) IS NOT NULL
                  AND fv.economic_individual_number IS NOT NULL
                  THEN
                    COALESCE(
                      NULLIF(REGEXP_REPLACE(COALESCE(vt_m.economic_group_number, vt.economic_group_number, fv.economic_group_number), '^0+', ''), ''),
                      '0'
                    ) || '-' ||
                    COALESCE(NULLIF(REGEXP_REPLACE(fv.economic_individual_number, '^0+', ''), ''), '0')
                ELSE NULL
              END
            ) ILIKE ${likeValue}
            OR (
              CASE
                WHEN COALESCE(vt_m.economic_group_number, vt.economic_group_number, fv.economic_group_number) IS NOT NULL
                  AND fv.economic_individual_number IS NOT NULL
                  THEN
                    COALESCE(
                      NULLIF(REGEXP_REPLACE(COALESCE(vt_m.economic_group_number, vt.economic_group_number, fv.economic_group_number), '^0+', ''), ''),
                      '0'
                    ) ||
                    COALESCE(NULLIF(REGEXP_REPLACE(fv.economic_individual_number, '^0+', ''), ''), '0')
                ELSE NULL
              END
            ) ILIKE ${likeValue}
            OR (COALESCE(fd.first_name, '') || ' ' || COALESCE(fd.last_name, '')) ILIKE ${likeValue}
          )
      `;
      return [dataRows, countRows];
    });

    return {
      data: rows,
      pagination: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        total: toCount(firstRow(totalRows)?.total),
      },
    };
  }

  async function getVehicle({ companyId, id }) {
    const safeCompanyId = toScopedCompanyUuid(companyId);
    const safeId = normalizeRecordId(id, "Vehiculo no encontrado.");
    const row = await withDbErrorMapping(async () => {
      const rows = await prisma.$queryRaw`
        SELECT
          fv.*,
          NULLIF(TRIM(COALESCE(fd.first_name, '') || ' ' || COALESCE(fd.last_name, '')), '') AS driver_name,
          fd.phone AS driver_phone,
          fd.license_number AS driver_license_number,
          fd.photo_asset_id AS driver_photo_asset_id,
          vm.name AS vehicle_model_name,
          vm.year AS vehicle_model_year,
          COALESCE(vb_m.name, vb.name) AS vehicle_brand_name,
          COALESCE(vt_m.name, vt.name) AS vehicle_type_name,
          CASE
            WHEN COALESCE(vt_m.economic_group_number, vt.economic_group_number, fv.economic_group_number) IS NULL THEN NULL
            ELSE COALESCE(
              NULLIF(REGEXP_REPLACE(COALESCE(vt_m.economic_group_number, vt.economic_group_number, fv.economic_group_number), '^0+', ''), ''),
              '0'
            )
          END AS economic_group_number_resolved,
          CASE
            WHEN COALESCE(vt_m.economic_group_number, vt.economic_group_number, fv.economic_group_number) IS NOT NULL
              AND fv.economic_individual_number IS NOT NULL
              THEN
                COALESCE(
                  NULLIF(REGEXP_REPLACE(COALESCE(vt_m.economic_group_number, vt.economic_group_number, fv.economic_group_number), '^0+', ''), ''),
                  '0'
                ) ||
                COALESCE(NULLIF(REGEXP_REPLACE(fv.economic_individual_number, '^0+', ''), ''), '0')
            ELSE NULL
          END AS economic_number,
          CASE
            WHEN COALESCE(vt_m.economic_group_number, vt.economic_group_number, fv.economic_group_number) IS NOT NULL
              AND fv.economic_individual_number IS NOT NULL
              THEN
                COALESCE(
                  NULLIF(REGEXP_REPLACE(COALESCE(vt_m.economic_group_number, vt.economic_group_number, fv.economic_group_number), '^0+', ''), ''),
                  '0'
                ) ||
                COALESCE(NULLIF(REGEXP_REPLACE(fv.economic_individual_number, '^0+', ''), ''), '0')
            ELSE NULL
          END AS full_economic_number,
          (SELECT fvd3.file_asset_id
           FROM fleet_vehicle_document fvd3
           JOIN "file_asset" fa3 ON fa3.id::text = fvd3.file_asset_id::text
           WHERE fvd3.vehicle_id::text = fv.id::text
             AND fvd3.company_id::text = fv.company_id::text
             AND fvd3.enabled = true
             AND fa3."mime_type" ILIKE 'image/%'
           ORDER BY fvd3.created_at ASC
           LIMIT 1) AS cover_image_file_asset_id,
          (SELECT json_build_object(
            'id', fip.id::text,
            'insurer_name', fip.insurer_name,
            'policy_number', fip.policy_number,
            'coverage_type', fip.coverage_type,
            'coverage_type_label', CASE fip.coverage_type
              WHEN 'basic' THEN 'Basica'
              WHEN 'comprehensive' THEN 'Integral'
              WHEN 'third_party' THEN 'Terceros'
              WHEN 'other' THEN 'Otro'
              ELSE fip.coverage_type
            END,
            'expiry_date', fip.expiry_date::text
           )
           FROM fleet_insurance_policy fip
           WHERE fip.vehicle_id = fv.id AND fip.company_id = fv.company_id
             AND fip.enabled = true AND fip.expiry_date::date >= CURRENT_DATE
           ORDER BY fip.start_date DESC
           LIMIT 1) AS active_insurance_policy,
          TRIM(CONCAT(
            fv.plate,
            CASE WHEN COALESCE(vb_m.name, vb.name) IS NOT NULL THEN ' · ' || COALESCE(vb_m.name, vb.name) ELSE '' END,
            CASE WHEN vm.name IS NOT NULL THEN ' ' || vm.name ELSE '' END,
            CASE WHEN vm.year IS NOT NULL THEN ' (' || vm.year::text || ')' ELSE '' END
          )) AS name
        FROM fleet_vehicle fv
        LEFT JOIN fleet_vehicle_model vm ON vm.id = fv.vehicle_model_id
        LEFT JOIN fleet_vehicle_brand vb_m ON vb_m.id = vm.brand_id
        LEFT JOIN fleet_vehicle_type vt_m ON vt_m.id = vm.type_id
        LEFT JOIN fleet_vehicle_type vt ON vt.id = fv.vehicle_type_id
        LEFT JOIN fleet_vehicle_brand vb ON vb.id = fv.vehicle_brand_id
        LEFT JOIN fleet_driver fd ON fd.id = fv.driver_id AND fd.company_id = fv.company_id
        WHERE fv.id = ${safeId}
          AND fv.company_id = ${safeCompanyId}
        LIMIT 1
      `;
      return firstRow(rows);
    });

    if (!row) throw new FleetServiceError("Vehiculo no encontrado.", 404);
    return row;
  }

  async function createVehicle({ companyId, data, actorId }) {
    const safeCompanyId = toScopedCompanyUuid(companyId);
    const payload = normalizeVehiclePayload(data);

    try {
      const row = await withDbErrorMapping(async () => {
        const rows = await prisma.$queryRaw`
          INSERT INTO fleet_vehicle (
            company_id,
            plate,
            brand,
            model_name,
            year,
            color,
            status,
            driver_id,
            notes,
            economic_group_number,
            economic_individual_number,
            vehicle_type_id,
            vehicle_brand_id,
            vehicle_model_id,
            is_financed,
            financing_institution,
            financing_contract_number,
            financing_start_date,
            financing_end_date,
            financing_monthly_payment,
            financing_notes
          )
          VALUES (
            ${safeCompanyId},
            ${payload.plate},
            ${payload.brand ?? null},
            ${payload.model_name ?? null},
            ${payload.year ?? null},
            ${payload.color ?? null},
            ${payload.status ?? "active"},
            ${payload.driver_id ?? null},
            ${payload.notes ?? null},
            ${payload.economic_group_number ?? null},
            ${payload.economic_individual_number ?? null},
            ${payload.vehicle_type_id ?? null},
            ${payload.vehicle_brand_id ?? null},
            ${payload.vehicle_model_id ?? null},
            ${payload.is_financed ?? false},
            ${payload.financing_institution ?? null},
            ${payload.financing_contract_number ?? null},
            ${payload.financing_start_date ?? null},
            ${payload.financing_end_date ?? null},
            ${payload.financing_monthly_payment ?? null},
            ${payload.financing_notes ?? null}
          )
          RETURNING *
        `;
        return firstRow(rows);
      });

      await logAudit({
        actorId,
        entityType: "Vehicle",
        entityId: row?.id ?? null,
        action: "fleet.vehicle.create",
        before: null,
        after: row,
        companyId: safeCompanyId,
      });

      return row;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new FleetServiceError(
          "Ya existe un vehiculo con esa matricula.",
          409,
        );
      }
      throw error;
    }
  }

  async function updateVehicle({ companyId, id, data, actorId }) {
    const safeCompanyId = toScopedCompanyUuid(companyId);
    const safeId = normalizeRecordId(id, "Vehiculo no encontrado.");
    const payload = normalizeVehiclePayload(data);

    const hasPlate = hasOwn(payload, "plate") && payload.plate !== undefined;
    const hasBrand = hasOwn(payload, "brand") && payload.brand !== undefined;
    const hasModelName =
      hasOwn(payload, "model_name") && payload.model_name !== undefined;
    const hasYear = hasOwn(payload, "year") && payload.year !== undefined;
    const hasStatus = hasOwn(payload, "status") && payload.status !== undefined;
    const hasColor = hasOwn(payload, "color") && payload.color !== undefined;
    const hasDriverId =
      hasOwn(payload, "driver_id") && payload.driver_id !== undefined;
    const hasNotes = hasOwn(payload, "notes") && payload.notes !== undefined;
    const hasEconomicGroupNumber =
      hasOwn(payload, "economic_group_number") &&
      payload.economic_group_number !== undefined;
    const hasEconomicIndividualNumber =
      hasOwn(payload, "economic_individual_number") &&
      payload.economic_individual_number !== undefined;
    const hasVehicleTypeId =
      hasOwn(payload, "vehicle_type_id") &&
      payload.vehicle_type_id !== undefined;
    const hasVehicleBrandId =
      hasOwn(payload, "vehicle_brand_id") &&
      payload.vehicle_brand_id !== undefined;
    const hasVehicleModelId =
      hasOwn(payload, "vehicle_model_id") &&
      payload.vehicle_model_id !== undefined;
    const hasIsFinanced =
      hasOwn(payload, "is_financed") && payload.is_financed !== undefined;
    const hasFinancingInstitution =
      hasOwn(payload, "financing_institution") &&
      payload.financing_institution !== undefined;
    const hasFinancingContractNumber =
      hasOwn(payload, "financing_contract_number") &&
      payload.financing_contract_number !== undefined;
    const hasFinancingStartDate =
      hasOwn(payload, "financing_start_date") &&
      payload.financing_start_date !== undefined;
    const hasFinancingEndDate =
      hasOwn(payload, "financing_end_date") &&
      payload.financing_end_date !== undefined;
    const hasFinancingMonthlyPayment =
      hasOwn(payload, "financing_monthly_payment") &&
      payload.financing_monthly_payment !== undefined;
    const hasFinancingNotes =
      hasOwn(payload, "financing_notes") &&
      payload.financing_notes !== undefined;

    const hasAnyUpdate =
      hasPlate ||
      hasBrand ||
      hasModelName ||
      hasYear ||
      hasStatus ||
      hasColor ||
      hasDriverId ||
      hasNotes ||
      hasEconomicGroupNumber ||
      hasEconomicIndividualNumber ||
      hasVehicleTypeId ||
      hasVehicleBrandId ||
      hasVehicleModelId ||
      hasIsFinanced ||
      hasFinancingInstitution ||
      hasFinancingContractNumber ||
      hasFinancingStartDate ||
      hasFinancingEndDate ||
      hasFinancingMonthlyPayment ||
      hasFinancingNotes;

    if (!hasAnyUpdate) {
      throw new FleetServiceError(
        "No hay campos validos para actualizar.",
        400,
      );
    }

    const before = await getVehicle({ companyId: safeCompanyId, id: safeId });

    try {
      const updated = await withDbErrorMapping(async () => {
        const rows = await prisma.$queryRaw`
          UPDATE fleet_vehicle
          SET plate = CASE WHEN ${hasPlate} THEN ${payload.plate ?? null} ELSE plate END,
              brand = CASE WHEN ${hasBrand} THEN ${payload.brand ?? null} ELSE brand END,
              model_name = CASE WHEN ${hasModelName} THEN ${payload.model_name ?? null} ELSE model_name END,
              year = CASE WHEN ${hasYear} THEN ${payload.year ?? null} ELSE year END,
              status = CASE WHEN ${hasStatus} THEN ${payload.status ?? null} ELSE status END,
              color = CASE WHEN ${hasColor} THEN ${payload.color ?? null} ELSE color END,
              driver_id = CASE WHEN ${hasDriverId} THEN ${payload.driver_id ?? null} ELSE driver_id END,
              notes = CASE WHEN ${hasNotes} THEN ${payload.notes ?? null} ELSE notes END,
              economic_group_number = CASE WHEN ${hasEconomicGroupNumber} THEN ${payload.economic_group_number ?? null} ELSE economic_group_number END,
              economic_individual_number = CASE WHEN ${hasEconomicIndividualNumber} THEN ${payload.economic_individual_number ?? null} ELSE economic_individual_number END,
              vehicle_type_id = CASE WHEN ${hasVehicleTypeId} THEN ${payload.vehicle_type_id ?? null} ELSE vehicle_type_id END,
              vehicle_brand_id = CASE WHEN ${hasVehicleBrandId} THEN ${payload.vehicle_brand_id ?? null} ELSE vehicle_brand_id END,
              vehicle_model_id = CASE WHEN ${hasVehicleModelId} THEN ${payload.vehicle_model_id ?? null} ELSE vehicle_model_id END,
              is_financed = CASE WHEN ${hasIsFinanced} THEN ${payload.is_financed ?? false} ELSE is_financed END,
              financing_institution = CASE WHEN ${hasFinancingInstitution} THEN ${payload.financing_institution ?? null} ELSE financing_institution END,
              financing_contract_number = CASE WHEN ${hasFinancingContractNumber} THEN ${payload.financing_contract_number ?? null} ELSE financing_contract_number END,
              financing_start_date = CASE WHEN ${hasFinancingStartDate} THEN ${payload.financing_start_date ?? null} ELSE financing_start_date END,
              financing_end_date = CASE WHEN ${hasFinancingEndDate} THEN ${payload.financing_end_date ?? null} ELSE financing_end_date END,
              financing_monthly_payment = CASE WHEN ${hasFinancingMonthlyPayment} THEN ${payload.financing_monthly_payment ?? null} ELSE financing_monthly_payment END,
              financing_notes = CASE WHEN ${hasFinancingNotes} THEN ${payload.financing_notes ?? null} ELSE financing_notes END,
              updated_at = now()
          WHERE id = ${safeId}
            AND company_id = ${safeCompanyId}
          RETURNING *
        `;
        return firstRow(rows);
      });

      if (!updated) throw new FleetServiceError("Vehiculo no encontrado.", 404);

      // Re-fetch through getVehicle() so "after" carries the same resolved
      // (driver/brand/model/type name) shape "before" already has — the raw
      // UPDATE...RETURNING * row doesn't include those joined columns, and
      // diffing mismatched shapes would report every resolved field as a
      // false "changed to null".
      const after = await getVehicle({ companyId: safeCompanyId, id: safeId });

      await logAudit({
        actorId,
        entityType: "Vehicle",
        entityId: updated.id,
        action: "fleet.vehicle.update",
        before: toFleetVehicleSnapshot(before),
        after: toFleetVehicleSnapshot(after),
        companyId: safeCompanyId,
      });

      return updated;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new FleetServiceError(
          "Ya existe un vehiculo con esa matricula.",
          409,
        );
      }
      throw error;
    }
  }

  async function setVehicleEnabled({ companyId, id, enabled, actorId }) {
    const safeCompanyId = toScopedCompanyUuid(companyId);
    const safeId = normalizeRecordId(id, "Vehiculo no encontrado.");
    const before = await getVehicle({ companyId: safeCompanyId, id: safeId });

    const updated = await withDbErrorMapping(async () => {
      const rows = await prisma.$queryRaw`
        UPDATE fleet_vehicle
        SET enabled = ${Boolean(enabled)},
            updated_at = now()
        WHERE id = ${safeId}
          AND company_id = ${safeCompanyId}
        RETURNING *
      `;
      return firstRow(rows);
    });

    if (!updated) throw new FleetServiceError("Vehiculo no encontrado.", 404);

    await logAudit({
      actorId,
      entityType: "Vehicle",
      entityId: updated.id,
      action: "fleet.vehicle.disable",
      before: toFleetVehicleSnapshot(before),
      after: toFleetVehicleSnapshot(before),
      metadata: { enabled: Boolean(enabled) },
      companyId: safeCompanyId,
    });

    return updated;
  }

  async function listVehicleDocuments({ companyId, vehicleId }) {
    const safeCompanyId = toScopedCompanyUuid(companyId);
    const safeVehicleId = normalizeRecordId(
      vehicleId,
      "Vehiculo no encontrado.",
    );
    const docs = await withDbErrorMapping(
      () => prisma.$queryRaw`
      SELECT * FROM fleet_vehicle_document
      WHERE vehicle_id = ${safeVehicleId} AND company_id = ${safeCompanyId} AND enabled = true
      ORDER BY created_at DESC
    `,
    );
    if (!docs.length) return { data: [] };
    const ids = docs.map((d) => d.file_asset_id).filter(Boolean);
    const assets = ids.length
      ? await prisma.fileAsset.findMany({ where: { id: { in: ids } } })
      : [];
    const assetMap = Object.fromEntries(assets.map((a) => [a.id, a]));
    return {
      data: docs.map((d) => ({
        ...d,
        file_asset: assetMap[d.file_asset_id] ?? null,
      })),
    };
  }

  async function addVehicleDocument({
    companyId,
    actorId,
    vehicleId,
    payload,
  }) {
    const safeCompanyId = toScopedCompanyUuid(companyId);
    const safeVehicleId = normalizeRecordId(
      vehicleId,
      "Vehiculo no encontrado.",
    );
    const doc = await withDbErrorMapping(async () =>
      firstRow(
        await prisma.$queryRaw`
      INSERT INTO fleet_vehicle_document (company_id, vehicle_id, file_asset_id, document_type, label)
      VALUES (${safeCompanyId}, ${safeVehicleId}, ${payload.file_asset_id}, ${payload.document_type ?? "document"}, ${payload.label ?? null})
      RETURNING *
    `,
      ),
    );
    await logAudit({
      actorId,
      entityType: "Vehicle",
      entityId: safeVehicleId,
      action: "fleet.vehicle.document.add",
      before: null,
      after: doc,
      companyId: safeCompanyId,
    });
    return doc;
  }

  async function removeVehicleDocument({
    companyId,
    actorId,
    vehicleId,
    docId,
  }) {
    const safeCompanyId = toScopedCompanyUuid(companyId);
    const safeVehicleId = normalizeRecordId(
      vehicleId,
      "Vehiculo no encontrado.",
    );
    const safeDocId = normalizeRecordId(docId, "Documento no encontrado.");
    const updated = await withDbErrorMapping(async () =>
      firstRow(
        await prisma.$queryRaw`
      UPDATE fleet_vehicle_document SET enabled = false
      WHERE id = ${safeDocId} AND vehicle_id = ${safeVehicleId} AND company_id = ${safeCompanyId}
      RETURNING *
    `,
      ),
    );
    if (!updated) throw new FleetServiceError("Documento no encontrado.", 404);
    await logAudit({
      actorId,
      entityType: "Vehicle",
      entityId: safeVehicleId,
      action: "fleet.vehicle.document.remove",
      before: updated,
      after: { ...updated, enabled: false },
      companyId: safeCompanyId,
    });
    return updated;
  }

  async function generateVehiclePdf({ companyId, id }) {
    const safeCompanyId = toScopedCompanyUuid(companyId);
    const vehicle = await getVehicle({ companyId: safeCompanyId, id });
    const pdf = await buildVehiclePdfBuffer({
      prisma,
      companyId: safeCompanyId,
      vehicle,
    });
    return { vehicle, pdf };
  }

  return {
    listVehicles,
    getVehicle,
    createVehicle,
    updateVehicle,
    setVehicleEnabled,
    listVehicleDocuments,
    addVehicleDocument,
    removeVehicleDocument,
    generateVehiclePdf,
  };
}
