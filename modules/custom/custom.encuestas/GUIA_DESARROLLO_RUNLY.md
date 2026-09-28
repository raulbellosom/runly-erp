# Guía de desarrollo — Encuestas (`custom.encuestas`)

Este paquete es tu módulo tal como lo generó el Constructor de módulos de Runly. Puedes extenderlo con **pantallas propias hechas en React** y volver a subirlo desde **Módulos > Subir módulo**.

> **Modo visual y modo desarrollador.** Si solo **agregas** pantallas React (archivos en `components/`, vistas `views/<nombre>.custom.js` y sus entradas de menú en el manifiesto), el Constructor las guarda y sigues editando visualmente: se incluyen en cada publicación. Si cambias cualquier otro archivo (por ejemplo `api/`, `models/` o archivos generados), el proyecto pasa a **modo desarrollador** y el Constructor deja de publicarlo para no borrar tu código; desde el editor puedes volver al modo visual después. No borres `.module-definition.json`: con él Runly distingue tus cambios.

**Documentación en línea (siempre actualizada):** https://runly.mx/documentacion/desarrolladores — flujo con ZIP, pantallas React, API de los módulos, relaciones, campos y librerías. Para asistentes de IA: https://runly.mx/llms.txt (índice) y cada página en Markdown (agrega `.md` a su URL). Si usas un asistente de código, dale también el archivo `AGENTS.md` de este paquete.

## 1. Estructura del paquete

```
module.manifest.js        Declaración del módulo: vistas, menú, permisos
models/                   Tablas (no las edites a mano si no sabes de migraciones)
views/                    Pantallas declarativas (tabla, formulario, detalle...)
api/                      API del módulo (Hono)
validators/               Validaciones (Zod)
components/               (tú lo creas) Tus componentes React
.module-definition.json   Definición usada por el Constructor
GUIA_DESARROLLO_RUNLY.md  Esta guía
AGENTS.md                 Instrucciones para asistentes de IA
```

## 2. Crear una pantalla React paso a paso

Se necesitan cuatro cambios. El ejemplo crea un panel en `/app/m/custom.encuestas/encuestas-panel`.

**a) El componente** — `components/EncuestasPanel.jsx`

```jsx
import { useQuery } from '@tanstack/react-query'
import { PageHeader, Card, CardHeader, CardTitle, CardContent, EmptyState, ErrorState, Skeleton, buildApiHeaders } from '@runly/ui'

export default function EncuestasPanel({ token, companyId, apiBaseUrl }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['custom.encuestas', 'datos_de_contactos'],
    queryFn: async () => {
      const res = await fetch(`${apiBaseUrl}/encuestas/datos_de_contactos?pageSize=50`, { headers: buildApiHeaders(token, companyId) })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload?.error ?? 'No se pudieron cargar los datos.')
      return payload
    },
    enabled: Boolean(token),
  })

  return (
    <div className="space-y-6 p-4 md:p-6">
      <PageHeader title="Panel de Encuestas" description="Resumen de datos de contactos" />
      {isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : error ? (
        <ErrorState title="No se pudo cargar" description={error.message} />
      ) : !data?.data?.length ? (
        <EmptyState title="Sin registros" description="Todavía no hay datos de contactos." />
      ) : (
        <Card>
          <CardHeader><CardTitle>Total</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-semibold">{data.pagination?.total ?? data.data.length}</p></CardContent>
        </Card>
      )}
    </div>
  )
}
```

**b) Registrar el componente** — `components/index.js`

```js
export async function register(registry) {
  if (typeof window === 'undefined') return
  const { default: EncuestasPanel } = await import('./EncuestasPanel.jsx')
  registry.register('custom.encuestas:EncuestasPanel', EncuestasPanel)
}
```

**c) Declarar la vista** — `views/encuestas-panel.custom.js`

```js
import { defineView } from '@runly/module-engine'

export default defineView({
  key: 'encuestas.panel',
  kind: 'CUSTOM',
  version: '0.1.0',
  schema: {
    path: '/app/m/custom.encuestas/encuestas-panel',
    component: 'custom.encuestas:EncuestasPanel',
    title: 'Panel',
  },
})
```

