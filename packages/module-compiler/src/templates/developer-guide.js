import { readFileSync } from 'node:fs'
import { moduleSlug, permKey, toPascal } from './helpers.js'

// GUIA_DESARROLLO_RUNLY.md, shipped in every compiled package (and so in the
// Builder's "Descargar ZIP"). Personalized with the module's key, entities
// and API paths; library versions come from runtime-catalog.json (see
// scripts/generate-module-runtime-catalog.mjs).
export const DEVELOPER_GUIDE_PATH = 'GUIA_DESARROLLO_RUNLY.md'

const catalog = JSON.parse(readFileSync(new URL('../runtime-catalog.json', import.meta.url), 'utf8'))

const CATEGORY_LABELS = {
  shared: 'Incluida en la app (no pesa en tu módulo)',
  bundled: 'Se empaqueta en tu módulo (agrega peso)',
  styles: 'Estilos',
}

function libraryTable() {
  const rows = catalog.libraries.map((library) => `| \`${library.name}\` | ${library.version} | ${CATEGORY_LABELS[library.category]} | ${library.imports} |`)
  return ['| Librería | Versión | Disponibilidad | Qué importas |', '|---|---|---|---|', ...rows].join('\n')
}

function endpointTable(config) {
  const slug = moduleSlug(config.key)
  const rows = config.entities.flatMap((entity) => {
    const base = `/${slug}/${entity.name}s`
    return [
      `| ${entity.label} | \`GET ${base}?page=1&pageSize=20&search=\` | Lista paginada | \`${permKey(slug, entity.name, 'read')}\` |`,
      `| ${entity.label} | \`GET ${base}/:id\` | Un registro | \`${permKey(slug, entity.name, 'read')}\` |`,
      `| ${entity.label} | \`POST ${base}\` | Crear | \`${permKey(slug, entity.name, 'create')}\` |`,
      `| ${entity.label} | \`PATCH ${base}/:id\` | Editar | \`${permKey(slug, entity.name, 'update')}\` |`,
      ...(entity.softDelete !== false ? [`| ${entity.label} | \`PATCH ${base}/:id/enabled\` | Activar / desactivar (\`{ "enabled": false }\`) | \`${permKey(slug, entity.name, 'delete')}\` |`] : []),
    ]
  })
  return ['| Entidad | Endpoint | Qué hace | Permiso |', '|---|---|---|---|', ...rows].join('\n')
}

