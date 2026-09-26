# Documentación pública de módulos en runly-web (Fase 5 del sistema de ayuda)

Date: 2026-09-27
Status: Approved (aprobado por el usuario tras explorar `runly-web` en vivo)
Author: Claude (agente)
Spec file: docs/superpowers/specs/2026-09-27-public-help-docs-runly-web-design.md
Plan file: (combinado en este mismo documento — ver "Plan de implementación")

**Repos involucrados:** este documento vive en `runly` (donde ya viven las
otras 4 fases del sistema de ayuda), pero **toda la implementación de esta
fase es código de `runly-web`** (`../runly-web` relativo a este repo) — un
proyecto Astro 7 separado, sitio de marketing 100% estático
(`output: "static"`, sin backend, desplegado copiando `dist/` a Nginx). El
repo `runly` (este) no recibe ningún cambio de código en esta fase.

## Contexto

Las Fases 1-4 (implementadas y verificadas el 2026-09-26/27) construyeron el
banco de ayuda dentro de cada instancia self-hosted: markdown por
módulo/vista, sincronizado vía `Blueprint` kind `HELP`, con un panel
contextual + página `/help` + widget de IA + tool de MirAI, los 21 módulos
documentados.

El usuario propuso además centralizar ese mismo contenido en un solo lugar
público (en vez de vivir completo dentro de cada instancia), consultable
tanto por humanos como por modelos de IA vía algo con forma de API. Se
exploró `runly-web` en vivo (2026-09-27) y se confirmó:

- Ya existe `src/data/modules.ts`: metadata bilingüe (ES/EN) de los 21
  módulos (nombre, descripción corta, categoría, versión), mantenida a
  mano — y **ya desactualizada** en varias versiones respecto al monorepo
  real (ej. Flota decía `0.5.1`, ya va en `0.6.0`), evidencia de que
  sincronizar a mano sin ayuda ya viene fallando.
- No existe ninguna sección de documentación todavía — el sitio es solo
  landing + páginas legales, bilingüe por archivos duplicados literalmente
  (`src/pages/en/*` espejo de `src/pages/*`).
- Es 100% estático — confirma que **no hace falta backend**, sólo páginas y
  endpoints JSON generados en build time con Astro.

**Decisión de alcance (tomada con el usuario):** el contenido de ayuda
**se queda viviendo en `runly`** (`apps/api/src/manifests/official/help/**/*.md`)
como fuente única de verdad — ahí es donde un desarrollador ya lo edita,
junto al `navigation.path`/permisos del módulo real. `runly-web` lo trae a
su propio build mediante un script de sincronización manual (no CI
automático todavía, dado el tamaño actual del proyecto). Esta fase **no**
toca cómo funciona el banco de ayuda dentro de una instancia (Fases 1-4
siguen exactamente igual) — es un consumidor nuevo y aparte del mismo
contenido fuente.

## Goals

1. Las mismas fuentes markdown de `runly` (overview + vistas, por módulo) se
   pueden copiar a `runly-web` con un solo comando, sin transformación de
   formato.
2. `runly-web` publica una página de documentación humana por módulo
   (`/documentacion/modulos/:moduleKey`), en español (el contenido está en
   español).
3. `runly-web` publica un endpoint JSON estático por módulo
   (`/api/modules/:moduleKey/resumen.json`) con la misma forma de datos
   (overview + views) que ya expone `GET /help/modules/:moduleKey` dentro de
   una instancia, para que un modelo de IA o una instancia lo pueda
   consultar con la misma forma que ya conoce.
4. Todo esto se genera en build time (`astro build`) — cero cómputo por
   request, mismo modelo de despliegue que el resto del sitio (`cp -a
   dist/. /var/www/runly.mx/`).

## Non-goals

1. No se automatiza la sincronización con CI/GitHub Actions todavía — es un
   script que un desarrollador corre a mano cuando el contenido cambia,
   revisa el diff y commitea normalmente.
2. No se traduce el contenido al inglés — las páginas de documentación
   nuevas son solo en español (`/documentacion/...`, sin espejo en
   `/en/documentation/...` por ahora).
3. No se toca `src/data/modules.ts` (el catálogo de marketing) — su drift de
   versiones es un problema aparte, fuera de esta fase.
4. No se cambia nada dentro de `runly` (el ERP) para que consuma esta API
   pública — sigue funcionando 100% con su banco de ayuda local (Fases
   1-4). Que una instancia opcionalmente use esta API pública como
   respaldo es una decisión futura, no de esta fase.
5. No hay analítica de qué artículos se consultan más en `runly-web` (sin
   backend, no hay dónde persistirla) — anotado como posible mejora futura
   si `runly-web` alguna vez gana un modo SSR/serverless.

## Diseño

### Script de sincronización

