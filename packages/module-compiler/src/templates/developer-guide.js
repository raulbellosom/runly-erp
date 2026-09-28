import { readFileSync } from 'node:fs'
import { moduleSlug, permKey, toPascal } from './helpers.js'
import { externalTarget, isExternalRelation } from '../external-relations.js'

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

// Public developer docs (runly-web). Markdown versions and llms.txt let AI
// assistants read the current documentation.
export const DEVELOPER_DOCS_URL = 'https://runly.mx/documentacion/desarrolladores'
export const LLMS_TXT_URL = 'https://runly.mx/llms.txt'

function fieldDetail(field) {
  if (field.type === 'select' || field.type === 'multiselect') return `Valores: ${(field.options ?? []).map((value) => `\`${value}\``).join(', ')}`
  if (isExternalRelation(field)) {
    const target = externalTarget(field.targetExternal)
    return target ? `${target.label} de ${target.moduleName} (\`${field.targetExternal}\`); la API agrega \`${field.name}__label\` y \`${field.name}__url\`` : ''
  }
  if (field.type === 'relation') {
    const rule = { restrict: 'bloquea desactivar el relacionado mientras se use', setNull: 'se vacía si se desactiva el relacionado', cascade: 'se desactiva junto con el relacionado' }[field.onDisable ?? 'restrict']
    return `Relación con la entidad \`${field.targetEntity ?? field.relatedModel}\` de este módulo${field.labelField ? ` (muestra \`${field.labelField}\`)` : ''}; ${rule}; la API agrega \`${field.name}__label\` y acepta \`?${field.name}=<id>\``
  }
  if (field.type === 'file') return `Archivo (${field.accept ?? 'any'}${field.camera ? ', cámara' : ''}, máx. ${field.maxSizeMB ?? 10} MB); guarda el id del archivo`
  return ''
}

function dataDictionary(config) {
  return config.entities.map((entity) => {
    const rows = entity.fields.map((field) => `| ${field.label || field.name} | \`${field.name}\` | \`${field.type}\` | ${field.required ? 'Sí' : ''} | ${fieldDetail(field)} |`)
    const slug = moduleSlug(config.key)
    const header = `Tabla \`${slug}_${entity.name}\` · API \`/${slug}/${entity.name}s\` · permisos \`${slug}.${entity.name}.read|create|update|delete\` · columnas de sistema: \`id\`, \`company_id\`, \`enabled\`, \`created_at\`, \`updated_at\``
    return [`### ${entity.label} (\`${entity.name}\`)`, '', header, '', '| Campo | Clave | Tipo | Requerido | Detalle |', '|---|---|---|---|---|', ...rows].join('\n')
  }).join('\n\n')
}

