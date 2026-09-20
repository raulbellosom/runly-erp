import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ComboboxField,
  EmptyState,
  Input,
  Label,
  PageHeader,
} from '@runly/ui'
import { Expand, Keyboard, QrCode, ScanLine } from 'lucide-react'
import { getDispatchSetup, scanGate } from '../lib/dispatch-api.js'

const QR_PREFIX = 'RUNLY-DISPATCH:1:'

function looksLikeQr(rawValue) {
  const value = rawValue.trim()
  const token = value.startsWith(QR_PREFIX) ? value.slice(QR_PREFIX.length) : ''
  return token.length >= 16 && !/\s/.test(token)
}

function compactCode(value) {
  if (value.length <= 28) return value
  return `${value.slice(0, 20)}…${value.slice(-6)}`
}

export default function DispatchKiosk({ token }) {
  const rootRef = useRef(null)
  const inputRef = useRef(null)
  const [value, setValue] = useState('')
  const [gateStationId, setGateStationId] = useState('')
  const [result, setResult] = useState(null)
  const [readings, setReadings] = useState([])

  const setupQuery = useQuery({
    queryKey: ['custom.dispatch', 'setup'],
    queryFn: () => getDispatchSetup(token),
    enabled: Boolean(token),
  })
  const gateStations = useMemo(
    () => (setupQuery.data?.stations ?? [])
      .filter((s) => s.enabled && s.station_type === 'GATE')
      .map((s) => ({ value: s.id, label: `${s.site_name} · ${s.name}` })),
    [setupQuery.data],
  )

  const scanMutation = useMutation({
    mutationFn: (qrValue) => scanGate({ token, gateStationId, qrValue }),
  })

  function focusScanner() {
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }

  async function submit(event) {
    event.preventDefault()
    if (!gateStationId) {
      setResult({ valid: false, value: '', message: 'Selecciona la estación de pluma antes de escanear.' })
      return
    }
    if (!value.trim()) {
      setResult({ valid: false, value: '', message: 'Escanea o captura un código antes de continuar.' })
      focusScanner()
      return
    }

    const scannedValue = value.trim()
    const structurallyValid = looksLikeQr(scannedValue)
    let reading

    if (!structurallyValid) {
      reading = { value: scannedValue, valid: false, message: 'El código no corresponde a un vale de Runly.' }
    } else {
      try {
        const { accepted } = await scanMutation.mutateAsync(scannedValue)
        reading = accepted
          ? { value: scannedValue, valid: true, message: 'Código leído correctamente. Esperando aprobación.' }
          : { value: scannedValue, valid: false, message: 'El vale no está listo para salir o el código no es válido.' }
      } catch {
        reading = { value: scannedValue, valid: false, message: 'No fue posible registrar el escaneo. Intenta de nuevo.' }
      }
    }

    setResult({ ...reading, id: `${Date.now()}-${readings.length}`, scannedAt: new Date() })
    setReadings((current) => [{ ...reading, id: `${Date.now()}-${readings.length}`, scannedAt: new Date() }, ...current].slice(0, 8))
    setValue('')
    focusScanner()
  }

  async function enterFullscreen() {
    if (!rootRef.current?.requestFullscreen) {
      setResult({ valid: false, value: '', message: 'Este navegador no ofrece el modo de pantalla completa.' })
      return
    }
    try {
      await rootRef.current.requestFullscreen()
      focusScanner()
    } catch {
      setResult({ valid: false, value: '', message: 'El navegador no permitió abrir la pantalla completa.' })
    }
  }

  return (
    <div ref={rootRef} className="min-h-dvh bg-background p-4 md:p-6 xl:p-8">
      <div className="mx-auto w-full max-w-screen-2xl space-y-6">
        <PageHeader
          eyebrow="Control de salida"
          title="Lector de vales"
          description="Escanea los códigos QR y consulta la actividad reciente de la estación."
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Badge variant={gateStationId ? 'success' : 'secondary'}>
            {gateStationId ? 'Lector disponible' : 'Selecciona una estación de pluma'}
          </Badge>
          <Button variant="outline" onClick={enterFullscreen}>
            <Expand className="mr-2 h-4 w-4" />
            Pantalla completa
          </Button>
        </div>

        <Card variant="bordered">
          <CardContent className="p-4 sm:p-6">
            <ComboboxField
              label="Estación de pluma"
              value={gateStationId}
              onChange={setGateStationId}
              options={gateStations}
              placeholder="Buscar estación..."
              searchPlaceholder="Buscar..."
            />
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-start gap-5">
          <Card variant="bordered" className="min-w-0" style={{ flex: '2 1 32rem' }}>
            <CardHeader>
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <ScanLine className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <CardTitle>Leer vale</CardTitle>
                  <CardDescription>
                    Escanea el QR impreso o captura manualmente el código del vale.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <form onSubmit={submit} className="space-y-3">
                <Label htmlFor="dispatch-kiosk-code">Código QR</Label>
                <div className="flex flex-wrap gap-3">
                  <Input
                    ref={inputRef}
                    id="dispatch-kiosk-code"
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                    placeholder="Escanea el código o pega su contenido"
                    autoFocus
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    className="min-w-0 flex-1 font-mono"
                    style={{ flexBasis: '18rem', height: '3.25rem' }}
                  />
                  <Button type="submit" style={{ minHeight: '3.25rem' }} loading={scanMutation.isPending} disabled={!gateStationId || scanMutation.isPending}>
                    <QrCode className="mr-2 h-4 w-4" />
                    Leer código
                  </Button>
                </div>
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Keyboard className="h-4 w-4 shrink-0" />
                  Presiona Enter para procesar la lectura.
                </p>
              </form>

              {result && (
                <div className="rounded-xl border border-border bg-muted/30 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">Última lectura</p>
                    <Badge variant={result.valid ? 'success' : 'destructive'}>
                      {result.valid ? 'QR leído' : 'Código inválido'}
                    </Badge>
                  </div>
                  {result.value && (
                    <p className="mt-3 break-all font-mono text-xs text-muted-foreground">
                      {compactCode(result.value)}
                    </p>
                  )}
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{result.message}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card variant="bordered" className="min-w-0" style={{ flex: '1 1 20rem' }}>
            <CardHeader>
              <CardTitle>Lecturas recientes</CardTitle>
              <CardDescription>Últimos códigos procesados en esta estación.</CardDescription>
            </CardHeader>
            <CardContent>
              {readings.length === 0 ? (
                <EmptyState
                  icon={QrCode}
                  title="Sin lecturas recientes"
                  description="Escanea un vale para iniciar la actividad de la estación."
                />
              ) : (
                <div className="divide-y divide-border">
                  {readings.map((reading) => (
                    <div key={reading.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-xs">{compactCode(reading.value)}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {reading.scannedAt.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </p>
                      </div>
                      <Badge variant={reading.valid ? 'success' : 'destructive'}>
                        {reading.valid ? 'Leído' : 'Inválido'}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

      </div>
    </div>
  )
}
