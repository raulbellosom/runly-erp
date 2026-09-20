import { useState, useEffect, useRef } from "react";
import { NavLink } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button, Card, Label, PageHeader, Skeleton, PasswordField, ErrorState, Switch, TextField } from "@runly/ui";
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

const EMPTY = { host: "", port: "587", user: "", pass: "", from_name: "", from_email: "", tls: false };

export default function SmtpSettingsScreen() {
  const { activeCompanyId } = useActiveCompany();
  const dirtyRef = useRef(false);
  const { session } = useAuth();
  const token = session?.access_token;

  const [form, setForm] = useState(EMPTY);
  const [passChanged, setPassChanged] = useState(false);

  const configQuery = useQuery({
    queryKey: ["smtp-settings", activeCompanyId],
    queryFn: () => runly.settings.getSmtp(token),
    enabled: Boolean(token && activeCompanyId),
  });

  useEffect(() => {
    const data = configQuery.data?.data;
    if (!data || dirtyRef.current) return;
    setForm({
      host: data.host,
      port: String(data.port),
      user: data.user,
      pass: "",
      from_name: data.from_name,
      from_email: data.from_email,
      tls: data.tls,
    });
  }, [configQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (data) =>
      runly.settings.saveSmtp(data, token),
    onSuccess: () => {
      dirtyRef.current = false;
      toast.success("Configuracion SMTP guardada");
      setPassChanged(false);
      setForm((current) => ({ ...current, pass: "" }));
      configQuery.refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const testMutation = useMutation({
    mutationFn: () => runly.settings.testSmtp(token),
    onSuccess: () => toast.success("Email de prueba enviado correctamente"),
    onError: (err) => toast.error(`Error: ${err.message}`),
  });

  function handleSubmit(e) {
    e.preventDefault();
    const payload = {
      host: form.host,
      port: Number(form.port),
      user: form.user,
      from_name: form.from_name || undefined,
      from_email: form.from_email || undefined,
      tls: form.tls,
    };
    if (passChanged && form.pass) payload.pass = form.pass;
    saveMutation.mutate(payload);
  }

  const smtpData = configQuery.data?.data;
  const configured = smtpData?.configured ?? false;
  const statusReason = smtpData?.status_reason ?? null;
  const statusMessage = smtpData?.status_message ?? null;
  // A saved-but-unusable config (almost always: JWT_SECRET changed, so the stored
  // password no longer decrypts) reports configured=false WITH a reason. Surface
  // it, and keep the test button available so a re-save can be verified.
  const savedButBroken = !configured && statusReason && statusReason !== "not_configured";
  const canTest = configured || savedButBroken;

  return (
    <div className="flex flex-col min-h-full">
      <div className="flex-1 p-4 md:p-6 space-y-6 max-w-3xl mx-auto w-full">
        <PageHeader
          eyebrow="Runly Core"
          title="Configuracion"
          description="Configura el correo de la empresa activa."
        />
        <SettingsTabs />

        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40 flex items-center justify-between">
            <p className="text-sm font-semibold">Correo electronico (SMTP)</p>
            {configured && (
              <span className="flex items-center gap-1.5 text-xs text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                Configurado
              </span>
            )}
            {savedButBroken && (
              <span className="flex items-center gap-1.5 text-xs text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full dark:text-amber-200 dark:bg-amber-950/40 dark:border-amber-900">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                Revisar
              </span>
            )}
          </div>
          <div className="p-4 space-y-4">
            {savedButBroken && (
              <div className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 px-3 py-2 rounded-lg dark:text-amber-200 dark:bg-amber-950/40 dark:border-amber-900">
                <span className="mt-1 w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                <span>
                  {statusMessage
                    || "La configuracion SMTP guardada no se puede usar. Vuelve a escribir la contrasena y guarda."}
                  <br />
                  Los correos de esta empresa no se pueden enviar hasta corregir la configuración.
                </span>
              </div>
            )}
            {configQuery.isError && !configQuery.data ? (
              <ErrorState description="No se pudo cargar la configuración." onRetry={() => configQuery.refetch()} />
            ) : configQuery.isPending ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Skeleton className="h-11 col-span-1 rounded-lg" />
                  <Skeleton className="h-11 rounded-lg" />
                </div>
                <Skeleton className="h-11 w-full rounded-lg" />
                <Skeleton className="h-11 w-full rounded-lg" />
                <Skeleton className="h-11 w-full rounded-lg" />
                <Skeleton className="h-11 w-full rounded-lg" />
                <div className="flex justify-end">
                  <Skeleton className="h-10 w-40 rounded-xl" />
                </div>
              </>
            ) : (
              <form onChangeCapture={() => { dirtyRef.current = true; }} onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2 sm:col-span-1">
                    <TextField
                      label="Servidor (host)"
                      placeholder="smtp.gmail.com"
                      value={form.host}
                      onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
                      required
                    />
                  </div>
                  <TextField
                    label="Puerto"
                    type="number"
                    value={form.port}
                    onChange={(e) => setForm((f) => ({ ...f, port: e.target.value }))}
                    required
                  />
                </div>

                <TextField
                  label="Usuario"
                  type="email"
                  placeholder="usuario@dominio.com"
                  value={form.user}
                  onChange={(e) => setForm((f) => ({ ...f, user: e.target.value }))}
                  required
                />

                <PasswordField
                  label="Contrasena"
                  hint={configured && !passChanged ? "(dejar en blanco para mantener)" : undefined}
                  placeholder={configured ? "••••••••" : ""}
                  value={form.pass}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, pass: e.target.value }));
                    setPassChanged(true);
                  }}
                />

                <TextField
                  label="Nombre del remitente"
                  placeholder="Runly ERP"
                  value={form.from_name}
                  onChange={(e) => setForm((f) => ({ ...f, from_name: e.target.value }))}
                />

                <TextField
                  label="Email del remitente"
                  type="email"
                  value={form.from_email}
                  onChange={(e) => setForm((f) => ({ ...f, from_email: e.target.value }))}
                />

                <div className="flex items-center gap-2">
                  <Switch
                    id="smtp-tls"
                    checked={Number(form.port) === 465 || form.tls}
                    disabled={Number(form.port) === 465}
                    onCheckedChange={(v) => { dirtyRef.current = true; setForm((f) => ({ ...f, tls: v })); }}
                  />
                  <Label htmlFor="smtp-tls">{[25, 587].includes(Number(form.port)) ? "Exigir STARTTLS" : "Usar TLS directo (SSL)"}</Label>
                </div>
                <p className="text-sm text-[hsl(var(--muted-foreground))]">
                  {[25, 587].includes(Number(form.port))
                    ? "La conexion se cifra mediante STARTTLS. Activa esta opcion para exigirlo; desactivada, se usa si el servidor lo ofrece."
                    : "El puerto 465 siempre usa TLS directo. Para STARTTLS usa el puerto 587, segun las indicaciones de tu proveedor."}
                </p>

                <div className="flex gap-2 pt-2 border-t border-[hsl(var(--border))]">
                  <Button type="submit" disabled={saveMutation.isPending || !activeCompanyId} className="flex-1">
                    {saveMutation.isPending ? "Guardando..." : "Guardar configuracion"}
                  </Button>
                  {canTest && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => testMutation.mutate()}
                      disabled={testMutation.isPending}
                    >
                      {testMutation.isPending ? "Enviando..." : "Enviar prueba"}
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
