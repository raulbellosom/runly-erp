import { forwardRef, useImperativeHandle } from "react";
import { Button, useGeoData } from "@runly/ui";
import { Pencil } from "lucide-react";
import { RUNLY_DESKTOP_DOWNLOAD_URL } from "../lib/appConfig.js";

const COMPANY_TYPE_LABELS = {
  sa_de_cv: "SA de CV",
  srl_de_cv: "SRL de CV",
  sa: "SA",
  srl: "SRL",
  sc: "SC - Sociedad Cooperativa",
  ac: "AC - Asociacion Civil",
  sapi_de_cv: "SAPI de CV",
  otro: "Otro",
};

const INDUSTRY_LABELS = {
  tecnologia: "Tecnologia",
  software: "Software",
  mineria: "Mineria",
  contabilidad: "Contabilidad",
  manufactura: "Manufactura",
  retail: "Retail",
  salud: "Salud",
  educacion: "Educacion",
  logistica: "Logistica",
  construccion: "Construccion",
  servicios_profesionales: "Servicios profesionales",
  agroindustria: "Agroindustria",
  financiero: "Financiero",
  hospitalidad: "Hospitalidad",
  marketing: "Marketing",
  inmobiliario: "Inmobiliario",
  ong: "ONG",
  otro: "Otro",
};

const COMPANY_SIZE_LABELS = {
  micro: "Micro (1-10)",
  small: "Pequena (11-50)",
  medium: "Mediana (51-200)",
  large: "Grande (201-500)",
  corporate: "Corporativo (500+)",
};

function ReviewSection({ title, rows, onEdit }) {
  const visibleRows = rows.filter((r) => r.value);
  if (visibleRows.length === 0) return null;
  return (
    <div className="rounded-2xl glass-subtle px-5 py-4">
      <div className="flex items-center justify-between gap-3 pb-2.5">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-(--brand-primary)" />
          <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            {title}
          </span>
        </div>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="flex items-center gap-1.5 text-[12.5px] font-medium text-(--brand-primary) hover:text-(--brand-primary-hover) transition-colors duration-150 cursor-pointer"
          >
            <Pencil size={12} strokeWidth={2} />
            Editar
          </button>
        )}
      </div>
      {visibleRows.map((row, i) => (
        <div
          key={row.label}
          className={[
            "grid grid-cols-[minmax(110px,0.8fr)_1.2fr] gap-4 py-2.5 text-[13.5px]",
            i > 0 ? "border-t border-border" : "",
          ].join(" ")}
        >
          <span className="text-muted-foreground">{row.label}</span>
          <span className="text-foreground font-medium text-pretty">{row.value}</span>
        </div>
      ))}
    </div>
  );
}

export const StepReview = forwardRef(function StepReview(
  { data, onGoToStep },
  ref,
) {
  useImperativeHandle(ref, () => ({
    validate() {
      return true;
    },
  }));

  const { Country, State } = useGeoData();
  const countryName = data.country
    ? (Country?.getCountryByCode(data.country)?.name ?? data.country)
    : "";
  const stateName =
    data.country && data.state
      ? (State?.getStateByCodeAndCountry(data.state, data.country)?.name ??
        data.state)
      : "";

  const companyTypeLabel =
    data.companyType === "otro"
      ? data.companyTypeName || "Otro"
      : COMPANY_TYPE_LABELS[data.companyType] || data.companyType;

  const companyIndustryLabel =
    data.companyIndustryKey === "otro"
      ? data.companyIndustryName || "Otro"
      : data.companyIndustryName ||
        INDUSTRY_LABELS[data.companyIndustryKey] ||
        data.companyIndustryKey;

  const addressParts = [
    data.street &&
      (data.extNumber ? `${data.street} ${data.extNumber}` : data.street),
    data.intNumber,
    data.city,
    stateName,
    data.postalCode,
    countryName,
  ].filter(Boolean);
  const addressLine = addressParts.join(", ");

  return (
    <div>
      <div className="space-y-5">
        <ReviewSection
          title="Cuenta de administrador"
          onEdit={onGoToStep ? () => onGoToStep(0) : undefined}
          rows={[
            {
              label: "Nombre",
              value: `${data.adminFirstName} ${data.adminLastName}`.trim(),
            },
            { label: "Correo", value: data.adminEmail },
          ]}
        />

        <ReviewSection
          title="Empresa"
          onEdit={onGoToStep ? () => onGoToStep(1) : undefined}
          rows={[
            { label: "Nombre comercial", value: data.companyName },
            { label: "Razon social", value: data.legalName },
            { label: "RFC", value: data.rfc },
            { label: "Forma legal", value: companyTypeLabel },
            { label: "Giro", value: companyIndustryLabel },
            { label: "Tamano", value: COMPANY_SIZE_LABELS[data.companySize] },
            { label: "Domicilio", value: addressLine },
          ]}
        />

        <ReviewSection
          title="Identidad visual"
          onEdit={onGoToStep ? () => onGoToStep(2) : undefined}
          rows={[
            {
              label: "Color principal",
              value: (
                <span className="flex items-center gap-2">
                  <span
                    className="inline-block w-4 h-4 rounded border border-border"
                    style={{ background: data.primaryColor }}
                  />
                  <span className="font-mono text-xs">{data.primaryColor}</span>
                </span>
              ),
            },
            {
              label: "Logotipo",
              value: data.logo ? data.logo.name : "Sin logotipo",
            },
          ]}
        />
      </div>

      <div className="mt-5 rounded-2xl glass-subtle px-5 py-4 flex flex-col gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">
            ¿Quieres usar Runly ERP desde tu escritorio?
          </p>
          <p className="text-sm text-muted-foreground">
            Descarga la app y conéctala a esta instancia.
          </p>
        </div>

        <Button
          type="button"
          variant="secondary"
          className="self-start"
          onClick={() => window.open(RUNLY_DESKTOP_DOWNLOAD_URL, "_blank", "noopener,noreferrer")}
        >
          Descargar para Windows
        </Button>
      </div>
    </div>
  );
});
