import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  NumberField,
  PageHeader,
  PasswordField,
  Skeleton,
  SelectField,
  SwitchField,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TextField,
} from '@runly/ui'
import { BarChart3, Globe, Mail, Server, User } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { getApiUrl } from '../../../lib/runtimeConfig.js'
import { WebsiteSourceSelector } from '../components/WebsiteSourceSelector.jsx'
import { DistUploadPanel } from '../components/DistUploadPanel.jsx'

async function apiFetch(path, token, options = {}) {
  const res = await fetch(`${getApiUrl()}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}

async function apiFetchForm(path, token, options = {}) {
  const res = await fetch(`${getApiUrl()}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}

const SMTP_EMPTY = { host: '', port: 587, user: '', pass: '', from_name: '', from_email: '', tls: false }
const CAPTURE_EMPTY = {
  analyticsMode: 'off',
  turnstileSiteKey: '',
  turnstileSecretKey: '',
}
const ANALYTICS_MODE_OPTIONS = [
  { value: 'off', label: 'Desactivada' },
  { value: 'anonymous', label: 'Anonima sin banner' },
  { value: 'consent_required', label: 'Requiere consentimiento' },
]

export default function WebsiteSettingsScreen() {
  const { session } = useAuth()
  const token = session?.access_token
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [smtpForm, setSmtpForm] = useState(SMTP_EMPTY)
  const [passChanged, setPassChanged] = useState(false)
  const [captureForm, setCaptureForm] = useState(CAPTURE_EMPTY)
  const [turnstileSecretChanged, setTurnstileSecretChanged] = useState(false)

  // --- Site query (same pattern as WebsiteOverviewScreen) ---
  const siteQuery = useQuery({
    queryKey: ['website-site', token],
    queryFn: () => apiFetch('/website/site', token),
    enabled: Boolean(token),
    staleTime: 60_000,
  })
  const siteId = siteQuery.data?.data?.id

  useEffect(() => {
    const site = siteQuery.data?.data
    if (!site) return
    setCaptureForm({
      analyticsMode: site.analyticsMode ?? 'off',
      turnstileSiteKey: site.turnstileSiteKey ?? '',
      turnstileSecretKey: '',
    })
    setTurnstileSecretChanged(false)
  }, [siteQuery.data])

  // --- Source query ---
  const sourceQuery = useQuery({
    queryKey: ['website-site-source', siteId],
    queryFn: () => apiFetch(`/website/sites/${siteId}`, token),
    enabled: Boolean(token) && Boolean(siteId),
  })

  // --- SMTP config query ---
  const configQuery = useQuery({
    queryKey: ['website-smtp-settings'],
    queryFn: () => apiFetch('/website/settings/smtp', token),
    enabled: Boolean(token),
  })

  useEffect(() => {
    const data = configQuery.data?.data
    if (!data) return
    setSmtpForm({
      host:       data.host,
      port:       data.port,
      user:       data.user,
      pass:       '',
      from_name:  data.from_name,
      from_email: data.from_email,
      tls:        data.tls,
    })
  }, [configQuery.data])

  const smtpSaveMutation = useMutation({
    mutationFn: (data) =>
      apiFetch('/website/settings/smtp', token, { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      toast.success('Configuracion SMTP del website guardada')
      setPassChanged(false)
      configQuery.refetch()
    },
    onError: (err) => toast.error(err.message),
  })

  const smtpTestMutation = useMutation({
    mutationFn: () => apiFetch('/website/settings/smtp/test', token, { method: 'POST' }),
    onSuccess: (res) => {
      const label = res.source === 'website' ? 'SMTP propio del website' : 'SMTP de plataforma (fallback)'
      toast.success(`Email de prueba enviado via ${label}`)
    },
    onError: (err) => toast.error(`Error: ${err.message}`),
  })

  const sourceChangeMutation = useMutation({
    mutationFn: (newSource) =>
      apiFetch(`/website/sites/${siteId}`, token, {
        method: 'PATCH',
        body: JSON.stringify({ sourceType: newSource }),
      }),
    onSuccess: () => {
      toast.success('Fuente del sitio actualizada')
      sourceQuery.refetch()
    },
    onError: (err) => toast.error(err.message ?? 'Error al cambiar la fuente'),
  })

  const captureSaveMutation = useMutation({
    mutationFn: (data) =>
      apiFetch(`/website/site/${siteId}`, token, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      toast.success('Configuracion de analitica guardada')
      setTurnstileSecretChanged(false)
      queryClient.invalidateQueries({ queryKey: ['website-site'] })
      siteQuery.refetch()
    },
    onError: (err) => toast.error(err.message),
  })

  const uploadDistMutation = useMutation({
    mutationFn: (file) => {
      const formData = new FormData()
      formData.append('file', file)
      return apiFetchForm(`/website/sites/${siteId}/dist/upload`, token, {
        method: 'POST',
        body: formData,
      })
    },
    onMutate: () => ({ toastId: toast.loading('Subiendo build...') }),
    onSuccess: (res, _vars, ctx) => {
      toast.success(`Build subido: ${res.data.fileCount} archivos`, { id: ctx.toastId })
      sourceQuery.refetch()
      queryClient.invalidateQueries({ queryKey: ['website-builds', siteId] })
    },
    onError: (err, _vars, ctx) => toast.error(err.message ?? 'Error al subir el build', { id: ctx.toastId }),
  })

  const deleteDistMutation = useMutation({
    mutationFn: () =>
      apiFetchForm(`/website/sites/${siteId}/dist`, token, { method: 'DELETE' }),
    onMutate: () => ({ toastId: toast.loading('Eliminando build...') }),
    onSuccess: (_res, _vars, ctx) => {
      toast.success('Build eliminado. El sitio volvera al constructor de paginas.', { id: ctx.toastId })
      sourceQuery.refetch()
    },
    onError: (err, _vars, ctx) => toast.error(err.message ?? 'Error al eliminar el build', { id: ctx.toastId }),
  })

  function handleSmtpSubmit(e) {
    e.preventDefault()
    const payload = {
      host:       smtpForm.host,
      port:       Number(smtpForm.port),
      user:       smtpForm.user,
      from_name:  smtpForm.from_name  || undefined,
      from_email: smtpForm.from_email || undefined,
      tls:        smtpForm.tls,
    }
    if (passChanged && smtpForm.pass) payload.pass = smtpForm.pass
    smtpSaveMutation.mutate(payload)
  }

  function handleCaptureSubmit(e) {
    e.preventDefault()
    const payload = {
      analyticsMode: captureForm.analyticsMode,
      turnstileSiteKey: captureForm.turnstileSiteKey.trim() || null,
    }
    if (turnstileSecretChanged) {
      payload.turnstileSecretKey =
        captureForm.turnstileSecretKey.trim() || null
    }
    captureSaveMutation.mutate(payload)
  }

  const smtpConfigured = configQuery.data?.data?.configured ?? false
  const turnstileSecretSet =
    siteQuery.data?.data?.turnstileSecretKeySet ?? false

  if (siteQuery.isError) {
    return (
      <div className="p-4 md:p-6">
        <ErrorState
          title="No se pudo cargar la configuracion"
          message={siteQuery.error?.message}
          onRetry={() => siteQuery.refetch()}
        />
      </div>
    )
  }

  // No site configured yet — show empty state
  if (!siteQuery.isPending && !siteId) {
    return (
      <div className="p-4 md:p-6 space-y-6">
        <PageHeader
          eyebrow="Runly Website"
          title="Configuracion"
          description="Ajusta las integraciones y credenciales de tu sitio web."
        />
        <EmptyState
          title="No hay sitio configurado"
          description="Completa el asistente de configuracion para activar estas opciones."
          action={
            <Button onClick={() => navigate('/app/m/runly.website')}>
              Ir al asistente
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col min-h-full">
      <div className="flex-1 p-4 md:p-6 space-y-6 max-w-3xl mx-auto w-full">
        <PageHeader
          eyebrow="Runly Website"
          title="Configuracion"
          description="Ajusta las integraciones y credenciales de tu sitio web."
        />

        <Tabs defaultValue="source">
          <TabsList>
            <TabsTrigger value="source">
              <Globe className="w-4 h-4 mr-1.5" />
              Fuente del sitio
            </TabsTrigger>
            <TabsTrigger value="smtp">
              <Mail className="w-4 h-4 mr-1.5" />
              Correo electronico
            </TabsTrigger>
            <TabsTrigger value="analytics">
              <BarChart3 className="w-4 h-4 mr-1.5" />
              Analitica
            </TabsTrigger>
          </TabsList>

          {/* Tab: Fuente del sitio */}
          <TabsContent value="source" className="mt-4">
            <Card className="p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-border bg-muted/40">
                <p className="text-sm font-semibold">Fuente del sitio</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Elige que se sirve en la ruta raiz de tu dominio.
                </p>
              </div>
              <div className="p-4 space-y-4">
                {sourceQuery.isPending || siteQuery.isPending ? (
                  <div className="space-y-2">
                    <Skeleton className="h-16 rounded-lg" />
                    <Skeleton className="h-16 rounded-lg" />
                    <Skeleton className="h-16 rounded-lg" />
                  </div>
                ) : (
                  <>
                    <WebsiteSourceSelector
                      currentSource={sourceQuery.data?.data?.sourceType ?? 'builder'}
                      onSelect={(value) => sourceChangeMutation.mutate(value)}
                      isLoading={sourceChangeMutation.isPending}
                    />
                    {sourceQuery.data?.data?.sourceType === 'dist' && (
                      <div className="pt-2 border-t border-border">
                        <p className="text-sm font-medium mb-3">Archivos del build</p>
                        <DistUploadPanel
                          site={sourceQuery.data?.data}
                          token={token}
                          siteId={siteId}
                          onUpload={(file) => uploadDistMutation.mutate(file)}
                          onDelete={() => deleteDistMutation.mutate()}
                          isUploading={uploadDistMutation.isPending || deleteDistMutation.isPending}
                          uploadError={uploadDistMutation.isError ? uploadDistMutation.error?.message : null}
                        />
                      </div>
                    )}
                  </>
                )}
              </div>
            </Card>
          </TabsContent>

          {/* Tab: Correo electronico (SMTP) */}
          <TabsContent value="smtp" className="mt-4">
            <Card className="p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-border bg-muted/40 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">Correo electronico (SMTP)</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Credenciales propias del sitio. Si no se configuran, se usa el SMTP de la plataforma como respaldo.
                  </p>
                </div>
                {smtpConfigured && (
                  <Badge variant="success" className="shrink-0 gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
                    Configurado
                  </Badge>
                )}
              </div>

              <div className="p-4 space-y-4">
                {configQuery.isPending ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <Skeleton className="h-11 rounded-lg" />
                      <Skeleton className="h-11 rounded-lg" />
                    </div>
                    <Skeleton className="h-11 w-full rounded-lg" />
                    <Skeleton className="h-11 w-full rounded-lg" />
                    <Skeleton className="h-11 w-full rounded-lg" />
                    <Skeleton className="h-11 w-full rounded-lg" />
                  </div>
                ) : (
                  <form onSubmit={handleSmtpSubmit} className="space-y-4">
                    <div className="grid md:grid-cols-2 gap-4">
                      <TextField
                        label="Servidor (host)"
                        icon={Server}
                        placeholder="smtp.gmail.com"
                        value={smtpForm.host}
                        onChange={(e) => setSmtpForm((f) => ({ ...f, host: e.target.value }))}
                        required
                      />
                      <NumberField
                        label="Puerto"
                        value={smtpForm.port}
                        onChange={(e) => setSmtpForm((f) => ({ ...f, port: Number(e.target.value) }))}
                        required
                      />
                    </div>

                    <TextField
                      label="Usuario"
                      icon={User}
                      placeholder="reservas@minegocio.com"
                      value={smtpForm.user}
                      onChange={(e) => setSmtpForm((f) => ({ ...f, user: e.target.value }))}
                      required
                    />

                    <PasswordField
                      label={smtpConfigured && !passChanged ? 'Contrasena (dejar en blanco para mantener)' : 'Contrasena'}
                      placeholder={smtpConfigured ? '••••••••' : ''}
                      value={smtpForm.pass}
                      onChange={(e) => {
                        setSmtpForm((f) => ({ ...f, pass: e.target.value }))
                        setPassChanged(true)
                      }}
                    />

                    <div className="grid md:grid-cols-2 gap-4">
                      <TextField
                        label="Nombre del remitente"
                        icon={Mail}
                        placeholder="Mi Restaurante"
                        value={smtpForm.from_name}
                        onChange={(e) => setSmtpForm((f) => ({ ...f, from_name: e.target.value }))}
                      />
                      <TextField
                        label="Email del remitente"
                        icon={Mail}
                        placeholder="reservas@minegocio.com"
                        value={smtpForm.from_email}
                        onChange={(e) => setSmtpForm((f) => ({ ...f, from_email: e.target.value }))}
                      />
                    </div>

                    <SwitchField
                      id="ws-smtp-tls"
                      label={[25, 587].includes(Number(smtpForm.port)) ? 'Exigir STARTTLS' : 'Usar TLS directo (SSL)'}
                      checked={Number(smtpForm.port) === 465 || smtpForm.tls}
                      disabled={Number(smtpForm.port) === 465}
                      onChange={(checked) => setSmtpForm((f) => ({ ...f, tls: checked }))}
                    />

                    <p className="text-sm text-muted-foreground">
                      {[25, 587].includes(Number(smtpForm.port))
                        ? 'La conexion se cifra mediante STARTTLS. Activa esta opcion para exigirlo; desactivada, se usa si el servidor lo ofrece.'
                        : 'El puerto 465 siempre usa TLS directo. Para STARTTLS usa el puerto 587, segun las indicaciones de tu proveedor.'}
                    </p>

                    <div className="flex gap-2 pt-2 border-t border-border">
                      <Button type="submit" disabled={smtpSaveMutation.isPending} className="flex-1">
                        {smtpSaveMutation.isPending ? 'Guardando...' : 'Guardar configuracion'}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => smtpTestMutation.mutate()}
                        disabled={smtpTestMutation.isPending}
                      >
                        {smtpTestMutation.isPending ? 'Enviando...' : 'Enviar prueba'}
                      </Button>
                    </div>
                  </form>
                )}
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="analytics" className="mt-4">
            <Card className="p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-border bg-muted/40">
                <p className="text-sm font-semibold">Analitica y proteccion de formularios</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Controla la captura del storefront y las claves publicas de Cloudflare Turnstile.
                </p>
              </div>
              <form onSubmit={handleCaptureSubmit} className="p-4 space-y-4">
                <SelectField
                  label="Modo de analitica"
                  value={captureForm.analyticsMode}
                  onChange={(value) =>
                    setCaptureForm((current) => ({
                      ...current,
                      analyticsMode: value,
                    }))
                  }
                  options={ANALYTICS_MODE_OPTIONS}
                />
                <p className="text-xs text-muted-foreground">
                  Runly respeta siempre Do Not Track. El modo con consentimiento no
                  envia eventos hasta que el visitante lo autoriza.
                </p>
                <TextField
                  label="Turnstile Site Key"
                  value={captureForm.turnstileSiteKey}
                  onChange={(event) =>
                    setCaptureForm((current) => ({
                      ...current,
                      turnstileSiteKey: event.target.value,
                    }))
                  }
                  placeholder="Clave publica"
                />
                <PasswordField
                  label={
                    turnstileSecretSet && !turnstileSecretChanged
                      ? 'Turnstile Secret Key (dejar en blanco para mantener)'
                      : 'Turnstile Secret Key'
                  }
                  value={captureForm.turnstileSecretKey}
                  onChange={(event) => {
                    setCaptureForm((current) => ({
                      ...current,
                      turnstileSecretKey: event.target.value,
                    }))
                    setTurnstileSecretChanged(true)
                  }}
                  placeholder={turnstileSecretSet ? '••••••••' : 'Clave secreta'}
                />
                <Button
                  type="submit"
                  disabled={captureSaveMutation.isPending}
                  className="w-full"
                >
                  {captureSaveMutation.isPending
                    ? 'Guardando...'
                    : 'Guardar analitica'}
                </Button>
              </form>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