La `path` debe ser la **URL completa** `/app/m/custom.encuestas/...`.

**d) Agregarla al manifiesto** — `module.manifest.js`

```js
views: [
  // ...las vistas que ya existen...
  './views/encuestas-panel.custom.js',
],
navigation: [
  // ...las entradas que ya existen...
  { label: 'Panel', path: '/app/m/custom.encuestas/encuestas-panel', icon: 'LayoutDashboard', layout: 'main', permissionKey: 'encuestas.datos_de_contacto.read' },
],
```

Al subir el ZIP, Runly compila `components/` automáticamente (no hay que reconstruir la app) y la entrada aparece en el menú del módulo.

## 3. Qué recibe tu componente

| Prop | Qué es |
|---|---|
| `token` | Token de la sesión del usuario |
| `companyId` | Empresa activa; se manda en el encabezado `X-Runly-Company-Id` |
| `apiBaseUrl` | URL base de la API de esta instancia |
| `navigate` | Función para ir a otra ruta (`navigate('/app/m/custom.encuestas/...')`) |
| `moduleKey` | `custom.encuestas` |

Usa siempre `buildApiHeaders(token, companyId)` de `@runly/ui`: sin el encabezado de empresa, la pantalla falla para usuarios con más de una empresa.

## 4. API de tu módulo

| Entidad | Endpoint | Qué hace | Permiso |
|---|---|---|---|
| Datos de contacto | `GET /encuestas/datos_de_contactos?page=1&pageSize=20&search=` | Lista paginada | `encuestas.datos_de_contacto.read` |
| Datos de contacto | `GET /encuestas/datos_de_contactos/:id` | Un registro | `encuestas.datos_de_contacto.read` |
| Datos de contacto | `POST /encuestas/datos_de_contactos` | Crear | `encuestas.datos_de_contacto.create` |
| Datos de contacto | `PATCH /encuestas/datos_de_contactos/:id` | Editar | `encuestas.datos_de_contacto.update` |
| Datos de contacto | `PATCH /encuestas/datos_de_contactos/:id/enabled` | Activar / desactivar (`{ "enabled": false }`) | `encuestas.datos_de_contacto.delete` |
| Preguntas | `GET /encuestas/preguntass?page=1&pageSize=20&search=` | Lista paginada | `encuestas.preguntas.read` |
| Preguntas | `GET /encuestas/preguntass/:id` | Un registro | `encuestas.preguntas.read` |
| Preguntas | `POST /encuestas/preguntass` | Crear | `encuestas.preguntas.create` |
| Preguntas | `PATCH /encuestas/preguntass/:id` | Editar | `encuestas.preguntas.update` |
| Preguntas | `PATCH /encuestas/preguntass/:id/enabled` | Activar / desactivar (`{ "enabled": false }`) | `encuestas.preguntas.delete` |

- Las listas responden `{ data: [...], pagination: { page, pageSize, total } }`; un registro, `{ data: {...} }`; los errores, `{ error: "mensaje" }`.
- Los campos de relación incluyen `<campo>__label` con el nombre del registro relacionado (y `<campo>__url` si es de otro módulo); las listas aceptan `?<campo>=<id>` para filtrar por relaciones del mismo módulo y `?<campo>=<VALOR>` para campos de selección.
- Todas las operaciones respetan los permisos y la empresa activa del usuario. Errores: 400 datos inválidos o relación no válida, 403 sin permiso, 404 no existe, 409 duplicado o en uso. Referencia completa: https://runly.mx/documentacion/desarrolladores/api-modulos

### Datos de tu módulo

### Datos de contacto (`datos_de_contacto`)

Tabla `encuestas_datos_de_contacto` · API `/encuestas/datos_de_contactos` · permisos `encuestas.datos_de_contacto.read|create|update|delete` · columnas de sistema: `id`, `company_id`, `enabled`, `created_at`, `updated_at`

