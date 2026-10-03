import { useState, forwardRef, useImperativeHandle, useMemo } from "react";
import { Building2, FileText, Hash, MapPin } from "lucide-react";
import { TextField, SelectField, ComboboxField, useGeoData } from "@runly/ui";

const COMPANY_TYPES = [
  { value: "sa_de_cv", label: "SA de CV" },
  { value: "srl_de_cv", label: "SRL de CV" },
  { value: "sa", label: "SA" },
  { value: "srl", label: "SRL" },
  { value: "sc", label: "SC - Sociedad Cooperativa" },
  { value: "ac", label: "AC - Asociacion Civil" },
  { value: "sapi_de_cv", label: "SAPI de CV" },
  { value: "otro", label: "Otro" },
];

const COMPANY_SIZES = [
  { value: "micro", label: "Micro - 1 a 10 empleados" },
  { value: "small", label: "Pequena - 11 a 50 empleados" },
  { value: "medium", label: "Mediana - 51 a 200 empleados" },
  { value: "large", label: "Grande - 201 a 500 empleados" },
  { value: "corporate", label: "Corporativo - mas de 500 empleados" },
];

const INDUSTRY_OPTIONS = [
  { value: "tecnologia", label: "Tecnologia" },
  { value: "software", label: "Software" },
  { value: "mineria", label: "Mineria" },
  { value: "contabilidad", label: "Contabilidad" },
  { value: "manufactura", label: "Manufactura" },
  { value: "retail", label: "Retail" },
  { value: "salud", label: "Salud" },
  { value: "educacion", label: "Educacion" },
  { value: "logistica", label: "Logistica" },
  { value: "construccion", label: "Construccion" },
  { value: "servicios_profesionales", label: "Servicios profesionales" },
  { value: "agroindustria", label: "Agroindustria" },
  { value: "financiero", label: "Financiero" },
  { value: "hospitalidad", label: "Hospitalidad" },
  { value: "marketing", label: "Marketing" },
  { value: "inmobiliario", label: "Inmobiliario" },
  { value: "ong", label: "ONG" },
  { value: "otro", label: "Otro (especificar)" },
];

