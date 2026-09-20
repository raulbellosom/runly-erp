import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  MapPin,
  Palette,
  ArrowRight,
  Hash,
  FileText,
  Mail,
  Phone,
  Globe,
  Factory,
  Users,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../auth/AuthProvider";
import { runly } from "../../../lib/runly";

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

const COMPANY_SIZE_LABELS = {
  micro: "Micro",
  small: "Pequena",
  medium: "Mediana",
  large: "Grande",
  corporate: "Corporativo",
};

const INDUSTRY_LABELS = {
  tecnologia: "Tecnologia",
  software: "Software",
  manufactura: "Manufactura",
  retail: "Retail",
  salud: "Salud",
  educacion: "Educacion",
  logistica: "Logistica",
  construccion: "Construccion",
  servicios_profesionales: "Servicios profesionales",
  contabilidad: "Contabilidad",
  financiero: "Financiero",
  agroindustria: "Agroindustria",
  hospitalidad: "Hospitalidad",
  marketing: "Marketing",
  inmobiliario: "Inmobiliario",
  mineria: "Mineria",
  ong: "ONG",
  otro: "Otro",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function InfoRow({ icon: Icon, label, value }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2.5 min-w-0">
      <div className="mt-0.5 shrink-0 h-4 w-4 text-[hsl(var(--muted-foreground))]">
        <Icon size={14} />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] text-[hsl(var(--muted-foreground))] leading-none mb-0.5">
          {label}
        </p>
        <p className="text-sm text-[hsl(var(--foreground))] font-medium truncate leading-snug">
          {value}
        </p>
      </div>
    </div>
  );
}

