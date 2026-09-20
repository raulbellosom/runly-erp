import { companyFetch } from '../../../lib/companyFetch.js'
// apps/desktop/src/modules/runly.website/screens/WebsiteWizard.jsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  defineTheme,
  defaultTheme,
  serializePage,
} from "@raulbellosom/atlas-web-builder";
import { Globe, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../../auth/AuthProvider.jsx";
import { getApiUrl } from "../../../lib/runtimeConfig.js";
import { WizardStepMode } from "./wizard/WizardStepMode.jsx";
import { WizardStepInfo } from "./wizard/WizardStepInfo.jsx";
import { WizardStepType } from "./wizard/WizardStepType.jsx";
import { WizardStepIdentity } from "./wizard/WizardStepIdentity.jsx";
import { WizardStepTemplate } from "./wizard/WizardStepTemplate.jsx";

async function apiFetch(path, token, options = {}) {
  const res = await companyFetch(`${getApiUrl()}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// Steps for each mode
const STEPS_WEB = ["mode", "info", "type", "identity", "template"];
const STEPS_ZIP = ["mode", "info"];

const STEP_META = {
  mode: { n: 1, label: "Modo" },
  info: { n: 2, label: "Informacion" },
  type: { n: 3, label: "Tipo de sitio" },
  identity: { n: 4, label: "Identidad" },
  template: { n: 5, label: "Plantilla" },
};

export default function WebsiteWizard() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const token = session?.access_token;
  const queryClient = useQueryClient();

  const [stepIdx, setStepIdx] = useState(0);
  const [data, setData] = useState({
    mode: null,
    info: { name: "", domain: "", giro: "", description: "" },
    siteType: "website",
    identity: {
      primaryColor: "#4F46E5",
      bgColor: "#FFFFFF",
      font: "Inter",
      logoFile: null,
      useCompanyLogo: false,
    },
    template: null,
    selectedPages: [],
  });

  const steps = data.mode === "zip" ? STEPS_ZIP : STEPS_WEB;
  const currentStep = steps[stepIdx];

  const brandingQuery = useQuery({
    queryKey: ["company-branding-wizard"],
    queryFn: () => apiFetch("/company/branding", token),
    enabled: Boolean(token),
    staleTime: 60_000,
  });
  const companyLogoUrl = brandingQuery.data?.data?.logoUrl ?? null;

  const createMutation = useMutation({
    onMutate: () => ({ toastId: toast.loading('Creando sitio...') }),
    mutationFn: async (finalData) => {
      // 1. Create site
      const siteRes = await apiFetch("/website/site", token, {
        method: "POST",
        body: JSON.stringify({
          name: finalData.info.name,
          domain: finalData.info.domain || undefined,
          siteType: finalData.siteType,
        }),
      });
      const site = siteRes.data ?? siteRes;

      // 2. Store giro + buildMode in settings via PATCH
      await apiFetch(`/website/site/${site.id}`, token, {
        method: "PATCH",
        body: JSON.stringify({
          settings: {
            giro: finalData.info.giro || null,
            buildMode: finalData.mode,
          },
        }),
      });

      if (finalData.mode === "zip") {
        await apiFetch(`/website/sites/${site.id}`, token, {
          method: "PATCH",
          body: JSON.stringify({ sourceType: "dist" }),
        });
        return { siteId: site.id, firstPageId: null, mode: "zip" };
      }

      // 3. Create theme
      const themeTokens = {
        ...defaultTheme.tokens,
        color: {
          ...defaultTheme.tokens?.color,
          primary: finalData.identity.primaryColor,
          bg: finalData.identity.bgColor,
        },
      };
      const builtTheme = defineTheme({
        ...defaultTheme,
        id: "atlas-site",
        name: "Site Theme",
        tokens: themeTokens,
      });
      await apiFetch("/website/theme", token, {
        method: "POST",
        body: JSON.stringify({
          siteId: site.id,
          name: "Site Theme",
          tokens: builtTheme.tokens,
          typography: finalData.identity.font,
        }),
      });

      // 4. Upload custom logo
      let logoFileId = null;
      if (finalData.identity.logoFile) {
        const formData = new FormData();
        formData.append("file", finalData.identity.logoFile);
        formData.append("moduleKey", "runly.website");
        formData.append("entityType", "WebsiteSite");
        const uploadRes = await companyFetch(`${getApiUrl()}/files/upload`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });
        if (uploadRes.ok) {
          const uploadData = await uploadRes.json();
          logoFileId = uploadData.data?.id ?? null;
        } else {
          toast.warning(
            "No se pudo subir el logo. Podras subirlo despues desde Configuracion.",
          );
        }
      }
      if (logoFileId || finalData.identity.useCompanyLogo) {
        await apiFetch(`/website/site/${site.id}`, token, {
          method: "PATCH",
          body: JSON.stringify({
            settings: {
              logoFileId,
              useCompanyLogo: finalData.identity.useCompanyLogo && !logoFileId,
              giro: finalData.info.giro || null,
              buildMode: finalData.mode,
            },
          }),
        });
      }

      // 5. Create pages from template
      // saveDraftSchema expects builderData (camelCase)
      let firstPageId = null;
      if (finalData.template) {
        const pagesToCreate = finalData.template.pages.filter((p) =>
          finalData.selectedPages.includes(p.id),
        );
        for (const p of pagesToCreate) {
          const rawSlug =
            p.routePath.replace(/^\//, "").replace(/[^a-z0-9-]/g, "-") ||
            "inicio";
          const pageRes = await apiFetch("/website/pages", token, {
            method: "POST",
            body: JSON.stringify({
              siteId: site.id,
              title: p.label,
              slug: rawSlug,
              routePath: p.routePath,
            }),
          });
          const created = pageRes.data ?? pageRes;
          if (!firstPageId) firstPageId = created.id;
          if (p.page) {
            await apiFetch(`/website/pages/${created.id}/draft`, token, {
              method: "POST",
              body: JSON.stringify({ builderData: serializePage(p.page) }),
            });
          }
        }
      }

      return { siteId: site.id, firstPageId, mode: "web_builder" };
    },
    onSuccess: ({ firstPageId, mode }, _vars, ctx) => {
      toast.success("Sitio creado correctamente", { id: ctx.toastId });
      queryClient.invalidateQueries({ queryKey: ["website-site"] });
      if (mode === "zip") {
        navigate("/app/m/runly.website/settings");
      } else if (firstPageId) {
        navigate(`/app/m/runly.website/pages/${firstPageId}/editor`);
      } else {
        navigate("/app/m/runly.website/pages");
      }
    },
    onError: (err, _vars, ctx) => toast.error(err.message, { id: ctx.toastId }),
  });

  function advance(stepData) {
    const key = currentStep;
    const newData = {
      ...data,
      ...(key === "mode" ? { mode: stepData } : {}),
      ...(key === "info" ? { info: stepData } : {}),
      ...(key === "type" ? { siteType: stepData } : {}),
      ...(key === "identity" ? { identity: stepData } : {}),
      ...(key === "template" ? stepData : {}),
    };
    setData(newData);

    const newSteps = newData.mode === "zip" ? STEPS_ZIP : STEPS_WEB;
    const nextIdx = stepIdx + 1;

    if (nextIdx >= newSteps.length) {
      createMutation.mutate(newData);
    } else {
      setStepIdx(nextIdx);
    }
  }

  function back() {
    setStepIdx((i) => Math.max(0, i - 1));
  }

  const displaySteps = data.mode === "zip" ? STEPS_ZIP : STEPS_WEB;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background flex items-center justify-center p-6">
      <button
        type="button"
        onClick={() => navigate("/app/home")}
        className="fixed top-4 right-4 z-10 p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        aria-label="Cerrar"
      >
        <X className="w-5 h-5" />
      </button>
      <div className="relative w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4 shadow-lg bg-primary">
            <Globe className="w-7 h-7 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-bold text-foreground tracking-tight">
            Nuevo sitio web
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Configura tu presencia digital
          </p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center mb-8">
          {displaySteps.map((s, i) => {
            const meta = STEP_META[s];
            const done = i < stepIdx;
            const active = i === stepIdx;
            return (
              <div key={s} className="flex items-center">
                <div className="flex flex-col items-center gap-1">
                  <div
                    className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-all shadow-sm ${
                      done
                        ? "bg-green-500 text-white"
                        : active
                          ? "bg-primary text-white"
                          : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {done ? (
                      <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4">
                        <path
                          d="M3 8l3.5 3.5L13 5"
                          stroke="white"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : (
                      meta.n
                    )}
                  </div>
                  <span
                    className={`text-xs font-medium whitespace-nowrap ${active ? "text-primary" : "text-muted-foreground"}`}
                  >
                    {meta.label}
                  </span>
                </div>
                {i < displaySteps.length - 1 && (
                  <div
                    className={`w-16 h-0.5 mx-2 mb-5 rounded-full transition-all duration-500 ${done ? "bg-green-500" : "bg-border"}`}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Step card */}
        <div className="bg-card rounded-3xl shadow-xl border border-border overflow-hidden">
          <div className="p-8">
            {/* Step title */}
            {currentStep === "mode" && (
              <div className="mb-6">
                <h2 className="text-xl font-bold text-foreground">
                  Modo de construccion
                </h2>
                <p className="text-muted-foreground text-sm mt-0.5">
                  Como vas a construir tu sitio
                </p>
              </div>
            )}
            {currentStep === "info" && (
              <div className="mb-6">
                <h2 className="text-xl font-bold text-foreground">
                  Informacion del sitio
                </h2>
                <p className="text-muted-foreground text-sm mt-0.5">
                  Datos basicos de tu sitio web
                </p>
              </div>
            )}
            {currentStep === "type" && (
              <div className="mb-6">
                <h2 className="text-xl font-bold text-foreground">
                  Tipo de sitio
                </h2>
                <p className="text-muted-foreground text-sm mt-0.5">
                  Elige el proposito principal
                </p>
              </div>
            )}
            {currentStep === "identity" && (
              <div className="mb-6">
                <h2 className="text-xl font-bold text-foreground">
                  Identidad visual
                </h2>
                <p className="text-muted-foreground text-sm mt-0.5">
                  Logo, colores y tipografia
                </p>
              </div>
            )}
            {currentStep === "template" && (
              <div className="mb-6">
                <h2 className="text-xl font-bold text-foreground">
                  Elige una plantilla
                </h2>
                <p className="text-muted-foreground text-sm mt-0.5">
                  O empieza desde cero
                </p>
              </div>
            )}

            {/* Step content */}
            {currentStep === "mode" && (
              <WizardStepMode value={data.mode} onNext={advance} />
            )}
            {currentStep === "info" && (
              <WizardStepInfo
                defaultValues={data.info}
                onNext={advance}
                onBack={back}
              />
            )}
            {currentStep === "type" && (
              <WizardStepType
                value={data.siteType}
                onNext={advance}
                onBack={back}
              />
            )}
            {currentStep === "identity" && (
              <WizardStepIdentity
                defaultValues={data.identity}
                companyLogoUrl={companyLogoUrl}
                onNext={advance}
                onBack={back}
              />
            )}
            {currentStep === "template" && (
              <WizardStepTemplate
                onNext={advance}
                onBack={back}
                isPending={createMutation.isPending}
              />
            )}
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6">
          Puedes editar toda la configuracion despues desde el panel
        </p>
      </div>
    </div>
  );
}
