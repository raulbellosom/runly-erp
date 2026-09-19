import { useState, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { getApiUrl } from '../../../lib/runtimeConfig.js'
import { Button, Label, PageHeader, Skeleton, Switch, TextField } from '@runly/ui'
import { toast } from 'sonner'

async function apiFetch(path, token, options = {}) {
  const res = await fetch(`${getApiUrl()}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...options.headers },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}

const EMPTY = { host: '', port: '587', user: '', pass: '', from_name: '', from_email: '', tls: false }

export default function SmtpSettingsScreen() {
  const { session } = useAuth()
  const token = session?.access_token

  const [form, setForm] = useState(EMPTY)
  const [passChanged, setPassChanged] = useState(false)

  const configQuery = useQuery({
    queryKey: ['smtp-settings', token],
    queryFn: () => apiFetch('/settings/smtp', token),
    enabled: Boolean(token),
  })

  useEffect(() => {
    const data = configQuery.data?.data
    if (!data) return
    setForm({
      host:       data.host,
      port:       String(data.port),
      user:       data.user,
      pass:       '',
      from_name:  data.from_name,
      from_email: data.from_email,
      tls:        data.tls,
    })
  }, [configQuery.data])

  const saveMutation = useMutation({
    mutationFn: (data) => apiFetch('/settings/smtp', token, { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      toast.success('Configuracion SMTP guardada')
      setPassChanged(false)
      configQuery.refetch()
    },
    onError: (err) => toast.error(err.message),
  })

  const testMutation = useMutation({
    mutationFn: () => apiFetch('/settings/smtp/test', token, { method: 'POST' }),
    onSuccess: () => toast.success('Email de prueba enviado correctamente'),
    onError: (err) => toast.error(`Error: ${err.message}`),
  })

  function handleSubmit(e) {
    e.preventDefault()
    const payload = {
      host:       form.host,
      port:       Number(form.port),
      user:       form.user,
      from_name:  form.from_name  || undefined,
      from_email: form.from_email || undefined,
      tls:        form.tls,
    }
    if (passChanged && form.pass) payload.pass = form.pass
    saveMutation.mutate(payload)
  }

  const smtpData = configQuery.data?.data
  const configured = smtpData?.configured ?? false
  const statusReason = smtpData?.status_reason ?? null
  const statusMessage = smtpData?.status_message ?? null
  // A saved-but-unusable config (almost always: JWT_SECRET changed, so the stored
  // password no longer decrypts) reports configured=false WITH a reason. Surface
  // it, and keep the "Enviar prueba" button available so the admin can confirm a
  // re-save fixed it.
  const savedButBroken = !configured && statusReason && statusReason !== 'not_configured'
  const canTest = configured || savedButBroken

  return (
    <div className="flex flex-col min-h-full">
      <div className="flex-1 p-4 md:p-6 space-y-6 max-w-3xl mx-auto w-full">
        <PageHeader
          eyebrow="Configuracion"
          title="SMTP"
          description="Credenciales para el envio de emails desde la plataforma."
        />

        {configured && (
          <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 px-3 py-2 rounded-lg">
            <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
            SMTP configurado
          </div>
        )}

        {savedButBroken && (
          <div className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 px-3 py-2 rounded-lg dark:text-amber-200 dark:bg-amber-950/40 dark:border-amber-900">
            <span className="mt-1 w-2 h-2 rounded-full bg-amber-500 shrink-0" />
            <span>
              {statusMessage
                || 'La configuracion SMTP guardada no se puede usar. Vuelve a escribir la contrasena y guarda.'}
              <br />
              Mientras tanto, ningun correo de la plataforma sale (notificaciones, calendario, invitaciones a llamadas).
            </span>
          </div>
        )}

        {configQuery.isPending ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Skeleton className="h-11 col-span-1 rounded-lg" />
              <Skeleton className="h-11 rounded-lg" />
            </div>
            <Skeleton className="h-11 w-full rounded-lg" />
            <Skeleton className="h-11 w-full rounded-lg" />
            <Skeleton className="h-11 w-full rounded-lg" />
            <Skeleton className="h-11 w-full rounded-lg" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
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

            <TextField
              label="Contrasena"
              type="password"
              description={configured && !passChanged ? "(dejar en blanco para mantener)" : undefined}
              placeholder={configured ? '••••••••' : ''}
              value={form.pass}
              onChange={(e) => { setForm((f) => ({ ...f, pass: e.target.value })); setPassChanged(true) }}
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
              <Switch id="smtp-tls" checked={Number(form.port) === 465 || form.tls} disabled={Number(form.port) === 465} onCheckedChange={(v) => setForm((f) => ({ ...f, tls: v }))} />
              <Label htmlFor="smtp-tls">{[25, 587].includes(Number(form.port)) ? 'Exigir STARTTLS' : 'Usar TLS directo (SSL)'}</Label>
            </div>
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              {[25, 587].includes(Number(form.port))
                ? 'La conexion se cifra mediante STARTTLS. Activa esta opcion para exigirlo; desactivada, se usa si el servidor lo ofrece.'
                : 'El puerto 465 siempre usa TLS directo. Para STARTTLS usa el puerto 587, segun las indicaciones de tu proveedor.'}
            </p>

            <div className="flex gap-2 pt-2 border-t border-[hsl(var(--border))]">
              <Button type="submit" disabled={saveMutation.isPending} className="flex-1">
                {saveMutation.isPending ? 'Guardando...' : 'Guardar configuracion'}
              </Button>
              {canTest && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => testMutation.mutate()}
                  disabled={testMutation.isPending}
                >
                  {testMutation.isPending ? 'Enviando...' : 'Enviar prueba'}
                </Button>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
