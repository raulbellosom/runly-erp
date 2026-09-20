import { companyFetch } from '../../../lib/companyFetch.js'
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Badge,
  Button,
  EmptyState,
  PageHeader,
  PasswordField,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
  Skeleton,
  TextareaField,
  TextField,
} from '@runly/ui'
import { CreditCard } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { getApiUrl } from '../../../lib/runtimeConfig.js'

async function apiGet(path, token) {
  const res = await companyFetch(`${getApiUrl()}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function apiPatch(path, token, body) {
  const res = await companyFetch(`${getApiUrl()}${path}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error ?? `HTTP ${res.status}`)
  }
  return res.json()
}

export default function WebsitePaymentsScreen() {
  const { session } = useAuth()
  const token = session?.access_token
  const queryClient = useQueryClient()

  const [sheetOpen, setSheetOpen] = useState(false)
  const [publishableKey, setPublishableKey] = useState('')
  const [secretKey, setSecretKey] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  const siteQuery = useQuery({
    queryKey: ['website-site', token],
    queryFn: () => apiGet('/website/site', token),
    enabled: Boolean(token),
    staleTime: 60_000,
  })

  const site = siteQuery.data?.data ?? null
  const siteId = site?.id ?? null

  useEffect(() => {
    if (!site) return
    setPublishableKey(site.stripePublishableKey ?? '')
    setSecretKey('')
    setSuccessMessage(site.stripeSuccessMessage ?? '')
  }, [siteId]) // eslint-disable-line react-hooks/exhaustive-deps

  const saveMutation = useMutation({
    mutationFn: (payload) => apiPatch(`/website/site/${siteId}`, token, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['website-site', token] })
      toast.success('Configuracion de pagos guardada')
      setSheetOpen(false)
    },
    onError: (err) => toast.error(err.message ?? 'Error al guardar'),
  })

  function handleSave(e) {
    e.preventDefault()
    if (!siteId) return
    const payload = {
      stripePublishableKey: publishableKey || null,
      stripeSuccessMessage: successMessage || null,
    }
    if (secretKey.trim()) payload.stripeSecretKey = secretKey.trim()
    saveMutation.mutate(payload)
  }

  const keysConfigured = Boolean(site?.stripePublishableKey && site?.stripeSecretKeySet)

  return (
    <div className="p-4 md:p-6 space-y-6">
      <PageHeader
        eyebrow="Runly Website"
        title="Pagos"
        description="Configura pasarelas de pago para tu tienda."
      />

      {siteQuery.isPending ? (
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <Skeleton className="w-10 h-10 rounded-lg shrink-0" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-40" />
              </div>
            </div>
            <Skeleton className="h-8 w-24 rounded-lg" />
          </div>
        </div>
      ) : !site ? (
        <EmptyState
          icon={CreditCard}
          title="Sin sitio web"
          description="Crea un sitio web antes de configurar los pagos."
        />
      ) : (
        <>
          {site.siteType !== 'ecommerce' && (
            <div className="rounded-xl border border-border bg-muted/50 text-sm px-4 py-3 text-muted-foreground">
              Este sitio es de tipo <strong>{site.siteType}</strong>. El checkout de Stripe solo aplica a sitios de tipo <strong>ecommerce</strong>.
            </div>
          )}

          {/* Gateway card: Stripe */}
          <div className="rounded-xl border border-border bg-card p-5 flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-[#635BFF]/10 flex items-center justify-center shrink-0">
                <span className="text-[#635BFF] font-bold text-lg font-mono">S</span>
              </div>
              <div>
                <p className="font-semibold text-foreground">Stripe</p>
                <p className="text-xs text-muted-foreground">Pagos con tarjeta y transferencias</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {keysConfigured ? (
                <Badge variant="success" className="gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
                  Conectado
                </Badge>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full border text-muted-foreground bg-muted border-border">
                  Sin configurar
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSheetOpen(true)}
              >
                {keysConfigured ? 'Editar' : 'Configurar'}
              </Button>
            </div>
          </div>
        </>
      )}

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Configurar Stripe</SheetTitle>
          </SheetHeader>
          <form onSubmit={handleSave} className="flex flex-col gap-6 pt-4">
            <div className="space-y-4">
              <TextField
                label="Clave publicable (Publishable Key)"
                icon={CreditCard}
                placeholder="pk_live_... o pk_test_..."
                value={publishableKey}
                onChange={(e) => setPublishableKey(e.target.value)}
              />
              <PasswordField
                label={site?.stripeSecretKeySet ? 'Clave secreta (dejar en blanco para mantener)' : 'Clave secreta (Secret Key)'}
                placeholder={site?.stripeSecretKeySet ? '••••••••••••••••' : 'sk_live_... o sk_test_...'}
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                La clave secreta se almacena cifrada con AES-256-GCM y nunca se expone en respuestas de la API.
              </p>
            </div>

            <div className="space-y-4">
              <TextareaField
                label="Mensaje de exito (opcional)"
                placeholder="Gracias por tu compra. Te enviaremos un correo con los detalles."
                value={successMessage}
                onChange={(e) => setSuccessMessage(e.target.value)}
                rows={3}
              />
            </div>

            <SheetFooter>
              <Button type="button" variant="outline" onClick={() => setSheetOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saveMutation.isPending || !siteId}>
                {saveMutation.isPending ? 'Guardando...' : 'Guardar configuracion'}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  )
}
