---
title: Librerías disponibles
summary: Qué puedes importar en los componentes React de un módulo de Runly, con la versión exacta instalada.
order: 6
---
Estas son las librerías que un componente de `components/` puede importar. Las marcadas como *incluidas en la app* se resuelven en tiempo de ejecución y no pesan en tu módulo; las demás las empaqueta esbuild dentro del bundle del módulo.

| Librería | Versión | Disponibilidad | Qué importas |
|---|---|---|---|
| `react` | 19.3.0 | Incluida en la app (no pesa en tu módulo) | useState, useEffect, useMemo, useCallback, useRef, useContext, createContext, forwardRef, memo, Fragment |
| `react-dom` | 19.3.0 | Incluida en la app (no pesa en tu módulo) | createPortal, flushSync |
| `@runly/ui` | 0.1.0 | Incluida en la app (no pesa en tu módulo) | PageHeader, Card, Button, TextField, SelectField, DatePickerField, RunlyTable, DataTable, Dialog, Sheet, ConfirmDialog, EmptyState, ErrorState, Skeleton, Badge, Tabs, buildApiHeaders ... |
| `@runly/sdk` | 0.1.0 | Incluida en la app (no pesa en tu módulo) | createRunlyClient |
| `@runly/validators` | 0.1.0 | Incluida en la app (no pesa en tu módulo) | Esquemas Zod compartidos |
| `@tanstack/react-query` | 5.104.0 | Incluida en la app (no pesa en tu módulo) | useQuery, useMutation, useQueryClient |
| `react-router-dom` | 7.18.3 | Incluida en la app (no pesa en tu módulo) | useNavigate, useParams, useLocation, Link |
| `zustand` | 5.0.15 | Incluida en la app (no pesa en tu módulo) | create |
| `sonner` | 2.0.7 | Incluida en la app (no pesa en tu módulo) | toast |
| `lucide-react` | 1.48.0 | Incluida en la app (no pesa en tu módulo) | Iconos: Plus, Pencil, Trash2, Search, Calendar ... |
| `recharts` | 3.8.1 | Incluida en la app (no pesa en tu módulo) | ResponsiveContainer, BarChart, LineChart, PieChart, AreaChart, Tooltip, Legend |
| `qrcode` | 1.5.4 | Incluida en la app (no pesa en tu módulo) | QRCode (default), create, toCanvas, toDataURL, toString para generar códigos QR |
| `@zxing/browser` | 0.2.1 | Incluida en la app (no pesa en tu módulo) | BrowserQRCodeReader, BrowserMultiFormatReader para leer códigos QR desde cámara, imagen o video |
| `react-hook-form` | 7.75.0 | Se empaqueta en tu módulo (agrega peso) | useForm, Controller (prefiere los campos de @runly/ui) |
| `motion` | 12.38.0 | Se empaqueta en tu módulo (agrega peso) | motion, AnimatePresence (~280 KB, usar con moderacion) |
| `tailwindcss` | 4.3.1 | Estilos | Clases utilitarias en className (sin importar nada) |

## Componentes de @runly/ui por uso

| Para | Usa |
|---|---|
| Estructura de pantalla | `PageHeader`, `SectionCard`, `Card` (`CardHeader`, `CardTitle`, `CardContent`), `Tabs` (`TabsList`, `TabsTrigger`, `TabsContent`), `Separator`, `PageFooter` |
| Estados | `Skeleton`, `LoadingState`, `EmptyState`, `ErrorState`, `Alert` |
| Indicadores | `StatCard`, `StatStrip`, `Badge`, `ProgressBar`, `ProgressMeter`, `RingProgress` |
| Formularios | `TextField`, `TextareaField`, `NumberField`, `CurrencyField`, `SelectField`, `ComboboxField`, `CreatableComboboxField`, `TagsComboboxField`, `CheckboxField`, `SwitchField`, `DatePickerField`, `SwatchField`, `IconPickerField`, `MarkdownField`, `SegmentedControl` |
| Tablas y listas | `DataTable`, `RunlyTable`, `SearchInput`, `FilterBar`, `SortableList` |
| Ventanas y menús | `Dialog`, `Sheet`, `ConfirmDialog`, `DropdownMenu`, `ActionMenu`, `Popover`, `Tooltip` |
| Archivos y cámara | `FileUploader`, `FileAssetField`, `AttachmentsPanel`, `ImageViewer`, `CameraCaptureDialog` |
| Utilidades | `Button`, `CopyableValue`, `MarkdownViewer`, `buildApiHeaders`, `cn`, `useIsMobile` |

