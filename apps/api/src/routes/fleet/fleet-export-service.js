import ExcelJS from "exceljs";

// ── Formatting helpers ──────────────────────────────────────────────────────

function fmtDate(d) {
  if (!d) return "";
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return String(d);
  return date.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function applyHeaderStyle(row) {
  row.font = { bold: true, color: { argb: "FF0F172A" }, size: 10 };
  row.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFCCFBF1" }, // teal-100 — matches Runly fleet accent
  };
  row.alignment = { vertical: "middle", wrapText: false };
  row.height = 20;
  row.eachCell((cell) => {
    cell.border = {
      bottom: { style: "medium", color: { argb: "FF14B8A6" } },
    };
  });
}

function applyAutoFilter(sheet) {
  if (!sheet.lastRow) return;
  const colCount = sheet.columns.length;
  if (colCount === 0) return;
  const lastColLetter = sheet.getColumn(colCount).letter;
  sheet.autoFilter = `A1:${lastColLetter}1`;
}

// Stamps the workbook's document metadata with the real company as author.
// "Runly ERP" only appears as a discreet description, never as the creator.
function applyWorkbookIdentity(wb, companyName) {
  const name = String(companyName ?? "").trim() || "Runly ERP";
  wb.creator = name;
  wb.lastModifiedBy = name;
  wb.company = name;
  wb.description = "Hecho con Runly ERP";
  wb.created = new Date();
}

function addInfoSheet(wb, rows) {
  const info = wb.addWorksheet("Info");
  info.getColumn(1).width = 22;
  info.getColumn(2).width = 36;
  for (const [k, v] of rows) {
    const row = info.addRow([k, v]);
    row.getCell(1).font = { bold: true };
  }
}

const COVERAGE_LABELS = {
  basic: "Básica",
  comprehensive: "Integral",
  third_party: "Terceros",
  other: "Otro",
};

const STATUS_VEHICLE = {
  active: "Activo",
  inactive: "Inactivo",
  maintenance: "En mantenimiento",
  retired: "Retirado",
  pending: "Pendiente",
  disabled: "Desactivado",
};

const STATUS_DRIVER = {
  active: "Activo",
  inactive: "Inactivo",
  suspended: "Suspendido",
};

const STATUS_REPORT = {
  draft: "Borrador",
  finalized: "Finalizado",
};

const STATUS_INSURANCE = {
  active: "Activa",
  expired: "Vencida",
  disabled: "Desactivada",
};

const REPORT_TYPE_LABEL = {
  maintenance: "Mantenimiento",
  service: "Servicio",
  repair: "Reparación",
  other: "Otro",
};

const MAINTENANCE_SUBTYPE = {
  preventive: "Preventivo",
  corrective: "Correctivo",
  inspection: "Inspección",
  alignment: "Alineación",
  oil_change: "Cambio de aceite",
  tire_service: "Servicio de llantas",
  other: "Otro",
};

const SERVICE_SUBTYPE = {
  general: "General",
  diagnostic: "Diagnóstico",
  cleaning: "Limpieza",
  electrical: "Eléctrico",
  other: "Otro",
};

const REPAIR_PRIORITY = {
  low: "Baja",
  normal: "Normal",
  high: "Alta",
  urgent: "Urgente",
};

const REPAIR_DAMAGE_TYPE = {
  mechanical: "Mecánico",
  electrical: "Eléctrico",
  body: "Carrocería",
  interior: "Interior",
  other: "Otro",
};

// ── Vehicles ──────────────────────────────────────────────────────────────────

