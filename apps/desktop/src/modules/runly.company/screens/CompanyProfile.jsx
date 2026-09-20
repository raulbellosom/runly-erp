import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Card,
  ComboboxField,
  ErrorState,
  PageHeader,
  SelectField,
  Skeleton,
  TextField,
} from "@runly/ui";
import {
  Building2,
  FileText,
  Hash,
  Factory,
  Users,
  Mail,
  Phone,
  Globe,
  Briefcase,
  Link,
  Copy,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../../auth/AuthProvider";
import { runly } from "../../../lib/runly";

// ─── Constants ───────────────────────────────────────────────────────────────

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
  { value: "manufactura", label: "Manufactura" },
  { value: "retail", label: "Retail" },
  { value: "salud", label: "Salud" },
  { value: "educacion", label: "Educacion" },
  { value: "logistica", label: "Logistica" },
  { value: "construccion", label: "Construccion" },
  { value: "servicios_profesionales", label: "Servicios profesionales" },
  { value: "contabilidad", label: "Contabilidad" },
  { value: "financiero", label: "Financiero" },
  { value: "agroindustria", label: "Agroindustria" },
  { value: "hospitalidad", label: "Hospitalidad" },
  { value: "marketing", label: "Marketing" },
  { value: "inmobiliario", label: "Inmobiliario" },
  { value: "mineria", label: "Mineria" },
  { value: "ong", label: "ONG" },
  { value: "otro", label: "Otro (especificar)" },
];

// ─── Screen ───────────────────────────────────────────────────────────────────

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeOptionValue(value, options, aliases = {}) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const exact = options.find((option) => option.value === raw);
  if (exact) return exact.value;

  const normalizedRaw = normalizeText(raw);
  if (!normalizedRaw) return "";
  if (Object.prototype.hasOwnProperty.call(aliases, normalizedRaw)) {
    return aliases[normalizedRaw];
  }

  const normalizedMatch = options.find((option) => {
    if (normalizeText(option.value) === normalizedRaw) return true;
    const label = normalizeText(option.label);
    if (label === normalizedRaw) return true;
    const shortLabel = normalizeText(option.label.split("-")[0] ?? "");
    return shortLabel === normalizedRaw;
  });
  return normalizedMatch?.value ?? raw;
}

const COMPANY_TYPE_ALIASES = {
  "sa de cv": "sa_de_cv",
  "sociedad anonima de capital variable": "sa_de_cv",
  "srl de cv": "srl_de_cv",
  "sociedad de responsabilidad limitada de capital variable": "srl_de_cv",
  "sociedad anonima": "sa",
  "sociedad de responsabilidad limitada": "srl",
  "sociedad cooperativa": "sc",
  "asociacion civil": "ac",
  "sapi de cv": "sapi_de_cv",
};

const COMPANY_SIZE_ALIASES = {
  "micro 1 a 10 empleados": "micro",
  "micro 1 10": "micro",
  "pequena 11 a 50 empleados": "small",
  "small 11 a 50 empleados": "small",
  "mediana 51 a 200 empleados": "medium",
  "medium 51 a 200 empleados": "medium",
  "grande 201 a 500 empleados": "large",
  "large 201 a 500 empleados": "large",
  "corporativo mas de 500 empleados": "corporate",
  "corporativo 500": "corporate",
};