function toSlug(name) {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const StepCompany = forwardRef(function StepCompany(
  { data, onChange },
  ref,
) {
  const [errors, setErrors] = useState({});

  useImperativeHandle(ref, () => ({
    validate() {
      const e = {};
      if (!data.companyName || data.companyName.length < 2) {
        e.companyName = "Minimo 2 caracteres";
      }
      if (
        data.companyIndustryKey === "otro" &&
        !data.companyIndustryName?.trim()
      ) {
        e.companyIndustryName = "Especifica el giro de la empresa";
      }
      setErrors(e);
      return Object.keys(e).length === 0;
    },
  }));

  const slug = data.companyName ? toSlug(data.companyName) : "";

  const { Country, State, City } = useGeoData({
    cities: Boolean(data.country && data.state),
  });

  const countryOptions = useMemo(
    () =>
      Country
        ? Country.getAllCountries().map((c) => ({
            value: c.isoCode,
            label: c.name,
          }))
        : [],
    [Country],
  );

  const stateOptions = useMemo(
    () =>
      State && data.country
        ? State.getStatesOfCountry(data.country).map((s) => ({
            value: s.isoCode,
            label: s.name,
          }))
        : [],
    [State, data.country],
  );

  const cityOptions = useMemo(
    () =>
      City && data.country && data.state
        ? City.getCitiesOfState(data.country, data.state).map((c) => ({
            value: c.name,
            label: c.name,
          }))
        : [],
    [City, data.country, data.state],
  );

  function handleCountryChange(val) {
    onChange({ country: val, state: "", city: "" });
  }

  function handleStateChange(val) {
    onChange({ state: val, city: "" });
  }

  function handleIndustryChange(val) {
    const selected = INDUSTRY_OPTIONS.find((option) => option.value === val);
    onChange({
      companyIndustryKey: val,
      companyIndustryName: val === "otro" ? "" : selected?.label || "",
    });
  }

  return (
    <div>
      <div className="space-y-4">
        <div className="flex flex-col gap-4 rounded-2xl border border-foreground/10 bg-foreground/2 px-5 py-5">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-(--brand-primary)" />
            <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
              Datos generales
            </span>
          </div>
          <TextField
            id="companyName"
            label="Nombre comercial"
            required
            icon={Building2}
            value={data.companyName}
            onChange={(e) => onChange({ companyName: e.target.value })}
            placeholder="Acme SA de CV"
            error={errors.companyName}
            validate={(v) =>
              !v || v.length < 2 ? "Minimo 2 caracteres" : null
            }
            hint={
              slug && !errors.companyName ? `Identificador: ${slug}` : undefined
            }
          />
          <TextField
            id="legalName"
            label="Razon social"
            icon={FileText}
            value={data.legalName || ""}
            onChange={(e) => onChange({ legalName: e.target.value })}
            placeholder="ACME SOCIEDAD ANONIMA DE CAPITAL VARIABLE"
            hint="Nombre legal registrado ante el SAT u organismo equivalente"
          />
          <div className="grid grid-cols-2 gap-3">
            <SelectField
              id="companyType"
              label="Forma legal"
              options={COMPANY_TYPES}
              placeholder="Seleccionar..."
              value={data.companyType || ""}
              onValueChange={(v) =>
                onChange({ companyType: v, companyTypeName: "" })
              }
            />
            <SelectField
              id="companySize"
              label="Tamano"
              options={COMPANY_SIZES}
              placeholder="Seleccionar..."
              value={data.companySize || ""}
              onValueChange={(v) => onChange({ companySize: v })}
            />
          </div>
          <ComboboxField
            id="companyIndustryKey"
            label="Giro de empresa"
            options={INDUSTRY_OPTIONS}
            value={data.companyIndustryKey || ""}
            onChange={handleIndustryChange}
            placeholder="Seleccionar giro..."
            searchPlaceholder="Buscar giro..."
            emptyText="Sin coincidencias"
          />
          {data.companyIndustryKey === "otro" && (
            <TextField
              id="companyIndustryName"
              label="Especificar giro"
              value={data.companyIndustryName || ""}
              error={errors.companyIndustryName}
              onChange={(e) =>
                onChange({ companyIndustryName: e.target.value })
              }
              placeholder="Ej. Consultoria ambiental"
            />
          )}
          {data.companyType === "otro" && (
            <TextField
              id="companyTypeName"
              label="Especificar forma legal"
              value={data.companyTypeName || ""}
              onChange={(e) => onChange({ companyTypeName: e.target.value })}
              placeholder="Describe la forma legal"
            />
          )}
        </div>

        <div className="flex flex-col gap-4 rounded-2xl border border-foreground/10 bg-foreground/2 px-5 py-5">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-(--brand-primary)" />
            <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
              Datos fiscales
            </span>
          </div>
          <TextField
            id="rfc"
            label="RFC"
            icon={Hash}
            value={data.rfc || ""}
            onChange={(e) => onChange({ rfc: e.target.value.toUpperCase() })}
            placeholder="ACM920101AAA"
            hint="RFC del contribuyente (12 o 13 caracteres)"
            maxLength={13}
          />
        </div>

        <div className="flex flex-col gap-4 rounded-2xl border border-foreground/10 bg-foreground/2 px-5 py-5">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-(--brand-primary)" />
            <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
              Domicilio
            </span>
          </div>
          <ComboboxField
            id="country"
            label="Pais"
            icon={MapPin}
            options={countryOptions}
            value={data.country || ""}
            onChange={handleCountryChange}
            placeholder="Seleccionar pais..."
            searchPlaceholder="Buscar pais..."
          />
          {stateOptions.length > 0 && (
            <ComboboxField
              id="state"
              label="Estado / Provincia"
              options={stateOptions}
              value={data.state || ""}
              onChange={handleStateChange}
              placeholder="Seleccionar estado..."
              searchPlaceholder="Buscar estado..."
            />
          )}
          {cityOptions.length > 0 && (
            <ComboboxField
              id="city"
              label="Ciudad / Municipio"
              options={cityOptions}
              value={data.city || ""}
              onChange={(val) => onChange({ city: val })}
              placeholder="Seleccionar ciudad..."
              searchPlaceholder="Buscar ciudad..."
              minSearchLength={2}
            />
          )}
          {data.state && cityOptions.length === 0 && (
            <TextField
              id="city"
              label="Ciudad / Municipio"
              value={data.city || ""}
              onChange={(e) => onChange({ city: e.target.value })}
              placeholder="Nombre de la ciudad"
            />
          )}
          <TextField
            id="colony"
            label="Colonia / Fraccionamiento"
            value={data.colony || ""}
            onChange={(e) => onChange({ colony: e.target.value })}
            placeholder="Col. Centro"
          />
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <TextField
                id="street"
                label="Calle"
                value={data.street || ""}
                onChange={(e) => onChange({ street: e.target.value })}
                placeholder="Av. Reforma"
              />
            </div>
            <TextField
              id="extNumber"
              label="Numero ext."
              value={data.extNumber || ""}
              onChange={(e) => onChange({ extNumber: e.target.value })}
              placeholder="123"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <TextField
              id="intNumber"
              label="Numero int."
              value={data.intNumber || ""}
              onChange={(e) => onChange({ intNumber: e.target.value })}
              placeholder="Piso 4 (opcional)"
            />
            <TextField
              id="postalCode"
              label="Codigo postal"
              value={data.postalCode || ""}
              onChange={(e) => onChange({ postalCode: e.target.value })}
              placeholder="06600"
            />
          </div>
        </div>

        <div className="flex flex-col gap-4 rounded-2xl border border-foreground/10 bg-foreground/2 px-5 py-5">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-(--brand-primary)" />
            <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
              Contacto
            </span>
          </div>
          <TextField
            id="contactEmail"
            label="Correo de contacto"
            type="email"
            value={data.contactEmail || ""}
            onChange={(e) => onChange({ contactEmail: e.target.value })}
            placeholder="contacto@miempresa.com"
          />
          <div className="grid grid-cols-2 gap-3">
            <TextField
              id="phone"
              label="Telefono"
              type="tel"
              value={data.phone || ""}
              onChange={(e) => onChange({ phone: e.target.value })}
              placeholder="+52 55 1234 5678"
            />
            <TextField
              id="website"
              label="Sitio web"
              type="url"
              value={data.website || ""}
              onChange={(e) => onChange({ website: e.target.value })}
              placeholder="https://miempresa.com"
            />
          </div>
        </div>
      </div>
    </div>
  );
});