function SectionCard({
  icon: Icon,
  color,
  title,
  description,
  children,
  cta,
  onClick,
  empty,
}) {
  return (
    <div className="group relative flex flex-col rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden transition-shadow duration-200 hover:shadow-md min-h-[420px]">
      {/* Color accent line */}
      <div className="h-0.5 w-full" style={{ background: color }} />

      <div className="flex flex-col flex-1 p-6 gap-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0"
              style={{ backgroundColor: `${color}18` }}
            >
              <Icon size={17} style={{ color }} />
            </div>
            <div>
              <p className="text-sm font-semibold text-[hsl(var(--foreground))] leading-tight">
                {title}
              </p>
              <p className="text-[11px] text-[hsl(var(--muted-foreground))] leading-tight mt-0.5">
                {description}
              </p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0">
          {empty ? (
            <div className="flex items-center gap-2 rounded-lg border border-dashed border-[hsl(var(--border))] px-3 py-2.5">
              <AlertCircle
                size={13}
                className="text-[hsl(var(--muted-foreground))] shrink-0"
              />
              <p className="text-xs text-[hsl(var(--muted-foreground))]">
                Sin informacion configurada
              </p>
            </div>
          ) : (
            <div className="space-y-3.5">{children}</div>
          )}
        </div>

        {/* CTA */}
        <button
          onClick={onClick}
          className="flex items-center gap-1.5 text-xs font-medium transition-colors duration-150 mt-auto pt-1 border-t border-[hsl(var(--border))] self-stretch"
          style={{ color }}
        >
          <span className="pt-3">{cta}</span>
          <ChevronRight
            size={12}
            className="mt-3 transition-transform duration-150 group-hover:translate-x-0.5"
          />
        </button>
      </div>
    </div>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

const MODULE_COLOR = "#ec4899";

export default function CompanyOverview() {
  const { session } = useAuth();
  const token = session?.access_token;
  const navigate = useNavigate();

  const profileQuery = useQuery({
    queryKey: ["company-profile"],
    queryFn: () => runly.company.getProfile(token),
    enabled: Boolean(token),
    staleTime: 0,
  });
  const addressQuery = useQuery({
    queryKey: ["company-address"],
    queryFn: () => runly.company.getAddress(token),
    enabled: Boolean(token),
  });
  const brandingQuery = useQuery({
    queryKey: ["company-branding"],
    queryFn: () => runly.company.getBranding(token),
    enabled: Boolean(token),
  });

  const profile = profileQuery.data?.data ?? null;
  const address = addressQuery.data?.data ?? null;
  const branding = brandingQuery.data?.data ?? null;

  const isLoading =
    profileQuery.isLoading || addressQuery.isLoading || brandingQuery.isLoading;

  const companyName = profile?.name || "Empresa sin nombre";
  const primaryColor = branding?.primaryColor ?? MODULE_COLOR;
  const logoUrl = branding?.logoUrl ?? null;
  const companyTypeLabel =
    COMPANY_TYPE_LABELS[profile?.companyType] ||
    profile?.companyTypeName ||
    profile?.companyType ||
    null;
  const companySizeLabel =
    COMPANY_SIZE_LABELS[profile?.companySize] || profile?.companySize || null;
  const industryLabel =
    INDUSTRY_LABELS[profile?.industryKey] ||
    profile?.industryName ||
    profile?.industryKey ||
    null;

  // Address one-liner
  const addressLine = [address?.colony, address?.city, address?.state, address?.country]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="flex flex-col min-h-full">
      <div className="flex-1 p-4 md:p-6 lg:p-8 space-y-8 w-full max-w-[1380px]">
        {/* ── Hero identity card ──────────────────────────────────────────── */}
        <div
          className="relative rounded-2xl overflow-hidden border border-[hsl(var(--border))]"
          style={{
            background: `linear-gradient(135deg, ${primaryColor}10 0%, ${primaryColor}04 100%)`,
          }}
        >
          {/* Decorative gradient blob */}
          <div
            className="absolute top-0 right-0 w-64 h-64 rounded-full opacity-10 -translate-y-1/3 translate-x-1/3 pointer-events-none"
            style={{
              background: `radial-gradient(circle, ${primaryColor} 0%, transparent 70%)`,
            }}
          />

          <div className="relative flex flex-col sm:flex-row items-start sm:items-center gap-5 p-6 md:p-8">
            {/* Logo / avatar */}
            <div
              className="relative shrink-0 h-20 w-20 rounded-2xl overflow-hidden border-2 flex items-center justify-center"
              style={{
                borderColor: `${primaryColor}30`,
                background: `${primaryColor}10`,
              }}
            >
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt={companyName}
                  className="w-full h-full object-contain p-1"
                />
              ) : isLoading ? (
                <div className="w-full h-full animate-pulse bg-[hsl(var(--muted))]" />
              ) : (
                <Building2 size={32} style={{ color: primaryColor }} />
              )}
            </div>

            {/* Identity info */}
            <div className="flex-1 min-w-0 space-y-1">
              {isLoading ? (
                <>
                  <div className="h-7 w-48 rounded-lg bg-[hsl(var(--muted))] animate-pulse" />
                  <div className="h-4 w-32 rounded-md bg-[hsl(var(--muted))] animate-pulse" />
                </>
              ) : (
                <>
                  <h1 className="text-2xl md:text-3xl font-bold text-[hsl(var(--foreground))] leading-tight truncate">
                    {companyName}
                  </h1>
                  {profile?.legalName && profile.legalName !== profile.name && (
                    <p className="text-sm text-[hsl(var(--muted-foreground))] leading-snug">
                      {profile.legalName}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2 pt-1">
                    {profile?.rfc && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-mono font-medium px-2 py-0.5 rounded-full border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted))]/40">
                        <Hash size={9} /> {profile.rfc}
                      </span>
                    )}
                    {profile?.industryKey && (
                      <span
                        className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full"
                        style={{
                          background: `${primaryColor}15`,
                          color: primaryColor,
                        }}
                      >
                        <Factory size={9} />{" "}
                        {industryLabel}
                      </span>
                    )}
                    {profile?.companySize && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted))]/40">
                        <Users size={9} /> {companySizeLabel}
                      </span>
                    )}
                    {!profile?.rfc &&
                      !profile?.industryKey &&
                      !profile?.companySize && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-[hsl(var(--muted-foreground))] px-2 py-0.5 rounded-full border border-dashed border-[hsl(var(--border))]">
                          Completa el perfil
                        </span>
                      )}
                  </div>
                </>
              )}
            </div>

          </div>
        </div>

        {/* ── Section cards grid ──────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Profile card */}
          <SectionCard
            icon={Building2}
            color={primaryColor}
            title="Perfil"
            description="Datos legales e identificacion"
            cta="Editar perfil"
            onClick={() => navigate("/app/m/runly.company/company")}
            empty={!profile?.name && !isLoading}
          >
            {isLoading ? (
              <div className="space-y-3">
                <div className="h-10 w-full rounded-lg bg-[hsl(var(--muted))] animate-pulse" />
                <div className="h-10 w-full rounded-lg bg-[hsl(var(--muted))] animate-pulse" />
              </div>
            ) : (
              <>
                <InfoRow
                  icon={FileText}
                  label="Razon social"
                  value={profile?.legalName}
                />
                <InfoRow
                  icon={Building2}
                  label="Tipo"
                  value={companyTypeLabel}
                />
                <InfoRow
                  icon={Mail}
                  label="Correo"
                  value={profile?.contactEmail}
                />
                <InfoRow icon={Phone} label="Telefono" value={profile?.phone} />
                <InfoRow
                  icon={Globe}
                  label="Sitio web"
                  value={profile?.website}
                />
              </>
            )}
          </SectionCard>

          {/* Address card */}
          <SectionCard
            icon={MapPin}
            color={primaryColor}
            title="Direccion"
            description="Domicilio fiscal y ubicacion"
            cta="Editar direccion"
            onClick={() => navigate("/app/m/runly.company/company/address")}
            empty={!addressLine && !isLoading}
          >
            {isLoading ? (
              <div className="space-y-3">
                <div className="h-10 w-full rounded-lg bg-[hsl(var(--muted))] animate-pulse" />
                <div className="h-10 w-full rounded-lg bg-[hsl(var(--muted))] animate-pulse" />
              </div>
            ) : (
              <>
                <InfoRow
                  icon={MapPin}
                  label="Ubicacion"
                  value={addressLine || null}
                />
                <InfoRow
                  icon={MapPin}
                  label="Colonia"
                  value={address?.colony}
                />
                <InfoRow
                  icon={FileText}
                  label="Calle"
                  value={address?.street}
                />
                {(address?.extNumber || address?.intNumber) && (
                  <InfoRow
                    icon={Hash}
                    label="Numero"
                    value={[address?.extNumber, address?.intNumber]
                      .filter(Boolean)
                      .join(" / ")}
                  />
                )}
                <InfoRow
                  icon={Hash}
                  label="Codigo postal"
                  value={address?.postalCode}
                />
              </>
            )}
          </SectionCard>

          {/* Branding card */}
          <SectionCard
            icon={Palette}
            color={primaryColor}
            title="Marca visual"
            description="Logo y paleta de colores"
            cta="Editar marca"
            onClick={() => navigate("/app/m/runly.company/company/branding")}
            empty={!branding && !isLoading}
          >
            {isLoading ? (
              <div className="space-y-3">
                <div className="h-16 w-full rounded-lg bg-[hsl(var(--muted))] animate-pulse" />
              </div>
            ) : (
              <>
                {/* Logo preview */}
                {logoUrl ? (
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-12 rounded-lg border border-[hsl(var(--border))] bg-white flex items-center justify-center overflow-hidden shrink-0">
                      <img
                        src={logoUrl}
                        alt="Logo"
                        className="max-w-full max-h-full object-contain"
                      />
                    </div>
                    <div>
                      <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                        Logotipo
                      </p>
                      <p className="text-xs font-medium text-[hsl(var(--foreground))]">
                        Configurado
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <div
                      className="h-12 w-12 rounded-lg flex items-center justify-center shrink-0 border border-dashed"
                      style={{
                        borderColor: `${primaryColor}40`,
                        background: `${primaryColor}08`,
                      }}
                    >
                      <Palette
                        size={18}
                        style={{ color: primaryColor, opacity: 0.5 }}
                      />
                    </div>
                    <div>
                      <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                        Logotipo
                      </p>
                      <p className="text-xs text-[hsl(var(--muted-foreground))]">
                        Sin logo cargado
                      </p>
                    </div>
                  </div>
                )}
                {/* Color */}
                <div className="flex items-center gap-2.5">
                  <div
                    className="h-6 w-6 rounded-lg border border-white shadow-sm shrink-0"
                    style={{ background: primaryColor }}
                  />
                  <div>
                    <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                      Color principal
                    </p>
                    <p className="text-xs font-mono font-semibold text-[hsl(var(--foreground))]">
                      {primaryColor.toUpperCase()}
                    </p>
                  </div>
                </div>
              </>
            )}
          </SectionCard>
        </div>

        {/* ── Status bar ──────────────────────────────────────────────────── */}
        {!isLoading && (
          <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 px-5 py-4">
            <div className="flex flex-wrap gap-5">
              {[
                {
                  ok: Boolean(
                    profile?.name && profile?.legalName && profile?.rfc,
                  ),
                  label: "Datos legales",
                  path: "/app/m/runly.company/company",
                },
                {
                  ok: Boolean(address?.country && address?.city),
                  label: "Direccion",
                  path: "/app/m/runly.company/company/address",
                },
                {
                  ok: Boolean(branding?.logoFileId),
                  label: "Logotipo",
                  path: "/app/m/runly.company/company/branding",
                },
              ].map(({ ok, label, path }) => (
                <button
                  key={label}
                  onClick={() => navigate(path)}
                  className="flex items-center gap-2 text-xs font-medium transition-colors duration-150 hover:opacity-80 cursor-pointer"
                >
                  {ok ? (
                    <CheckCircle2 size={13} className="text-emerald-500" />
                  ) : (
                    <AlertCircle size={13} className="text-amber-400" />
                  )}
                  <span
                    className={
                      ok
                        ? "text-[hsl(var(--foreground))]"
                        : "text-[hsl(var(--muted-foreground))]"
                    }
                  >
                    {label}
                  </span>
                  {!ok && (
                    <ArrowRight
                      size={10}
                      className="text-[hsl(var(--muted-foreground))]"
                    />
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