export default function CompanyProfile() {
  const dirtyRef = useRef(false);
  const { session, userProfile } = useAuth();
  const token = session?.access_token;
  const queryClient = useQueryClient();
  const canManage = Boolean(
    userProfile?.isAdmin ||
      userProfile?.permissions?.includes("company.profile.update"),
  );

  const { data, isLoading } = useQuery({
    queryKey: ["company-profile"],
    queryFn: () => runly.company.getProfile(token),
    enabled: Boolean(token),
    // The app-wide default staleTime is 5 minutes, so remounting this screen
    // shortly after another screen already fetched "company-profile" served
    // that cached snapshot with no new request — stale companyType/companySize
    // kept showing as unselected even after a successful save elsewhere.
    staleTime: 0,
  });

  const [form, setForm] = useState({
    name: "",
    legalName: "",
    rfc: "",
    companyType: "",
    companyTypeName: "",
    industryKey: "",
    industryName: "",
    companySize: "",
    contactEmail: "",
    phone: "",
    website: "",
  });

  useEffect(() => {
    if (data?.data && !dirtyRef.current) {
      const nextCompanyType = normalizeOptionValue(
        data.data.companyType,
        COMPANY_TYPES,
        COMPANY_TYPE_ALIASES,
      );
      const nextCompanySize = normalizeOptionValue(
        data.data.companySize,
        COMPANY_SIZES,
        COMPANY_SIZE_ALIASES,
      );
      const nextIndustryKey = normalizeOptionValue(
        data.data.industryKey,
        INDUSTRY_OPTIONS,
      );
      setForm({
        name: data.data.name ?? "",
        legalName: data.data.legalName ?? "",
        rfc: data.data.rfc ?? "",
        companyType: nextCompanyType,
        companyTypeName: data.data.companyTypeName ?? "",
        industryKey: nextIndustryKey,
        industryName: data.data.industryName ?? "",
        companySize: nextCompanySize,
        contactEmail: data.data.contactEmail ?? "",
        phone: data.data.phone ?? "",
        website: data.data.website ?? "",
      });
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: (payload) => runly.company.updateProfile(payload, token),
    onSuccess: () => {
      dirtyRef.current = false;
      queryClient.invalidateQueries({ queryKey: ["company-profile"] });
      toast.success("Perfil de empresa actualizado.");
    },
    onError: (err) => {
      toast.error(err?.message ?? "No se pudo guardar el perfil.");
    },
  });

  function handleChange(key, value) {
    dirtyRef.current = true;
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error("El nombre de la empresa es obligatorio.");
      return;
    }
    saveMutation.mutate({
      ...form,
      companyType: normalizeOptionValue(
        form.companyType,
        COMPANY_TYPES,
        COMPANY_TYPE_ALIASES,
      ),
      companySize: normalizeOptionValue(
        form.companySize,
        COMPANY_SIZES,
        COMPANY_SIZE_ALIASES,
      ),
      industryKey: normalizeOptionValue(form.industryKey, INDUSTRY_OPTIONS),
    });
  }

  const disabled = !canManage || saveMutation.isPending;

  return (
    <div className="flex flex-col min-h-full">
      <div className="flex-1 p-4 md:p-6">
        <div className="space-y-6">
          <PageHeader
            eyebrow="Empresa"
            title="Perfil de empresa"
            description="Informacion legal y de contacto de la organizacion."
          />

          {!canManage && (
            <ErrorState title="Perfil en modo lectura" description="Tu rol en esta empresa no permite editar el perfil." />
          )}

          <form
            onSubmit={handleSubmit}
            className="grid grid-cols-1 lg:grid-cols-[1fr_272px] gap-6 items-start"
          >
            {/* ── Left: form cards ─────────────────────────────── */}
            <div className="space-y-6">
              <Card className="p-6 space-y-5">
                <div className="flex items-center gap-2 pb-1 border-b border-[hsl(var(--border))]">
                  <Building2
                    size={14}
                    className="text-[hsl(var(--muted-foreground))]"
                  />
                  <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">
                    Identificacion
                  </h3>
                </div>

                {isLoading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-11 w-full" />
                    <Skeleton className="h-11 w-full" />
                    <Skeleton className="h-11 w-full" />
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <TextField
                        label="Nombre comercial"
                        value={form.name}
                        onChange={(e) => handleChange("name", e.target.value)}
                        disabled={disabled}
                        required
                        placeholder="Ej. Runly ERP"
                        icon={Building2}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <div className="flex items-end gap-2">
                        <div className="flex-1">
                          <TextField
                            label="Slug de empresa"
                            value={data?.data?.slug ?? ""}
                            disabled
                            icon={Link}
                            hint="Identificador unico para el SDK de tienda. Solo lectura."
                          />
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          disabled={!data?.data?.slug}
                          onClick={() => {
                            navigator.clipboard.writeText(data?.data?.slug ?? "");
                            toast.success("Slug copiado al portapapeles.");
                          }}
                          className="shrink-0 mb-4.5"
                          title="Copiar slug"
                        >
                          <Copy size={14} />
                        </Button>
                      </div>
                    </div>
                    <TextField
                      label="Razon social"
                      value={form.legalName}
                      onChange={(e) =>
                        handleChange("legalName", e.target.value)
                      }
                      disabled={disabled}
                      placeholder="Ej. Mi Empresa SA de CV"
                      icon={FileText}
                    />
                    <TextField
                      label="RFC"
                      value={form.rfc}
                      onChange={(e) => handleChange("rfc", e.target.value)}
                      disabled={disabled}
                      placeholder="Ej. ABCD123456EFG"
                      icon={Hash}
                    />
                    <SelectField
                      label="Tipo de empresa"
                      value={form.companyType}
                      onValueChange={(v) => handleChange("companyType", v)}
                      options={COMPANY_TYPES}
                      disabled={disabled}
                      placeholder="Selecciona un tipo"
                      icon={Briefcase}
                    />
                    {form.companyType === "otro" && (
                      <TextField
                        label="Especificar tipo de empresa"
                        value={form.companyTypeName}
                        onChange={(e) =>
                          handleChange("companyTypeName", e.target.value)
                        }
                        disabled={disabled}
                        placeholder="Describe el tipo"
                        icon={Briefcase}
                      />
                    )}
                    <ComboboxField
                      label="Industria"
                      value={form.industryKey}
                      onChange={(v) => handleChange("industryKey", v)}
                      options={INDUSTRY_OPTIONS}
                      disabled={disabled}
                      placeholder="Busca tu industria"
                      icon={Factory}
                    />
                    {form.industryKey === "otro" && (
                      <TextField
                        label="Especificar industria"
                        value={form.industryName}
                        onChange={(e) =>
                          handleChange("industryName", e.target.value)
                        }
                        disabled={disabled}
                        placeholder="Describe tu industria"
                        icon={Factory}
                      />
                    )}
                    <SelectField
                      label="Tamano de empresa"
                      value={form.companySize}
                      onValueChange={(v) => handleChange("companySize", v)}
                      options={COMPANY_SIZES}
                      disabled={disabled}
                      placeholder="Selecciona un tamano"
                      icon={Users}
                    />
                  </div>
                )}
              </Card>

              <Card className="p-6 space-y-5">
                <div className="flex items-center gap-2 pb-1 border-b border-[hsl(var(--border))]">
                  <Mail
                    size={14}
                    className="text-[hsl(var(--muted-foreground))]"
                  />
                  <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">
                    Contacto
                  </h3>
                </div>

                {isLoading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-11 w-full" />
                    <Skeleton className="h-11 w-full" />
                    <Skeleton className="h-11 w-full" />
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <TextField
                      label="Correo de contacto"
                      type="email"
                      value={form.contactEmail}
                      onChange={(e) =>
                        handleChange("contactEmail", e.target.value)
                      }
                      disabled={disabled}
                      placeholder="contacto@miempresa.com"
                      icon={Mail}
                    />
                    <TextField
                      label="Telefono"
                      type="tel"
                      value={form.phone}
                      onChange={(e) => handleChange("phone", e.target.value)}
                      disabled={disabled}
                      placeholder="+52 55 1234 5678"
                      icon={Phone}
                    />
                    <div className="sm:col-span-2">
                      <TextField
                        label="Sitio web"
                        type="url"
                        value={form.website}
                        onChange={(e) => handleChange("website", e.target.value)}
                        disabled={disabled}
                        placeholder="https://miempresa.com"
                        icon={Globe}
                      />
                    </div>
                  </div>
                )}
              </Card>

              {canManage && (
                <div className="flex justify-end">
                  <Button
                    type="submit"
                    disabled={saveMutation.isPending || isLoading}
                    loading={saveMutation.isPending}
                  >
                    Guardar perfil
                  </Button>
                </div>
              )}
            </div>

            {/* ── Right: live preview ───────────────────────────── */}
            <aside className="sticky top-6">
              <Card className="p-5 space-y-4">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
                  Vista previa
                </p>

                {/* Avatar + name */}
                <div className="flex items-center gap-3">
                  <div className="h-11 w-11 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/50 flex items-center justify-center shrink-0">
                    <Building2
                      size={20}
                      className="text-[hsl(var(--muted-foreground))]"
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[hsl(var(--foreground))] truncate leading-tight">
                      {form.name || (
                        <span className="text-[hsl(var(--muted-foreground))] font-normal">
                          Nombre de empresa
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-[hsl(var(--muted-foreground))] truncate leading-tight mt-0.5">
                      {form.legalName || "Razon social"}
                    </p>
                  </div>
                </div>

                <div className="border-t border-[hsl(var(--border))]" />

                {/* Identity rows */}
                <div className="space-y-2.5">
                  {[
                    { icon: Hash, label: "RFC", value: form.rfc },
                    {
                      icon: Briefcase,
                      label: "Tipo",
                      value: COMPANY_TYPES.find(
                        (t) => t.value === form.companyType,
                      )?.label,
                    },
                    {
                      icon: Factory,
                      label: "Industria",
                      value:
                        INDUSTRY_OPTIONS.find(
                          (i) => i.value === form.industryKey,
                        )?.label ??
                        (form.industryName || null),
                    },
                    {
                      icon: Users,
                      label: "Tamano",
                      value: COMPANY_SIZES.find(
                        (s) => s.value === form.companySize,
                      )?.label?.split(" - ")[0],
                    },
                  ].map(({ icon: Icon, label, value }) =>
                    value ? (
                      <div
                        key={label}
                        className="flex items-center gap-2 min-w-0"
                      >
                        <Icon
                          size={12}
                          className="shrink-0 text-[hsl(var(--muted-foreground))]"
                        />
                        <span className="text-[11px] text-[hsl(var(--muted-foreground))] shrink-0 w-14">
                          {label}
                        </span>
                        <span className="text-xs font-medium text-[hsl(var(--foreground))] truncate">
                          {value}
                        </span>
                      </div>
                    ) : null,
                  )}
                </div>

                {/* Contact rows */}
                {(form.contactEmail || form.phone || form.website) && (
                  <>
                    <div className="border-t border-[hsl(var(--border))]" />
                    <div className="space-y-2.5">
                      {[
                        {
                          icon: Mail,
                          label: "Email",
                          value: form.contactEmail,
                        },
                        { icon: Phone, label: "Tel", value: form.phone },
                        { icon: Globe, label: "Web", value: form.website },
                      ].map(({ icon: Icon, label, value }) =>
                        value ? (
                          <div
                            key={label}
                            className="flex items-center gap-2 min-w-0"
                          >
                            <Icon
                              size={12}
                              className="shrink-0 text-[hsl(var(--muted-foreground))]"
                            />
                            <span className="text-[11px] text-[hsl(var(--muted-foreground))] shrink-0 w-14">
                              {label}
                            </span>
                            <span className="text-xs font-medium text-[hsl(var(--foreground))] truncate">
                              {value}
                            </span>
                          </div>
                        ) : null,
                      )}
                    </div>
                  </>
                )}
              </Card>
            </aside>
          </form>
        </div>
      </div>
    </div>
  );
}