`runly-web/scripts/sync-help-content.mjs` (Node, ESM, se corre con
`node scripts/sync-help-content.mjs [ruta-a-runly]`):

- Ruta por defecto del repo `runly`: `../runly` (el mismo layout de este
  entorno de desarrollo — sibling folders).
- Origen: `<ruta-runly>/apps/api/src/manifests/official/help/`
- Destino: `runly-web/src/content/help/`
- Falla con un mensaje claro si el origen no existe (evita copiar `undefined`
  silenciosamente).
- Borra el destino completo antes de copiar (evita contenido huérfano si un
  módulo o vista se renombra/elimina en el origen).
- Copia recursivamente solo archivos `.md`, preservando la estructura de
  carpetas (`<moduleKey>/overview.md`, `<moduleKey>/views/<slug>.md`) —
  **sin transformar el contenido ni el frontmatter**: mismo formato
  `title`/`summary`/`viewKey` que ya usa `loadHelpBlueprints` en `runly`.
- Imprime un resumen (cuántos archivos, de cuántos módulos).

### Content Collection de Astro

Astro 7 (Content Layer API): `runly-web/src/content.config.ts` define una
colección `help` con `loader: glob({ pattern: '**/*.md', base:
'./src/content/help' })` y `schema: z.object({ title: z.string(), summary:
z.string(), viewKey: z.string().optional() })`. El `id` que genera el loader
por defecto (ruta relativa sin extensión, ej. `runly.core/overview` o
`runly.core/views/modulos`) ya alcanza para derivar `moduleKey` (primer
segmento) y si es `overview` o una vista (segundo segmento `views`).

### Páginas humanas

- `src/pages/documentacion/modulos/index.astro`: lista todos los módulos que
  tienen al menos una entrada `overview` en la colección, cruzando con
  `src/data/modules.ts` por `id === moduleKey` para el ícono/nombre/color de
  marketing ya existentes (sin duplicar esa metadata).
- `src/pages/documentacion/modulos/[modulo].astro` (`getStaticPaths()` sobre
  los módulos de la colección): una sola página por módulo con el overview
  completo (título + contenido) y, debajo, una sección por cada vista
  (título + contenido) — todo el contenido de un módulo en una sola página,
  dado que cada artículo es corto.

### Endpoints JSON

- `src/pages/api/modules/index.json.ts`: `{ data: [{ moduleKey, title,
  summary }] }` — mismo shape que `GET /help/modules` en la instancia.
- `src/pages/api/modules/[modulo]/resumen.json.ts` (`getStaticPaths()`
  igual que la página): `{ data: { moduleKey, overview: { title, summary,
  content }, views: [{ viewKey, title, summary, content }] } }` — mismo
  shape que `GET /help/modules/:moduleKey` en la instancia (con `content`
  también en cada view, que la instancia no incluye ahí pero aquí sí tiene
  sentido dar completo ya que es la fuente pública).

### `modules.ts`

Sin cambios en esta fase (non-goal #3).

## Plan de implementación

1. Crear `runly-web/scripts/sync-help-content.mjs`.
2. Escribir un test unitario (`vitest`) para su función pura de "listar
   archivos .md recursivamente" / "derivar moduleKey e id desde una ruta"
   — la parte de I/O (borrar/copiar) no se testea con mocks pesados, sólo la
   lógica de nombres, seguros el patrón `lean test coverage` de este
   proyecto.
3. Correr el script una vez contra este `runly` real; confirmar que
   `src/content/help/` queda poblado (91 archivos, 21 módulos).
4. Crear `runly-web/src/content.config.ts` con la colección `help`.
5. Crear las páginas de documentación (`index.astro` + `[modulo].astro`).
6. Crear los endpoints JSON (`index.json.ts` + `[modulo]/resumen.json.ts`).
7. `pnpm astro check` — sin errores de tipos.
8. `pnpm build` — build estático limpio; inspeccionar `dist/documentacion/`
   y `dist/api/modules/` para confirmar que los archivos esperados existen.
9. `pnpm test` (vitest) completo — sin regresiones en los tests existentes.
10. Documentar el flujo nuevo en `runly-web/README.md` (cuándo correr el
    script, qué genera, que es manual).
11. Commit en `runly-web`.
12. Commit en `runly` (este documento).

## Verification plan

- `node runly-web/scripts/sync-help-content.mjs ../runly` desde
  `runly-web/`, confirmar conteo de archivos/módulos impreso.
- `pnpm --filter` no aplica (no es monorepo pnpm-workspace) — comandos
  directos dentro de `runly-web/`: `pnpm astro check`, `pnpm build`,
  `pnpm test`.
- Inspección manual de 2-3 archivos generados en `dist/` (una página de
  documentación, un endpoint JSON) para confirmar contenido correcto.