| Campo | Clave | Tipo | Requerido | Detalle |
|---|---|---|---|---|
| Apellidos | `apellidos` | `text` | Sí |  |
| Nombre | `nombre` | `text` | Sí |  |
| Correo Electrónico  | `correo_electronico` | `text` | Sí |  |
| Telefono | `telefono` | `text` |  |  |
| Imagen de perfil | `imagen_de_perfil` | `file` |  | Archivo (image, máx. 10 MB); guarda el id del archivo |

### Preguntas (`preguntas`)

Tabla `encuestas_preguntas` · API `/encuestas/preguntass` · permisos `encuestas.preguntas.read|create|update|delete` · columnas de sistema: `id`, `company_id`, `enabled`, `created_at`, `updated_at`

| Campo | Clave | Tipo | Requerido | Detalle |
|---|---|---|---|---|
| ¿Que edad tienes? | `que_edad_tienes` | `number` |  |  |
| ¿Quieres seguir participando? | `quieres_seguir_participando` | `boolean` |  |  |

### Relaciones con otros módulos

Tu módulo todavía no tiene relaciones con otros módulos; puedes agregarlas en el Constructor (campo Relación > "Relacionar con"). Desde tus pantallas puedes buscar y resolver registros de Contactos, RR. HH., Flotilla, Inventario, Proyectos, Calendario, Cuentas y Archivos con `/relation-targets` (el usuario necesita el permiso de lectura de ese módulo):

```js
// Buscar: [{ id, title, subtitle }]
fetch(`${apiBaseUrl}/relation-targets/vehicle/search?search=abc`, { headers: buildApiHeaders(token, companyId) })
// Resolver ids (máx. 100): [{ id, title, subtitle, url }] solo los visibles
fetch(`${apiBaseUrl}/relation-targets/vehicle/resolve`, {
  method: 'POST',
  headers: buildApiHeaders(token, companyId, { 'Content-Type': 'application/json' }),
  body: JSON.stringify({ ids }),
})
```

Tipos: `contact`, `hr_employee`, `vehicle`, `inventory_item`, `project`, `task`, `calendar_event`, `ledger_account`, `file`. Detalles: https://runly.mx/documentacion/desarrolladores/relaciones

## 5. Librerías disponibles

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
| `react-hook-form` | 7.75.0 | Se empaqueta en tu módulo (agrega peso) | useForm, Controller (prefiere los campos de @runly/ui) |
| `motion` | 12.38.0 | Se empaqueta en tu módulo (agrega peso) | motion, AnimatePresence (~280 KB, usar con moderacion) |
| `tailwindcss` | 4.3.1 | Estilos | Clases utilitarias en className (sin importar nada) |

Reglas de importación (si no se cumplen, la pantalla no carga):

- Importa los hooks con nombre: `import { useState, useEffect } from 'react'`. **No** uses `import React from 'react'` ni `React.useState()`.
- No agregues `/** @jsxRuntime classic */` ni importes `createElement`.
- Los archivos de componentes deben ser `.jsx` (no TypeScript).
- No hay APIs de Node en el navegador (`fs`, `path`, `crypto`...): eso va en `api/`.
- Para cualquier otra librería del navegador puedes usar `https://esm.sh/<paquete>`, pero prefiere las de la tabla.

## 6. Guía de diseño de Runly

Para que tu pantalla se vea y se comporte como el resto de Runly:

- **Primero `@runly/ui`.** No uses elementos nativos cuando exista un componente:

  | En lugar de | Usa |
  |---|---|
  | `<select>` | `SelectField` o `ComboboxField` |
  | `<input>` / `<textarea>` | `TextField` / `TextareaField` |
  | `<input type="checkbox">` | `CheckboxField` o `SwitchField` |
  | `<input type="date">` | `DatePickerField` |
  | Tabla hecha a mano | `DataTable` o `RunlyTable` |
  | Modal hecho a mano | `Dialog` o `Sheet` |
  | `window.confirm` / `alert` / `prompt` | `ConfirmDialog` (prohibidos los diálogos nativos) |