function externalRelationsNote(config) {
  const used = [...new Set(config.entities.flatMap((entity) => entity.fields.filter(isExternalRelation).map((field) => field.targetExternal)))]
  const list = used.length
    ? `Tu módulo ya se relaciona con: ${used.map((type) => `${externalTarget(type)?.label ?? type} (\`${type}\`)`).join(', ')}.`
    : 'Tu módulo todavía no tiene relaciones con otros módulos; puedes agregarlas en el Constructor (campo Relación > "Relacionar con").'
  return list
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

> **Modo visual y modo desarrollador.** Si solo **agregas** pantallas React (archivos en \`components/\`, vistas \`views/<nombre>.custom.js\` y sus entradas de menú en el manifiesto), el Constructor las guarda y sigues editando visualmente: se incluyen en cada publicación. Si cambias cualquier otro archivo (por ejemplo \`api/\`, \`models/\` o archivos generados), el proyecto pasa a **modo desarrollador** y el Constructor deja de publicarlo para no borrar tu código; desde el editor puedes volver al modo visual después. No borres \`.module-definition.json\`: con él Runly distingue tus cambios.

**Documentación en línea (siempre actualizada):** ${DEVELOPER_DOCS_URL} — flujo con ZIP, pantallas React, API de los módulos, relaciones, campos y librerías. Para asistentes de IA: ${LLMS_TXT_URL} (índice) y cada página en Markdown (agrega \`.md\` a su URL). Si usas un asistente de código, dale también el archivo \`AGENTS.md\` de este paquete.

## 1. Estructura del paquete

${fence}
module.manifest.js        Declaración del módulo: vistas, menú, permisos
models/                   Tablas (no las edites a mano si no sabes de migraciones)
views/                    Pantallas declarativas (tabla, formulario, detalle...)
api/                      API del módulo (Hono)
validators/               Validaciones (Zod)
components/               (tú lo creas) Tus componentes React
.module-definition.json   Definición usada por el Constructor
GUIA_DESARROLLO_RUNLY.md  Esta guía
AGENTS.md                 Instrucciones para asistentes de IA
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
- Los campos de relación incluyen \`<campo>__label\` con el nombre del registro relacionado (y \`<campo>__url\` si es de otro módulo); las listas aceptan \`?<campo>=<id>\` para filtrar por relaciones del mismo módulo y \`?<campo>=<VALOR>\` para campos de selección.
- Todas las operaciones respetan los permisos y la empresa activa del usuario. Errores: 400 datos inválidos o relación no válida, 403 sin permiso, 404 no existe, 409 duplicado o en uso. Referencia completa: ${DEVELOPER_DOCS_URL}/api-modulos

### Datos de tu módulo

${dataDictionary(config)}

### Relaciones con otros módulos

${externalRelationsNote(config)} Desde tus pantallas puedes buscar y resolver registros de Contactos, RR. HH., Flotilla, Inventario, Proyectos, Calendario, Cuentas y Archivos con \`/relation-targets\` (el usuario necesita el permiso de lectura de ese módulo):

${fence}js
// Buscar: [{ id, title, subtitle }]
fetch(\`\${apiBaseUrl}/relation-targets/vehicle/search?search=abc\`, { headers: buildApiHeaders(token, companyId) })
// Resolver ids (máx. 100): [{ id, title, subtitle, url }] solo los visibles
fetch(\`\${apiBaseUrl}/relation-targets/vehicle/resolve\`, {
  method: 'POST',
  headers: buildApiHeaders(token, companyId, { 'Content-Type': 'application/json' }),
  body: JSON.stringify({ ids }),
})
${fence}

Tipos: \`contact\`, \`hr_employee\`, \`vehicle\`, \`inventory_item\`, \`project\`, \`task\`, \`calendar_event\`, \`ledger_account\`, \`file\`. Detalles: ${DEVELOPER_DOCS_URL}/relaciones

## 5. Librerías disponibles

${libraryTable()}

Reglas de importación (si no se cumplen, la pantalla no carga):

- Importa los hooks con nombre: \`import { useState, useEffect } from 'react'\`. **No** uses \`import React from 'react'\` ni \`React.useState()\`.
- No agregues \`/** @jsxRuntime classic */\` ni importes \`createElement\`.
- Los archivos de componentes deben ser \`.jsx\` (no TypeScript).
- No hay APIs de Node en el navegador (\`fs\`, \`path\`, \`crypto\`...): eso va en \`api/\`.
- Para otra librería ESM del navegador puedes importar una URL HTTPS completa, por ejemplo \`https://esm.sh/<paquete>@<versión>\`. Fija la versión, usa proveedores confiables y prefiere las librerías compartidas de la tabla para no depender de la red.

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

1. Aumenta \`version\` en \`module.manifest.js\` y comprime la carpeta (con \`module.manifest.js\` en la raíz del ZIP).
2. En Runly: **Subir actualización** en el editor del Constructor, o **Módulos > Subir módulo** escribiendo \`${config.key}\`. Necesitas el permiso \`core.modules.upload\`.
3. **Revisión**: Runly valida el paquete, lista los cambios de tablas y muestra una vista previa de tus pantallas. Todavía no se aplica nada. Si el módulo no está instalado, la vista previa muestra errores 404 porque su API aún no existe: es normal.
4. **Aplicar**: clic en **Subir módulo** / **Aplicar actualización**. Runly aplica los cambios de tablas seguros, compila \`components/\` y recarga el módulo.
5. **Primera vez**: dale **Instalar** en la tarjeta del módulo en el Catálogo de módulos.
6. Si algo falla, el módulo anterior queda intacto y el mensaje indica en qué etapa falló. Errores frecuentes: ${DEVELOPER_DOCS_URL}/solucion-problemas

## 8. Problemas frecuentes

- **"Cannot read properties of null (reading 'useState')"**: importaste \`React\` por defecto; usa imports con nombre.
- **El menú muestra la entrada pero la pantalla sale vacía o "Componente no registrado"**: la clave en \`registry.register\` no coincide con \`schema.component\`, o falta el \`import\` en \`components/index.js\`.
- **La pantalla no aparece**: revisa que la vista esté en \`views\` del manifiesto y que \`path\` sea la URL completa.
- **Error 400 "company_required"**: falta \`buildApiHeaders(token, companyId)\` en tu \`fetch\`.
- **Error 403**: el usuario no tiene el permiso de la entidad; asígnalo en Identidad > Roles.
`
}