export function generateDeveloperGuide(config) {
  const slug = moduleSlug(config.key)
  const first = config.entities[0]
  const firstBase = `/${slug}/${first.name}s`
  const component = `${toPascal(slug)}Panel`
  const viewPath = `/app/m/${config.key}/${slug}-panel`
  const fence = '```'

  return `# Guía de desarrollo — ${config.name} (\`${config.key}\`)

Este paquete es tu módulo tal como lo generó el Constructor de módulos de Runly. Puedes extenderlo con **pantallas propias hechas en React** y volver a subirlo desde **Módulos > Subir módulo**.

> **Importante — modo avanzado.** Al subir un ZIP con cambios, el proyecto del Constructor se **desvincula** ("modo avanzado"): ya no se podrá editar ni publicar visualmente, para no borrar tu código. Termina primero todo lo que quieras hacer en el Constructor (entidades, campos, diseño, vistas) y guarda una copia de este ZIP antes de modificarlo.

## 1. Estructura del paquete

${fence}
module.manifest.js        Declaración del módulo: vistas, menú, permisos
models/                   Tablas (no las edites a mano si no sabes de migraciones)
views/                    Pantallas declarativas (tabla, formulario, detalle...)
api/                      API del módulo (Hono)
validators/               Validaciones (Zod)
components/               (tú lo creas) Tus componentes React
.module-definition.json   Definición usada por el Constructor
${fence}

## 2. Crear una pantalla React paso a paso

Se necesitan cuatro cambios. El ejemplo crea un panel en \`${viewPath}\`.

**a) El componente** — \`components/${component}.jsx\`

${fence}jsx
import { useQuery } from '@tanstack/react-query'
import { PageHeader, Card, CardHeader, CardTitle, CardContent, EmptyState, ErrorState, Skeleton, buildApiHeaders } from '@runly/ui'

export default function ${component}({ token, companyId, apiBaseUrl }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['${config.key}', '${first.name}s'],
    queryFn: async () => {
      const res = await fetch(\`\${apiBaseUrl}${firstBase}?pageSize=50\`, { headers: buildApiHeaders(token, companyId) })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload?.error ?? 'No se pudieron cargar los datos.')
      return payload
    },
    enabled: Boolean(token),
  })

  return (
    <div className="space-y-6 p-4 md:p-6">
      <PageHeader title="Panel de ${config.name}" description="Resumen de ${String(first.labelPlural ?? first.label).toLowerCase()}" />
      {isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : error ? (
        <ErrorState title="No se pudo cargar" description={error.message} />
      ) : !data?.data?.length ? (
        <EmptyState title="Sin registros" description="Todavía no hay ${String(first.labelPlural ?? first.label).toLowerCase()}." />
      ) : (
        <Card>
          <CardHeader><CardTitle>Total</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-semibold">{data.pagination?.total ?? data.data.length}</p></CardContent>
        </Card>
      )}
    </div>
  )
}
${fence}

**b) Registrar el componente** — \`components/index.js\`

${fence}js
export async function register(registry) {
  if (typeof window === 'undefined') return
  const { default: ${component} } = await import('./${component}.jsx')
  registry.register('${config.key}:${component}', ${component})
}
${fence}

**c) Declarar la vista** — \`views/${slug}-panel.custom.js\`

${fence}js
import { defineView } from '@runly/module-engine'

export default defineView({
  key: '${slug}.panel',
  kind: 'CUSTOM',
  version: '0.1.0',
  schema: {
    path: '${viewPath}',
    component: '${config.key}:${component}',
    title: 'Panel',
  },
})
${fence}

La \`path\` debe ser la **URL completa** \`/app/m/${config.key}/...\`.

**d) Agregarla al manifiesto** — \`module.manifest.js\`

${fence}js
views: [
  // ...las vistas que ya existen...
  './views/${slug}-panel.custom.js',
],
navigation: [
  // ...las entradas que ya existen...
  { label: 'Panel', path: '${viewPath}', icon: 'LayoutDashboard', layout: 'main', permissionKey: '${permKey(slug, first.name, 'read')}' },
],
${fence}

Al subir el ZIP, Runly compila \`components/\` automáticamente (no hay que reconstruir la app) y la entrada aparece en el menú del módulo.

## 3. Qué recibe tu componente

| Prop | Qué es |
|---|---|
| \`token\` | Token de la sesión del usuario |
| \`companyId\` | Empresa activa; se manda en el encabezado \`X-Runly-Company-Id\` |
| \`apiBaseUrl\` | URL base de la API de esta instancia |
| \`navigate\` | Función para ir a otra ruta (\`navigate('/app/m/${config.key}/...')\`) |
| \`moduleKey\` | \`${config.key}\` |

Usa siempre \`buildApiHeaders(token, companyId)\` de \`@runly/ui\`: sin el encabezado de empresa, la pantalla falla para usuarios con más de una empresa.

## 4. API de tu módulo

${endpointTable(config)}

- Las listas responden \`{ data: [...], pagination: { page, pageSize, total } }\`; un registro, \`{ data: {...} }\`; los errores, \`{ error: "mensaje" }\`.
- Los campos de relación incluyen \`<campo>__label\` con el nombre del registro relacionado, y las listas aceptan \`?<campo>=<id>\` para filtrar.
- Todas las operaciones respetan los permisos y la empresa activa del usuario.

## 5. Librerías disponibles

${libraryTable()}

Reglas de importación (si no se cumplen, la pantalla no carga):

- Importa los hooks con nombre: \`import { useState, useEffect } from 'react'\`. **No** uses \`import React from 'react'\` ni \`React.useState()\`.
- No agregues \`/** @jsxRuntime classic */\` ni importes \`createElement\`.
- Los archivos de componentes deben ser \`.jsx\` (no TypeScript).
- No hay APIs de Node en el navegador (\`fs\`, \`path\`, \`crypto\`...): eso va en \`api/\`.
- Para cualquier otra librería del navegador puedes usar \`https://esm.sh/<paquete>\`, pero prefiere las de la tabla.

## 6. Guía de diseño de Runly

Para que tu pantalla se vea y se comporte como el resto de Runly:

- **Primero \`@runly/ui\`.** No uses elementos nativos cuando exista un componente:

  | En lugar de | Usa |
  |---|---|
  | \`<select>\` | \`SelectField\` o \`ComboboxField\` |
  | \`<input>\` / \`<textarea>\` | \`TextField\` / \`TextareaField\` |
  | \`<input type="checkbox">\` | \`CheckboxField\` o \`SwitchField\` |
  | \`<input type="date">\` | \`DatePickerField\` |
  | Tabla hecha a mano | \`DataTable\` o \`RunlyTable\` |
  | Modal hecho a mano | \`Dialog\` o \`Sheet\` |
  | \`window.confirm\` / \`alert\` / \`prompt\` | \`ConfirmDialog\` (prohibidos los diálogos nativos) |

- Toda pantalla empieza con \`PageHeader\`. Usa \`Skeleton\` mientras carga, \`EmptyState\` si no hay datos y \`ErrorState\` si algo falla; nunca texto suelto.
- **Textos en español**, sin emojis.
- **Estilos con Tailwind** usando los colores del tema para que funcione en modo claro y oscuro: \`bg-[hsl(var(--card))]\`, \`text-[hsl(var(--muted-foreground))]\`, \`border-[hsl(var(--border))]\`; el color de marca es \`var(--brand-primary)\`. Evita colores fijos como \`bg-white\`.
- **Diseño adaptable**: pensado primero para celular (\`grid-cols-1 md:grid-cols-3\`), sin desplazamiento horizontal.
- En modales y hojas laterales, el encabezado y el pie quedan fijos; solo el contenido central se desplaza.
- Mensajes de éxito o error con \`toast\` de \`sonner\`.

## 7. Subir el módulo

1. Comprime la carpeta (con \`module.manifest.js\` en la raíz del ZIP).
2. En Runly: **Módulos > Subir módulo**, escribe \`${config.key}\` y selecciona el ZIP. Necesitas el permiso \`core.modules.upload\`.
3. Runly valida el paquete, aplica cambios de tablas seguros, compila \`components/\` y recarga el módulo.
4. Si algo falla, el módulo anterior queda intacto y el mensaje indica en qué etapa falló.

## 8. Problemas frecuentes

- **"Cannot read properties of null (reading 'useState')"**: importaste \`React\` por defecto; usa imports con nombre.
- **El menú muestra la entrada pero la pantalla sale vacía o "Componente no registrado"**: la clave en \`registry.register\` no coincide con \`schema.component\`, o falta el \`import\` en \`components/index.js\`.
- **La pantalla no aparece**: revisa que la vista esté en \`views\` del manifiesto y que \`path\` sea la URL completa.
- **Error 400 "company_required"**: falta \`buildApiHeaders(token, companyId)\` en tu \`fetch\`.
- **Error 403**: el usuario no tiene el permiso de la entidad; asígnalo en Identidad > Roles.
`
}
