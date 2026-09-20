import { useEffect, useState, useRef } from "react";
import { NavLink } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, Card, PageHeader, Skeleton, PasswordField, ErrorState, TextField } from "@runly/ui";
import { BellRing, Mail, Settings } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../../auth/AuthProvider.jsx";
import { runly } from "../../../lib/runly.js";
import { useActiveCompany } from "../../../company/ActiveCompanyProvider.jsx";

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

const EMPTY = { subject: "mailto:admin@example.com", publicKey: "", privateKey: "" };

export default function WebPushSettingsScreen() {
  const { activeCompanyId } = useActiveCompany();
  const dirtyRef = useRef(false);
  const { session } = useAuth();
  const token = session?.access_token;
  const [form, setForm] = useState(EMPTY);
  const [privateKeyChanged, setPrivateKeyChanged] = useState(false);

  const configQuery = useQuery({
    queryKey: ["webpush-settings", activeCompanyId],
    queryFn: () => runly.settings.getWebPush(token),
    enabled: Boolean(token && activeCompanyId),
  });

  useEffect(() => {
    const data = configQuery.data?.data;
    if (!data || dirtyRef.current) return;
    setForm({
      subject: data.subject || "mailto:admin@example.com",
      publicKey: data.publicKey || "",
      privateKey: "",
    });
    setPrivateKeyChanged(false);
  }, [configQuery.data]);

  const generateMutation = useMutation({
    mutationFn: () => runly.settings.generateWebPush(token),
    onSuccess: (response) => {
      dirtyRef.current = true;
      const data = response?.data ?? {};
      setForm((prev) => ({
        ...prev,
        publicKey: data.publicKey ?? prev.publicKey,
        privateKey: data.privateKey ?? prev.privateKey,
      }));
      setPrivateKeyChanged(true);
      toast.success("Llaves VAPID generadas.");
    },
    onError: (err) => toast.error(err.message),
  });

  const saveMutation = useMutation({
    mutationFn: (payload) =>
      runly.settings.saveWebPush(payload, token),
    onSuccess: () => {
      dirtyRef.current = false;
      toast.success("Configuracion Web Push guardada.");
      configQuery.refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const clearMutation = useMutation({
    mutationFn: () =>
      runly.settings.clearWebPush(token),
    onSuccess: () => {
      dirtyRef.current = false;
      toast.success("Configuracion Web Push eliminada.");
      setForm(EMPTY);
      setPrivateKeyChanged(false);
      configQuery.refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  function handleSave(e) {
    e.preventDefault();
    if (!form.privateKey.trim()) {
      toast.error("Debes incluir la llave privada para guardar.");
      return;
    }
    saveMutation.mutate({
      subject: form.subject.trim(),
      publicKey: form.publicKey.trim(),
      privateKey: form.privateKey.trim(),
    });
  }

  const configured = configQuery.data?.data?.configured ?? false;

  return (
    <div className="flex flex-col min-h-full">
      <div className="flex-1 p-4 md:p-6 space-y-6 max-w-3xl mx-auto w-full">
        <PageHeader
          eyebrow="Runly Core"
          title="Configuracion"
          description="Configura las llaves VAPID para notificaciones push en PWA."
        />
        <SettingsTabs />

        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40 flex items-center justify-between">
            <p className="text-sm font-semibold flex items-center gap-2">
              <BellRing className="h-4 w-4" />
              Notificaciones Web Push
            </p>
            {configured && (
              <span className="flex items-center gap-1.5 text-xs text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                Configurado
              </span>
            )}
          </div>
          <div className="p-4 space-y-4">
            {configQuery.isError && !configQuery.data ? (
              <ErrorState description={configQuery.error?.message || "No se pudo cargar la configuración."} onRetry={() => configQuery.refetch()} />
            ) : configQuery.isPending ? (
              <>
                <Skeleton className="h-11 w-full rounded-lg" />
                <Skeleton className="h-20 w-full rounded-lg" />
                <Skeleton className="h-20 w-full rounded-lg" />
              </>
            ) : (
              <form onChangeCapture={() => { dirtyRef.current = true; }} onSubmit={handleSave} className="space-y-4">
                <TextField
                  label="VAPID Subject"
                  value={form.subject}
                  onChange={(e) => setForm((prev) => ({ ...prev, subject: e.target.value }))}
                  placeholder="mailto:admin@tu-dominio.com"
                  required
                />
                <TextField
                  label="Llave publica"
                  value={form.publicKey}
                  onChange={(e) => setForm((prev) => ({ ...prev, publicKey: e.target.value }))}
                  placeholder="BEl...."
                  required
                />
                <PasswordField
                  label="Llave privada"
                  hint={configured && !privateKeyChanged ? "(captura de nuevo para actualizar)" : undefined}
                  value={form.privateKey}
                  onChange={(e) => {
                    setForm((prev) => ({ ...prev, privateKey: e.target.value }));
                    setPrivateKeyChanged(true);
                  }}
                  placeholder={configured ? "••••••••••••••••" : ""}
                  required={!configured}
                />
                <div className="flex flex-wrap gap-2 pt-2 border-t border-[hsl(var(--border))]">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => generateMutation.mutate()}
                    disabled={generateMutation.isPending}
                  >
                    {generateMutation.isPending ? "Generando..." : "Generar llaves"}
                  </Button>
                  <Button type="submit" disabled={saveMutation.isPending || !activeCompanyId}>
                    {saveMutation.isPending ? "Guardando..." : "Guardar configuracion"}
                  </Button>
                  {configured && (
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={() => clearMutation.mutate()}
                      disabled={clearMutation.isPending}
                    >
                      {clearMutation.isPending ? "Eliminando..." : "Eliminar configuracion"}
                    </Button>
                  )}
                </div>
              </form>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