// AGENTS.md: instructions for AI coding assistants working on the package.
export const AGENTS_FILE_PATH = 'AGENTS.md'

export function generateAgentsFile(config) {
  const slug = moduleSlug(config.key)
  return `# Instrucciones para asistentes de IA — ${config.key}

Este paquete es un módulo de Runly generado por el Constructor de módulos. Antes de cambiar nada, lee \`GUIA_DESARROLLO_RUNLY.md\` (personalizada para este módulo) y la documentación actual:

- Índice para IA: ${LLMS_TXT_URL}
- Documentación de desarrolladores: ${DEVELOPER_DOCS_URL} (cada página también en Markdown agregando \`.md\`)

## Reglas

1. Para mantener el módulo editable en el Constructor, **solo agrega**: archivos en \`components/\` (.js, .jsx, .css, .json, .svg), vistas \`views/<nombre>.custom.js\` de tipo CUSTOM y sus entradas en \`views\` y \`navigation\` de \`module.manifest.js\`. Cambiar cualquier otro archivo pasa el módulo a modo desarrollador.
2. No edites ni borres \`.module-definition.json\`, \`models/\`, ni los archivos generados de \`api/\`, \`views/\` y \`validators/\` salvo que la persona pida explícitamente trabajar en modo desarrollador.
3. Componentes en \`.jsx\` (sin TypeScript), runtime JSX automático, hooks con import nombrado (\`import { useState } from 'react'\`, nunca \`React.useState\`). Sin APIs de Node en el navegador.
4. Registra cada componente en \`components/index.js\` con la clave \`${config.key}:<Componente>\`; la vista CUSTOM usa esa clave en \`schema.component\` y la URL completa \`/app/m/${config.key}/...\` en \`schema.path\`.
5. Llama a la API con \`fetch(apiBaseUrl + '/${slug}/...', { headers: buildApiHeaders(token, companyId) })\` usando las props del componente (\`token\`, \`companyId\`, \`apiBaseUrl\`). Datos de otros módulos: \`/relation-targets/<tipo>/search\` y \`/resolve\`.
6. UI con \`@runly/ui\` (PageHeader, SelectField, TextField, DataTable, Dialog, Sheet, ConfirmDialog, EmptyState, ErrorState, Skeleton…), nunca \`window.confirm/alert/prompt\` ni controles nativos si existe el componente. Textos en español, sin emojis. Tailwind con tokens del tema (\`hsl(var(--card))\`, \`var(--brand-primary)\`).
7. Solo usa las librerías listadas en la guía (sección *Librerías disponibles*) con esas versiones.
8. Sube la versión en \`module.manifest.js\` antes de entregar. La persona sube el ZIP en Runly con "Subir actualización": Runly lo valida y muestra una vista previa antes de aplicar.
`
}