`window.confirm`, `window.alert` y `window.prompt` están prohibidos: usa `ConfirmDialog` o `Dialog`.

## Ejemplos

**Datos con TanStack Query** (lectura y escritura):

```jsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { buildApiHeaders } from '@runly/ui'
import { toast } from 'sonner'

function useEncuestas({ token, companyId, apiBaseUrl }) {
  return useQuery({
    queryKey: ['custom.encuestas', 'encuestas'],
    queryFn: async () => {
      const res = await fetch(`${apiBaseUrl}/encuestas/encuestas?pageSize=100`, { headers: buildApiHeaders(token, companyId) })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload?.error ?? 'No se pudieron cargar las encuestas.')
      return payload.data
    },
    enabled: Boolean(token),
  })
}

function useCrearEncuesta({ token, companyId, apiBaseUrl }) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (values) => {
      const res = await fetch(`${apiBaseUrl}/encuestas/encuestas`, {
        method: 'POST',
        headers: { ...buildApiHeaders(token, companyId), 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload?.error ?? 'No se pudo crear.')
      return payload.data
    },
    onSuccess: () => {
      toast.success('Encuesta creada')
      queryClient.invalidateQueries({ queryKey: ['custom.encuestas'] })
    },
    onError: (error) => toast.error(error.message),
  })
}
```

Empieza cada `queryKey` con la clave del módulo para no chocar con otras pantallas.

**Confirmación de una acción destructiva:**

```jsx
import { useState } from 'react'
import { Button, ConfirmDialog } from '@runly/ui'

function DesactivarBoton({ onConfirm }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>Desactivar</Button>
      <ConfirmDialog open={open} onOpenChange={setOpen} title="¿Desactivar la encuesta?"
        description="Dejará de aparecer en las listas." confirmLabel="Desactivar" onConfirm={onConfirm} />
    </>
  )
}
```

**Gráfica con recharts** (usa los colores del tema):

```jsx
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts'

<ResponsiveContainer width="100%" height={260}>
  <BarChart data={conteos}>
    <XAxis dataKey="opcion" />
    <YAxis allowDecimals={false} />
    <Tooltip />
    <Bar dataKey="total" fill="var(--brand-primary)" radius={[6, 6, 0, 0]} />
  </BarChart>
</ResponsiveContainer>
```

**Navegación** con la prop `navigate` o `react-router-dom`:

```jsx
import { useParams } from 'react-router-dom'
navigate('/app/m/custom.encuestas/resultados')
```

**Código QR** (generar y leer):

```jsx
import QRCode from 'qrcode'
import { BrowserQRCodeReader } from '@zxing/browser'

const dataUrl = await QRCode.toDataURL('https://example.com/e/123')
const reader = new BrowserQRCodeReader()
const controls = await reader.decodeFromVideoDevice(undefined, videoRef.current, (result) => {
  if (result) { controls.stop(); onScan(result.getText()) }
})
```

**Estado local compartido** entre componentes del módulo con `zustand`:

```js
import { create } from 'zustand'
export const useFiltros = create((set) => ({ estado: 'TODAS', setEstado: (estado) => set({ estado }) }))
```

## Librerías externas

También puedes importar librerías ESM del navegador mediante una URL HTTPS completa, por ejemplo `https://esm.sh/<paquete>@<versión>`. El import se conserva en el bundle y el navegador lo descarga en tiempo de ejecución. Fija siempre la versión, usa sólo proveedores confiables y prefiere las librerías compartidas de la tabla para evitar depender de la red. No hay APIs de Node (`fs`, `path`, `crypto`) en el navegador.

*Página generada por `scripts/generate-module-runtime-catalog.mjs` a partir de las versiones instaladas en Runly.*
