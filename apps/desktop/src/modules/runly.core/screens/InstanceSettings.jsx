import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Card,
  ComboboxField,
  ErrorState,
  PageHeader,
  Skeleton,
  TextareaField,
  TextField,
} from "@runly/ui";
import { BellRing, Building2, Clock3, Coins, Mail, Settings } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../../auth/AuthProvider";
import { runly } from "../../../lib/runly";
import { RUNLY_DESKTOP_DOWNLOAD_URL, RUNLY_MOBILE_DOWNLOAD_URL } from "../../../lib/appConfig.js";
import { CURRENCY_OPTIONS, TIME_ZONE_OPTIONS } from "../../../lib/localeCatalogs";

function SettingsTabs() {
  const base = "px-4 py-2 text-sm font-medium rounded-lg transition-colors";
  const active = `${base} bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]`;
  const inactive = `${base} text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--accent))]/50`;
  return (
    <div className="flex gap-1 border-b border-[hsl(var(--border))] pb-3">
      <NavLink to="/app/m/runly.core/settings" end className={({ isActive }) => isActive ? active : inactive}>
        <Settings className="h-4 w-4 inline mr-1.5 -mt-0.5" />
        General
      </NavLink>
      <NavLink to="/app/m/runly.core/settings/smtp" className={({ isActive }) => isActive ? active : inactive}>
        <Mail className="h-4 w-4 inline mr-1.5 -mt-0.5" />
        SMTP
      </NavLink>
      <NavLink to="/app/m/runly.core/settings/webpush" className={({ isActive }) => isActive ? active : inactive}>
        <BellRing className="h-4 w-4 inline mr-1.5 -mt-0.5" />
        Web Push
      </NavLink>
    </div>
  );
}

export default function InstanceSettings() {
  const { session, userProfile } = useAuth();
  const token = session?.access_token;
  const canManage = Boolean(
    userProfile?.isAdmin || userProfile?.permissions?.includes("core.manage"),
  );
  const queryClient = useQueryClient();

  const configQuery = useQuery({
    queryKey: ["instance-config"],
    queryFn: () => runly.instanceConfig.get(token),
    enabled: Boolean(token),
  });

  const [form, setForm] = useState({
    instanceName: "",
    description: "",
    timeZone: "America/Mexico_City",
    currency: "MXN",
  });

  useEffect(() => {
    const data = configQuery.data?.data;
    if (!data) return;
    setForm({
      instanceName: data.instanceName ?? "",
      description: data.description ?? "",
      timeZone: data.timeZone ?? "America/Mexico_City",
      currency: data.currency ?? "MXN",
    });
  }, [configQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () => runly.instanceConfig.update(form, token),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["instance-config"] });
      if (form.instanceName) document.title = `${form.instanceName} — Runly ERP`
      toast.success("Configuración guardada");
    },
    onError: () => toast.error("No se pudo guardar la configuración"),
  });

  const isLoading = configQuery.isLoading;

  return (
    <div className="flex flex-col min-h-full">
      <div className="flex-1 p-4 md:p-6 space-y-6 max-w-3xl mx-auto w-full">
        <PageHeader
          eyebrow="Runly Core"
          title="Configuracion"
          description="Ajusta la configuracion general y las integraciones de tu instancia."
        />
        <SettingsTabs />

        {!canManage && (
          <ErrorState message="Necesitas permiso core.manage para modificar la configuracion de la instancia." />
        )}

        <Card className="p-0">
          <div className="px-4 py-3 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40 rounded-t-2xl">
            <p className="text-sm font-semibold">Ajustes generales</p>
          </div>
          <div className="p-4 space-y-4">
            {isLoading ? (
              <>
                <div className="space-y-2">
                  <Skeleton className="h-4 w-44" />
                  <Skeleton className="h-11 w-full rounded-lg" />
                </div>
                <div className="space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-20 w-full rounded-lg" />
                </div>
                <div className="space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-11 w-full rounded-lg" />
                </div>
                <div className="space-y-2">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-11 w-full rounded-lg" />
                </div>
                <div className="flex justify-end">
                  <Skeleton className="h-10 w-28 rounded-xl" />
                </div>
              </>
            ) : (
              <>
                <TextField
                  label="Nombre de la instancia"
                  icon={Building2}
                  value={form.instanceName}
                  onChange={(e) => setForm((f) => ({ ...f, instanceName: e.target.value }))}
                  disabled={!canManage}
                  placeholder="Mi Empresa ERP"
                />

                <TextareaField
                  label="Descripción"
                  value={form.description}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, description: e.target.value.slice(0, 500) }))
                  }
                  disabled={!canManage}
                  placeholder="Describe brevemente tu operación o alcance de la instancia."
                  rows={3}
                  maxLength={500}
                />

                <ComboboxField
                  label="Zona horaria"
                  icon={Clock3}
                  options={TIME_ZONE_OPTIONS}
                  value={form.timeZone}
                  onChange={(value) => setForm((f) => ({ ...f, timeZone: value }))}
                  placeholder="Seleccionar zona horaria"
                  searchPlaceholder="Buscar zona horaria..."
                  emptyText="No se encontraron zonas horarias"
                  className={!canManage ? "opacity-60 pointer-events-none" : ""}
                />
                <ComboboxField
                  label="Moneda"
                  icon={Coins}
                  options={CURRENCY_OPTIONS}
                  value={form.currency}
                  onChange={(value) => setForm((f) => ({ ...f, currency: value }))}
                  placeholder="Seleccionar moneda"
                  searchPlaceholder="Buscar moneda..."
                  emptyText="No se encontraron monedas"
                  className={!canManage ? "opacity-60 pointer-events-none" : ""}
                />
                <div className="flex justify-end pt-2 border-t border-[hsl(var(--border))]">
                  <Button
                    onClick={() => saveMutation.mutate()}
                    disabled={!canManage || saveMutation.isPending || !form.instanceName}
                  >
                    {saveMutation.isPending ? "Guardando..." : "Guardar cambios"}
                  </Button>
                </div>
              </>
            )}
          </div>
        </Card>

        <Card className="p-0">
          <div className="px-4 py-3 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40 rounded-t-2xl">
            <p className="text-sm font-semibold">Apps nativas</p>
          </div>
          <div className="p-4 space-y-4">
            <div className="space-y-1">
              <p className="text-sm font-medium text-[hsl(var(--foreground))]">
                ¿Quieres usar Runly ERP fuera del navegador?
              </p>
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                Descarga la app nativa y conéctala a esta instancia.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => window.open(RUNLY_DESKTOP_DOWNLOAD_URL, "_blank", "noopener,noreferrer")}
              >
                Descargar para Windows
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => window.open(RUNLY_MOBILE_DOWNLOAD_URL, "_blank", "noopener,noreferrer")}
              >
                Descargar para Android (.apk)
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