export async function buildVehiclesExcelBuffer({ rows, companyName = "" }) {
  const wb = new ExcelJS.Workbook();
  applyWorkbookIdentity(wb, companyName);

  const sheet = wb.addWorksheet("Vehículos", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  sheet.columns = [
    { header: "Matrícula", key: "plate", width: 14 },
    { header: "No. Económico", key: "full_economic_number", width: 16 },
    { header: "Grupo Ec.", key: "economic_group_number", width: 12 },
    { header: "Ind. Ec.", key: "economic_individual_number", width: 12 },
    { header: "Marca", key: "vehicle_brand_name", width: 18 },
    { header: "Modelo", key: "vehicle_model_name", width: 20 },
    { header: "Tipo", key: "vehicle_type_name", width: 18 },
    { header: "Año", key: "vehicle_model_year", width: 8 },
    { header: "Color", key: "color", width: 14 },
    { header: "Estado", key: "status_label", width: 18 },
    { header: "Póliza", key: "insurance_status_label", width: 14 },
    { header: "Chofer", key: "driver_name", width: 24 },
    { header: "Tel. Chofer", key: "driver_phone", width: 16 },
    { header: "Lic. Chofer", key: "driver_license_number", width: 18 },
    { header: "Financiado", key: "is_financed_label", width: 12 },
    { header: "Institución", key: "financing_institution", width: 26 },
    { header: "No. Contrato", key: "financing_contract_number", width: 22 },
    { header: "Inicio financ.", key: "financing_start_date", width: 16 },
    { header: "Fin financ.", key: "financing_end_date", width: 16 },
    { header: "Pago mensual", key: "financing_monthly_payment", width: 16 },
    { header: "Notas financ.", key: "financing_notes", width: 36 },
    { header: "Notas", key: "notes", width: 40 },
    { header: "Fecha alta", key: "created_at", width: 16 },
  ];

  applyHeaderStyle(sheet.getRow(1));
  applyAutoFilter(sheet);
  sheet.getColumn("financing_monthly_payment").numFmt = "#,##0.00";

  for (const r of rows) {
    sheet.addRow({
      plate: r.plate ?? "",
      full_economic_number:
        r.full_economic_number ?? r.economic_number ?? "",
      economic_group_number: r.economic_group_number ?? r.economic_group_number_resolved ?? "",
      economic_individual_number: r.economic_individual_number ?? "",
      vehicle_brand_name: r.vehicle_brand_name ?? r.brand ?? "",
      vehicle_model_name: r.vehicle_model_name ?? r.model_name ?? "",
      vehicle_type_name: r.vehicle_type_name ?? "",
      vehicle_model_year:
        r.vehicle_model_year != null ? Number(r.vehicle_model_year) : "",
      color: r.color ?? "",
      status_label: STATUS_VEHICLE[r.status] ?? r.status ?? "",
      insurance_status_label:
        STATUS_INSURANCE[r.insurance_status] ?? r.insurance_status ?? "Sin póliza",
      driver_name: r.driver_name ?? "",
      driver_phone: r.driver_phone ?? "",
      driver_license_number: r.driver_license_number ?? "",
      is_financed_label: r.is_financed ? "Sí" : "No",
      financing_institution: r.financing_institution ?? "",
      financing_contract_number: r.financing_contract_number ?? "",
      financing_start_date: fmtDate(r.financing_start_date),
      financing_end_date: fmtDate(r.financing_end_date),
      financing_monthly_payment:
        r.financing_monthly_payment != null
          ? Number(r.financing_monthly_payment)
          : null,
      financing_notes: r.financing_notes ?? "",
      notes: r.notes ?? "",
      created_at: fmtDate(r.created_at),
    });
  }

  addInfoSheet(wb, [
    ["Empresa", companyName],
    ["Total vehículos", rows.length],
    ["Exportado", new Date().toLocaleString("es-MX")],
  ]);

  return wb.xlsx.writeBuffer();
}

// ── Drivers ────────────────────────────────────────────────────────────────────

export async function buildDriversExcelBuffer({ rows, companyName = "" }) {
  const wb = new ExcelJS.Workbook();
  applyWorkbookIdentity(wb, companyName);

  const sheet = wb.addWorksheet("Choferes", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  sheet.columns = [
    { header: "Nombre", key: "first_name", width: 20 },
    { header: "Apellido", key: "last_name", width: 20 },
    { header: "Nombre completo", key: "full_name", width: 28 },
    { header: "Teléfono", key: "phone", width: 18 },
    { header: "Email", key: "email", width: 30 },
    { header: "No. Licencia", key: "license_number", width: 20 },
    { header: "Tipo licencia", key: "license_type", width: 16 },
    { header: "Venc. licencia", key: "license_expiry_date", width: 16 },
    { header: "Estado", key: "status_label", width: 16 },
    { header: "Vehículo asignado", key: "assigned_plate", width: 16 },
    { header: "Colaborador RH", key: "hr_employee_name", width: 28 },
    { header: "Código RH", key: "hr_employee_code", width: 18 },
    { header: "Notas", key: "notes", width: 40 },
    { header: "Fecha alta", key: "created_at", width: 16 },
  ];

  applyHeaderStyle(sheet.getRow(1));
  applyAutoFilter(sheet);

  for (const r of rows) {
    sheet.addRow({
      first_name: r.first_name ?? "",
      last_name: r.last_name ?? "",
      full_name:
        r.full_name ?? `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim(),
      phone: r.phone ?? "",
      email: r.email ?? "",
      license_number: r.license_number ?? "",
      license_type: r.license_type ?? "",
      license_expiry_date: fmtDate(r.license_expiry_date),
      status_label: STATUS_DRIVER[r.status] ?? r.status ?? "",
      assigned_plate: r.assigned_plate ?? "",
      hr_employee_name: r.hr_employee_name ?? "",
      hr_employee_code: r.hr_employee_code ?? "",
      notes: r.notes ?? "",
      created_at: fmtDate(r.created_at),
    });
  }

  addInfoSheet(wb, [
    ["Empresa", companyName],
    ["Total choferes", rows.length],
    ["Exportado", new Date().toLocaleString("es-MX")],
  ]);

  return wb.xlsx.writeBuffer();
}

// ── Insurance ──────────────────────────────────────────────────────────────────

export async function buildInsuranceExcelBuffer({ rows, companyName = "" }) {
  const wb = new ExcelJS.Workbook();
  applyWorkbookIdentity(wb, companyName);

  const sheet = wb.addWorksheet("Seguros", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  sheet.columns = [
    { header: "No. Póliza", key: "policy_number", width: 22 },
    { header: "Aseguradora", key: "insurer_name", width: 28 },
    { header: "Vehículo", key: "vehicle_plate", width: 14 },
    { header: "Tipo cobertura", key: "coverage_label", width: 18 },
    { header: "Estado", key: "status_label", width: 16 },
    { header: "Inicio vigencia", key: "start_date", width: 16 },
    { header: "Fin vigencia", key: "expiry_date", width: 16 },
    { header: "Prima", key: "premium", width: 14 },
    { header: "Moneda", key: "currency", width: 10 },
    { header: "Cert. / Póliza", key: "has_document", width: 16 },
    { header: "Notas", key: "notes", width: 40 },
    { header: "Fecha alta", key: "created_at", width: 16 },
  ];

  applyHeaderStyle(sheet.getRow(1));
  applyAutoFilter(sheet);
  sheet.getColumn("premium").numFmt = "#,##0.00";

  for (const r of rows) {
    sheet.addRow({
      policy_number: r.policy_number ?? "",
      insurer_name: r.insurer_name ?? "",
      vehicle_plate: r.vehicle_plate ?? "",
      coverage_label:
        r.coverage_type_label ??
        COVERAGE_LABELS[r.coverage_type] ??
        r.coverage_type ??
        "",
      status_label: STATUS_INSURANCE[r.status] ?? r.status ?? "",
      start_date: fmtDate(r.start_date),
      expiry_date: fmtDate(r.expiry_date),
      premium: r.premium != null ? Number(r.premium) : null,
      currency: r.currency ?? "MXN",
      has_document: r.document_asset_id ? "Sí" : "No",
      notes: r.notes ?? "",
      created_at: fmtDate(r.created_at),
    });
  }

  addInfoSheet(wb, [
    ["Empresa", companyName],
    ["Total pólizas", rows.length],
    ["Exportado", new Date().toLocaleString("es-MX")],
  ]);

  return wb.xlsx.writeBuffer();
}

// ── Reports ────────────────────────────────────────────────────────────────────

export async function buildReportExcelBuffer({
  rows,
  reportType,
  companyName = "",
}) {
  const wb = new ExcelJS.Workbook();
  applyWorkbookIdentity(wb, companyName);

  const typeLabel = REPORT_TYPE_LABEL[reportType] ?? "Reportes";

  const sheet = wb.addWorksheet(typeLabel, {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  const baseColumns = [
    { header: "Folio", key: "folio", width: 18 },
    { header: "Título", key: "title", width: 32 },
    { header: "Vehículo", key: "vehicle_plate", width: 14 },
    { header: "Marca", key: "vehicle_brand_name", width: 18 },
    { header: "Modelo", key: "vehicle_model_name", width: 20 },
    { header: "Estado", key: "status_label", width: 14 },
    { header: "Fecha reporte", key: "report_date", width: 16 },
    { header: "Odómetro (km)", key: "odometer_km", width: 16 },
    { header: "Taller", key: "workshop_name", width: 28 },
    { header: "Taller interno", key: "is_inhouse_label", width: 16 },
    { header: "Tel. taller", key: "workshop_phone", width: 18 },
    { header: "Costo mano obra", key: "labor_cost", width: 18 },
    { header: "Costo refacciones", key: "parts_cost", width: 18 },
    { header: "Costo total", key: "total_cost", width: 16 },
    { header: "Moneda", key: "currency", width: 10 },
  ];

  const typeSpecificColumns = [];
  if (reportType === "maintenance") {
    typeSpecificColumns.push(
      { header: "Subtipo mantenimiento", key: "maintenance_subtype_label", width: 24 },
      { header: "Próx. servicio (fecha)", key: "next_service_date", width: 22 },
      { header: "Próx. servicio (km)", key: "next_service_odometer", width: 22 },
    );
  } else if (reportType === "service") {
    typeSpecificColumns.push(
      { header: "Subtipo servicio", key: "service_subtype_label", width: 20 },
      { header: "No. Factura", key: "invoice_number", width: 20 },
    );
  } else if (reportType === "repair") {
    typeSpecificColumns.push(
      { header: "Prioridad", key: "repair_priority_label", width: 14 },
      { header: "Tipo daño", key: "repair_damage_type_label", width: 18 },
      { header: "Inicio reparación", key: "repair_start_date", width: 20 },
      { header: "Fin reparación", key: "repair_completion_date", width: 20 },
      { header: "Costo estimado", key: "repair_estimated_cost", width: 18 },
      { header: "Días garantía", key: "warranty_days", width: 16 },
      { header: "Notas garantía", key: "warranty_notes", width: 30 },
    );
  }

  const tailColumns = [
    { header: "Finalizado por", key: "finalized_by", width: 24 },
    { header: "Fecha finalizado", key: "finalized_at", width: 18 },
    { header: "Observaciones", key: "observations", width: 50 },
    { header: "Fecha alta", key: "created_at", width: 16 },
  ];

  sheet.columns = [...baseColumns, ...typeSpecificColumns, ...tailColumns];

  applyHeaderStyle(sheet.getRow(1));
  applyAutoFilter(sheet);
  ["labor_cost", "parts_cost", "total_cost", "repair_estimated_cost"].forEach(
    (key) => {
      const col = sheet.getColumn(key);
      if (col) col.numFmt = "#,##0.00";
    },
  );

  let totalLabor = 0;
  let totalParts = 0;
  let totalCost = 0;

  for (const r of rows) {
    const labor = r.labor_cost != null ? Number(r.labor_cost) : null;
    const parts = r.parts_cost != null ? Number(r.parts_cost) : null;
    const total = r.total_cost != null ? Number(r.total_cost) : null;
    if (labor) totalLabor += labor;
    if (parts) totalParts += parts;
    if (total) totalCost += total;

    const rowData = {
      folio: r.folio ?? "",
      title: r.title ?? "",
      vehicle_plate: r.vehicle_plate ?? "",
      vehicle_brand_name: r.vehicle_brand_name ?? "",
      vehicle_model_name: r.vehicle_model_name ?? "",
      status_label: STATUS_REPORT[r.status] ?? r.status ?? "",
      report_date: fmtDate(r.report_date),
      odometer_km: r.odometer_km != null ? Number(r.odometer_km) : null,
      workshop_name: r.workshop_name ?? (r.is_inhouse_workshop ? "Taller propio" : ""),
      is_inhouse_label: r.is_inhouse_workshop ? "Sí" : "No",
      workshop_phone: r.workshop_phone ?? "",
      labor_cost: labor,
      parts_cost: parts,
      total_cost: total,
      currency: r.currency ?? "MXN",
      finalized_by: r.finalized_by_name ?? "",
      finalized_at: fmtDate(r.finalized_at),
      observations: r.observations ?? r.notes ?? "",
      created_at: fmtDate(r.created_at),
    };

    if (reportType === "maintenance") {
      rowData.maintenance_subtype_label =
        MAINTENANCE_SUBTYPE[r.maintenance_subtype] ?? r.maintenance_subtype ?? "";
      rowData.next_service_date = fmtDate(r.next_service_date);
      rowData.next_service_odometer =
        r.next_service_odometer != null ? Number(r.next_service_odometer) : null;
    } else if (reportType === "service") {
      rowData.service_subtype_label =
        SERVICE_SUBTYPE[r.service_subtype] ?? r.service_subtype ?? "";
      rowData.invoice_number = r.invoice_number ?? "";
    } else if (reportType === "repair") {
      rowData.repair_priority_label =
        REPAIR_PRIORITY[r.repair_priority] ?? r.repair_priority ?? "";
      rowData.repair_damage_type_label =
        REPAIR_DAMAGE_TYPE[r.repair_damage_type] ?? r.repair_damage_type ?? "";
      rowData.repair_start_date = fmtDate(r.repair_start_date);
      rowData.repair_completion_date = fmtDate(r.repair_completion_date);
      rowData.repair_estimated_cost =
        r.repair_estimated_cost != null ? Number(r.repair_estimated_cost) : null;
      rowData.warranty_days = r.warranty_days ?? null;
      rowData.warranty_notes = r.warranty_notes ?? "";
    }

    sheet.addRow(rowData);
  }

  // Totals row
  sheet.addRow([]);
  const totRow = sheet.addRow({ folio: "TOTALES" });
  totRow.font = { bold: true };
  totRow.getCell("labor_cost").value = totalLabor || null;
  totRow.getCell("parts_cost").value = totalParts || null;
  totRow.getCell("total_cost").value = totalCost || null;
  ["labor_cost", "parts_cost", "total_cost"].forEach((k) => {
    totRow.getCell(k).numFmt = "#,##0.00";
  });

  addInfoSheet(wb, [
    ["Empresa", companyName],
    ["Tipo reporte", typeLabel],
    ["Total reportes", rows.length],
    ["Exportado", new Date().toLocaleString("es-MX")],
  ]);

  return wb.xlsx.writeBuffer();
}