- Toda pantalla empieza con `PageHeader`. Usa `Skeleton` mientras carga, `EmptyState` si no hay datos y `ErrorState` si algo falla; nunca texto suelto.
- **Textos en español**, sin emojis.
- **Estilos con Tailwind** usando los colores del tema para que funcione en modo claro y oscuro: `bg-[hsl(var(--card))]`, `text-[hsl(var(--muted-foreground))]`, `border-[hsl(var(--border))]`; el color de marca es `var(--brand-primary)`. Evita colores fijos como `bg-white`.
- **Diseño adaptable**: pensado primero para celular (`grid-cols-1 md:grid-cols-3`), sin desplazamiento horizontal.
- En modales y hojas laterales, el encabezado y el pie quedan fijos; solo el contenido central se desplaza.
- Mensajes de éxito o error con `toast` de `sonner`.

## 7. Subir el módulo

1. Comprime la carpeta (con `module.manifest.js` en la raíz del ZIP).
2. En Runly: **Módulos > Subir módulo**, escribe `custom.encuestas` y selecciona el ZIP. Necesitas el permiso `core.modules.upload`.
3. Runly valida el paquete, aplica cambios de tablas seguros, compila `components/` y recarga el módulo. Si el módulo aún no estaba instalado, después dale **Instalar** en su tarjeta del catálogo de Módulos.
4. Si algo falla, el módulo anterior queda intacto y el mensaje indica en qué etapa falló.

## 8. Problemas frecuentes

- **"Cannot read properties of null (reading 'useState')"**: importaste `React` por defecto; usa imports con nombre.
- **El menú muestra la entrada pero la pantalla sale vacía o "Componente no registrado"**: la clave en `registry.register` no coincide con `schema.component`, o falta el `import` en `components/index.js`.
- **La pantalla no aparece**: revisa que la vista esté en `views` del manifiesto y que `path` sea la URL completa.
- **Error 400 "company_required"**: falta `buildApiHeaders(token, companyId)` en tu `fetch`.
- **Error 403**: el usuario no tiene el permiso de la entidad; asígnalo en Identidad > Roles.

## 9. Extensión desarrollador incluida en Encuestas 1.1.0

Esta versión del paquete entra deliberadamente en **modo desarrollador** porque amplía modelos y API para un caso de integración entre módulos.

### Identidad + RR. HH. + Inventario

Una encuesta puede activar `capturar_contexto_inventario`. Cuando está activa:

1. El backend obtiene el `UserProfile.id` del usuario autenticado desde el contexto de Runly.
2. Busca el `HrEmployee` activo de la empresa cuyo `userProfileId` corresponde a ese usuario.
3. Obtiene los `InvItem` activos cuyo `assignedToId` corresponde a ese colaborador.
4. Comprueba permisos externos (`hr.employee.read`, `inventory.assignment.read`, `inventory.item.read`).
5. Usa `moduleContext.relations.resolve` para respetar la visibilidad oficial de `hr_employee` e `inventory_item`.
6. La pantalla también resuelve esos ids mediante `/relation-targets/hr_employee/resolve` y `/relation-targets/inventory_item/resolve` para mostrar títulos, detalles y enlaces según las reglas del módulo dueño.
7. Al enviar, la respuesta guarda una fotografía del usuario, colaborador e inventario que tenía asignado en ese momento.

Endpoint propio:

- `GET /encuestas/respondent-context`: devuelve `{ userProfileId, userName, userEmail, employeeId, employeeName, employeeCode, assignedItemIds, assignedItems }`.

Campos añadidos a `encuestas_respuestas`:

- `respondente_user_id`
- `respondente_user_nombre`
- `respondente_user_correo`
- `respondente_empleado_id`
- `respondente_empleado_nombre`
- `items_asignados_json`
- `items_asignados_total`

El módulo declara dependencias sobre `runly.hr` y `runly.inventory` además de `runly.core`.
