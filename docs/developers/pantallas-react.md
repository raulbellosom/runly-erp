---
title: Pantallas React
summary: Cómo crear una vista CUSTOM con un componente React, registrarla, agregarla al menú, llamar a la API y respetar el diseño de Runly.
order: 2
---
## Receta (cuatro cambios)

**1. El componente** — `components/Panel.jsx`

```jsx
import { useQuery } from '@tanstack/react-query'
import { PageHeader, Card, CardHeader, CardTitle, CardContent, EmptyState, ErrorState, Skeleton, buildApiHeaders } from '@runly/ui'

export default function Panel({ token, companyId, apiBaseUrl }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['custom.visitas', 'visitas'],
    queryFn: async () => {
      const res = await fetch(`${apiBaseUrl}/visitas/visitas?pageSize=50`, { headers: buildApiHeaders(token, companyId) })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload?.error ?? 'No se pudieron cargar los datos.')
      return payload
    },
    enabled: Boolean(token),
  })
  if (isLoading) return <Skeleton className="h-32 w-full" />
  if (error) return <ErrorState title="No se pudo cargar" description={error.message} />
  return (
    <div className="space-y-6 p-4 md:p-6">
      <PageHeader title="Panel" description="Resumen" />
      {!data.data.length ? <EmptyState title="Sin registros" description="Todavía no hay visitas." /> : (
        <Card><CardHeader><CardTitle>Total</CardTitle></CardHeader><CardContent><p className="text-3xl font-semibold">{data.pagination.total}</p></CardContent></Card>
      )}
    </div>
  )
}
```

**2. Registrarlo** — `components/index.js`

```js
export async function register(registry) {
  if (typeof window === 'undefined') return
  const { default: Panel } = await import('./Panel.jsx')
  registry.register('custom.visitas:Panel', Panel)   // <clave del módulo>:<Componente>
}
```

**3. Declarar la vista** — `views/panel.custom.js`

```js
import { defineView } from '@runly/module-engine'
export default defineView({
  key: 'visitas.panel',
  kind: 'CUSTOM',
  version: '0.1.0',
  schema: { path: '/app/m/custom.visitas/panel', component: 'custom.visitas:Panel', title: 'Panel' },
})
```

`schema.path` es la **URL completa** (`/app/m/<clave del módulo>/...`) y `schema.component` debe coincidir con la clave de `registry.register`.

**4. Manifiesto** — agrega `'./views/panel.custom.js'` a `views` y, si debe verse en el menú, una entrada en `navigation`:

```js
{ label: 'Panel', path: '/app/m/custom.visitas/panel', icon: 'LayoutDashboard', layout: 'main', permissionKey: 'visitas.visita.read' }
```

## Props que recibe el componente

| Prop | Qué es |
|---|---|
| `token` | Token de la sesión |
| `companyId` | Empresa activa (encabezado `X-Runly-Company-Id`) |
| `apiBaseUrl` | URL base de la API de la instancia |
| `navigate` | Navegación interna (`navigate('/app/m/...')`) |
| `moduleKey` | Clave del módulo |

Usa siempre `buildApiHeaders(token, companyId)` en tus `fetch`: sin el encabezado de empresa, la pantalla falla para usuarios con más de una empresa (error `company_required`).

## Reglas de importación

- Hooks con import nombrado: `import { useState, useEffect } from 'react'`. **No** `import React from 'react'` ni `React.useState()` (rompe con *Cannot read properties of null (reading 'useState')*).
- Sin `/** @jsxRuntime classic */` ni `createElement`: se usa el runtime JSX automático.
- Archivos `.jsx` (TypeScript no está soportado en los bundles de módulos).
- Nada de APIs de Node (`fs`, `path`, `crypto`) en el navegador; eso va en `api/`.
- Qué librerías hay y con qué versión: ver *Librerías disponibles*.

## Reglas de diseño de Runly

- Primero `@runly/ui`: props y ejemplos de cada componente en **[Componentes de @runly/ui](/documentacion/desarrolladores/componentes)**. `SelectField`/`ComboboxField` en lugar de `<select>`, `TextField`/`TextareaField` en lugar de inputs, `CheckboxField`/`SwitchField`, `DatePickerField`, `DataTable`/`RunlyTable`, `Dialog`/`Sheet`, y `ConfirmDialog` en lugar de `window.confirm/alert/prompt` (prohibidos).
- Toda pantalla empieza con `PageHeader`; `Skeleton` al cargar, `EmptyState` si no hay datos, `ErrorState` si algo falla.
- Iconos de `lucide-react` en títulos de sección, botones, indicadores y estados vacíos: lista por uso en **[Iconos](/documentacion/desarrolladores/iconos)**. Textos en español y sin emojis.
- **Cualquier clase de Tailwind funciona**: al instalar el módulo Runly genera el CSS de las clases que usan tus componentes, con el tema de Runly. Usa los tokens del tema para que funcione en modo claro y oscuro: `bg-card`, `bg-background`, `bg-muted`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary`, `text-primary`. Evita colores fijos como `bg-white` o `bg-[#fff]`.
- Pensado primero para celular: formularios en `grid grid-cols-1 gap-4 md:grid-cols-2`, indicadores en `grid gap-4 sm:grid-cols-2 lg:grid-cols-4`, sin desplazamiento horizontal.
- Formularios por secciones (`Card` con título e icono), no una lista de campos uno debajo de otro.
- En modales y hojas laterales el encabezado y el pie quedan fijos; solo el contenido se desplaza.
- Notificaciones con `toast` de `sonner`.
- Al subir el ZIP, la **Revisión de diseño** del reporte lista archivo y línea de lo que no cumple estas reglas; con **Copiar para la IA** se lo pasas a tu asistente para que lo corrija.

## Problemas frecuentes

- *Componente no registrado*: la clave de `registry.register` no coincide con `schema.component`, o falta el `import` en `components/index.js`.
- La pantalla no aparece: la vista no está en `views` del manifiesto o `path` no es la URL completa.
- Error 403: el usuario no tiene el permiso de la entidad (asígnalo en Identidad > Roles).
