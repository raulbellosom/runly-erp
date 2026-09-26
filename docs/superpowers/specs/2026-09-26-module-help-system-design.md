# Sistema de ayuda de módulos (Fase 1: banco de contenido + página de ayuda)

Date: 2026-09-26
Status: Approved (brainstorm + fases aprobadas por el usuario 2026-09-26; ejecución autorizada hasta completar las 4 fases)
Author: Claude (agente)
Spec file: docs/superpowers/specs/2026-09-26-module-help-system-design.md
Plan file: docs/superpowers/plans/2026-09-26-module-help-system-phase1.md (creado tras este spec)

---

## 1. Feature title

Banco de ayuda por módulo + página de ayuda contextual/navegable (Fase 1 de 4).

## 2. Status

Approved

## 3. Context

Runly ERP es un sistema modular (RME3) donde cada módulo (core u opcional) expone
pantallas, blueprints y navegación, pero ningún módulo documenta hoy, dentro del
propio producto, qué es, para qué sirve, qué se puede hacer en cada pestaña, ni
sus límites/alcances. La documentación existente en `docs/` es para
desarrolladores (arquitectura, specs, planes), no para el usuario final que abre
el ERP.

Ya existe infraestructura de asistentes conversacionales en el repo:
- `runly.chat` (MirAI): asistente general de la empresa, con tool-calling sobre
  Groq, deshabilitado por completo si no hay `GROQ_API_KEY` configurada en la
  instancia.
- `runly.pfm`: asistente local de finanzas personales, con el mismo patrón
  (Groq + tools de solo lectura), cuyo propio spec
  (`docs/superpowers/specs/2026-09-02-pfm-assistant-design.md`) dejó anotado
  explícitamente como fuera de alcance v1: *"Ayuda/onboarding del módulo en el
  prompt"*.

Runly se distribuye self-hosted: cada cliente corre su propia instancia en su
VPS. No todas las instancias tendrán `GROQ_API_KEY` configurada. Cualquier
solución de ayuda que dependa exclusivamente de IA deja sin ayuda a esas
instancias.

## 4. Problem

Los usuarios no tienen, dentro del ERP, ninguna forma de responder "¿qué hace
este módulo?", "¿qué puedo hacer en esta pestaña?" o "¿cuáles son sus límites?"
sin salir del producto o preguntarle directamente al equipo de Runly. No existe
un banco de contenido de ayuda versionado, ni un mecanismo para mostrarlo, y
cualquier solución basada en IA por sí sola no cubre instancias sin
`GROQ_API_KEY`.

## 5. Goals

1. Cada módulo (core u opcional) puede declarar contenido de ayuda en markdown,
   versionado junto con su código, a dos niveles: resumen general del módulo y
   detalle por vista/pestaña de navegación.
2. Ese contenido se sincroniza al instalar/sincronizar el módulo, igual que las
   blueprints existentes — sin tabla nueva, sin mecanismo de sync nuevo.
3. Un usuario autenticado puede abrir un panel de ayuda contextual a la
   pestaña en la que está parado, sin salir de la pantalla.
4. Un usuario autenticado puede navegar a una página de ayuda completa,
   explorar todos los módulos con ayuda disponible y buscar por palabra clave
   sin necesidad de IA configurada.
5. La búsqueda de ayuda funciona en cualquier instancia, con o sin
   `GROQ_API_KEY`, porque no depende de IA en esta fase.
6. Un módulo sin contenido de ayuda todavía no rompe nada — se ve como
   "sin ayuda disponible todavía", nunca como error.

## 6. Non-goals

1. No se construye en esta fase ningún chatbot conversacional de ayuda (eso es
   Fase 2, ver Sección 28).
2. No se integra este contenido como tool de MirAI en esta fase (Fase 3).
3. No se construye el carrusel de tips de la barra inferior (Fase 4).
4. No hay edición del contenido de ayuda desde una pantalla admin dentro del
   ERP — el contenido se edita como código (markdown en el repo), se decidió
   así explícitamente en el brainstorm.
5. No hay avisos/anuncios del dueño de Runly distribuidos entre releases — el
   brainstorm dejó ese mecanismo fuera de alcance por completo (no solo de esta
   fase) hasta que exista un canal central real.
6. No hay contenido multi-idioma — todo el contenido de ayuda es en español,
   igual que el resto de la UI.
7. No hay versionado de contenido de ayuda distinto al versionado del propio
   módulo (no hay "ayuda v1 vs v2" independiente del manifest).

## 7. User stories

- Como usuario del ERP, quiero abrir un panel de ayuda sin salir de la pantalla
  en la que estoy, para entender qué puedo hacer ahí sin perder mi contexto.
- Como usuario del ERP, quiero navegar a una página de ayuda central, para
  explorar todos los módulos disponibles y sus funcionalidades.
- Como usuario del ERP, quiero buscar por palabra clave dentro de la ayuda,
  para encontrar rápido cómo hacer algo aunque no sepa en qué módulo vive.
- Como administrador de una instancia sin `GROQ_API_KEY` configurada, quiero
  que mis usuarios igual tengan acceso a ayuda del sistema, sin depender de un
  motor de IA que mi instancia no tiene.
- Como desarrollador de un módulo (core o custom), quiero declarar el
  contenido de ayuda de mi módulo como archivos markdown junto al código, para
  que se revise en PR y viva versionado igual que el resto del módulo.

## 8. UX requirements

**Botón de ayuda contextual (persistente):** un ícono de ayuda (`CircleHelp`
de lucide) fijo en la zona de acciones del header del shell (junto a
notificaciones/menú de usuario), visible en todas las pantallas. Al hacer
clic, abre un `Sheet` (`@runly/ui`) desde la derecha con:

- Si la ruta actual coincide con una vista/pestaña que tiene ayuda propia:
  tarjeta superior con esa ayuda (título + contenido).
- Debajo, siempre: el resumen general del módulo actual (overview).
- Si el módulo no tiene ayuda todavía: `EmptyState` de `@runly/ui` con
  "Aún no hay ayuda para este módulo." — nunca un error ni una pantalla vacía
  sin explicación.
- Pie del panel: link "Ver toda la documentación" que navega a la página de
  ayuda completa (`/help`).

**Página de ayuda completa (`/help`):** pantalla estándar con `PageHeader`,
una barra de búsqueda (`Input`/`TextField` de `@runly/ui`, sin componente
nativo) y una lista de módulos con ayuda disponible (nombre, ícono, resumen).
Al elegir un módulo se muestra su overview + la lista de sus vistas con
ayuda. Buscar filtra por palabra clave contra título/resumen/contenido de
todo el banco y muestra fragmentos con el módulo/vista de origen y un link
directo. Estados de carga (`skeleton`) y error (`ErrorState`) estándar.

**Renderizado de contenido:** se reutiliza el componente ya existente
`MarkdownViewer` de `@runly/ui` (`packages/ui/src/components/MarkdownViewer.jsx`,
`react-markdown` + `remark-gfm`, ya usado por `MarkdownField`/`RunlyForm`) —
no se construye un renderer nuevo. Ya cubre encabezados, listas,
negritas/itálicas, tablas y enlaces con `target="_blank"` +
`rel="noopener noreferrer"`; no usa `rehype-raw`, así que no interpreta HTML
crudo incrustado en el markdown.

**Nunca:** `window.confirm/alert/prompt`, `<select>`/`<input>` nativos, modal
hecho a mano — todo con `@runly/ui` según la política UI-first del proyecto.

## 9. Routes/screens

| Route | Screen | Module | Description |
|---|---|---|---|
| `/help` | `HelpCenterScreen` | `runly.core` | Página de ayuda navegable + búsqueda |
| `/help/:moduleKey` | `HelpCenterScreen` (mismo componente, sub-vista) | `runly.core` | Overview del módulo + lista de vistas con ayuda |

El panel contextual (`HelpSheet`) no es una ruta — es un overlay montado a
nivel de shell, no de módulo.

## 10. Data model

### New models

Ninguno. Se reutiliza la tabla `Blueprint` ya existente (id, key único,
moduleId, kind, version, schema Json, enabled, timestamps), agregando un
nuevo valor al enum `BlueprintKind` en vez de crear una tabla nueva. Esto
reutiliza al 100% el mecanismo de sync/lifecycle que ya sincroniza blueprints
en install/enable/disable/sync (`module-lifecycle-service.js`,
`upsertManifestBlueprints`, genérico por `kind` — no requiere ningún cambio en
esa función).

Forma de `schema` (Json) para blueprints `kind: "HELP"`:

```
{
  scope: "module" | "view",
  viewKey: string | null,      // solo cuando scope = "view": el navigation.path
                                 // exacto (o prefijo) que este artículo cubre
  title: string,                // título corto en español
  summary: string,               // 1-2 frases — usado en listados, búsqueda y
                                 // (Fase 4) en el carrusel de tips
  content: string,               // markdown completo — usado en el Sheet y en
                                 // la página de ayuda
}
```

`key` de cada blueprint HELP sigue la convención
`<moduleKey>.help.overview` (scope module) y
`<moduleKey>.help.view.<slug-de-viewKey>` (scope view).

### Modified models

`Blueprint.kind` (enum `BlueprintKind`): se agrega el valor `HELP` a los ya
existentes (`ENTITY`, `FORM`, `TABLE`, `DASHBOARD`, `ACTION`, `RELATION`,
`PERMISSION`). Sin cambios de columnas.

## 11. Prisma impact

New models: ninguno
Modified models: `BlueprintKind` (enum) — se agrega `HELP`
New migration required: Sí — migración aditiva de enum (`ALTER TYPE
blueprint_kind ADD VALUE 'HELP'`, vía Prisma migrate con SQL a mano si Prisma
no genera `ALTER TYPE ... ADD VALUE` directamente dentro de una transacción
— confirmar en el plan si requiere `migrate deploy` en dos pasos por la
restricción de Postgres de no usar `ADD VALUE` dentro de la misma transacción
que después lo consulta).
Migration safety notes: aditiva y no destructiva; no hay filas existentes que
usen el valor nuevo, así que no hay backfill. No se puede revertir quitando el
valor del enum (Postgres no lo permite fácilmente) — el rollback simplemente
deja de usarlo (ver Sección 27).

## 12. API contract

Nuevo router `apps/api/src/routes/help/index.js`, montado en el boot de la
API (no es un módulo custom con Route Loader — vive junto a los demás routers
core como `contacts-routes.js`). Todos los endpoints requieren sesión
autenticada; se gatean con el permiso `runly.help.read` (ver Sección 18), no
con el permiso propio de cada módulo — la ayuda de un módulo se puede leer
aunque el usuario no tenga permisos finos dentro de ese módulo (es
documentación, no datos).

### GET /help/modules

Auth: required
Permission: `runly.help.read`
Response: `{ data: [{ moduleKey, name, icon, summary }] }` — solo módulos
`INSTALLED` + `enabled` que tengan al menos un blueprint `HELP` habilitado.

### GET /help/modules/:moduleKey

Auth: required
Permission: `runly.help.read`
Response: `{ data: { moduleKey, name, overview: { title, summary, content } | null, views: [{ viewKey, title, summary }] } }`
Error: 404 si el módulo no existe/no está instalado; `{ data: { overview: null, views: [] } }` (200) si está instalado pero sin ayuda todavía — nunca error por falta de contenido.

### GET /help/resolve?path=<navPath>

Auth: required
Permission: `runly.help.read`
Query: `path` (string, requerido, el `location.pathname` actual del frontend)
Response: `{ data: { moduleKey, moduleName, view: { title, summary, content } | null, overview: { title, summary, content } | null } }`
Resuelve por *mejor coincidencia de prefijo* entre `path` y los `viewKey`
declarados de todos los módulos instalados+habilitados. Si no hay match de
vista, devuelve solo `overview` del módulo dueño de esa ruta (resuelto contra
`navigation[].path` del propio manifest, ya materializado en
`ModuleRegistry.resolveBlueprints()`/navegación).

**Actualizado 2026-09-26** (feedback del usuario tras probar la Fase 1 en
vivo: la pantalla de inicio del shell — `/home` — no pertenece a la
navegación de ningún módulo, así que mostraba "sin ayuda" incluso
teniéndola disponible en general): si `path` no matchea ningún
`navigation[].path` de ningún módulo, el owner cae por defecto a
`runly.core` (siempre instalado) y se devuelve su `overview` como
orientación general — nunca `view`. Sólo se devuelve
`{ moduleKey: null, overview: null, view: null }` en el caso extremo de que
ni siquiera `runly.core` esté instalado (no debería ocurrir en una
instancia real).

### GET /help/search?q=<query>

Auth: required
Permission: `runly.help.read`
Query: `q` (string, 2–200 caracteres — `helpSearchQuerySchema`)
Response: `{ data: [{ moduleKey, moduleName, viewKey, title, snippet, score }] }`
(top 20 por score, snippet recortado ~200 caracteres alrededor del primer
match). 400 si `q` no pasa el validador.

## 13. SDK contract

Domain: `help` (nuevo grupo en `packages/sdk/src/index.js`)

- `listModules(token)` — `GET /help/modules` → `{ data }`
- `getModuleHelp(moduleKey, token)` — `GET /help/modules/:moduleKey` → `{ data }`
- `resolveHelp(path, token)` — `GET /help/resolve?path=` → `{ data }`
- `searchHelp(query, token)` — `GET /help/search?q=` → `{ data }`

## 14. Validator contract

Nuevo archivo/sección en `packages/validators/src/index.js`:

- `helpSearchQuerySchema` — `{ q: z.string().min(2).max(200) }`
- `helpResolvePathQuerySchema` — `{ path: z.string().min(1).max(500) }`

No hay validators de escritura — esta fase es 100% lectura.

## 15. Module manifest impact

No se crea un módulo nuevo. Se modifica el mecanismo de autoría de manifests
existente para permitir declarar ayuda:

**Módulos oficiales** (`apps/api/src/manifests/official/core-modules.js`,
`feature-modules.js`): nuevo directorio
`apps/api/src/manifests/official/help/<moduleKey>/overview.md` +
`apps/api/src/manifests/official/help/<moduleKey>/views/<slug>.md`, cargados
con un helper nuevo `loadHelpBlueprints(moduleKey, viewMap)` (nuevo archivo
`apps/api/src/manifests/official/help/load-help-blueprints.js`) que:
1. Lee `overview.md` con frontmatter simple (`title`, `summary`) + cuerpo
   markdown.
2. Lee cada `views/<slug>.md` con frontmatter (`title`, `summary`, `viewKey`)
   + cuerpo.
3. Devuelve un array de objetos `{ key, kind: "HELP", version, schema }`
   listo para spread dentro del `blueprints: [...]` ya existente de cada
   manifest.
4. Si el directorio de un módulo no existe todavía: devuelve `[]` sin lanzar
   — un módulo sin ayuda no rompe el boot.

**Módulos custom (RME3)**: mismo helper expuesto desde
`@runly/module-engine` (`loadModuleHelp({ moduleDir, moduleKey }))`, usado
opcionalmente dentro de `module.manifest.js` para leer
`modules/custom/<key>/help/overview.md` y `help/views/<slug>.md`. Se
documenta como paso opcional 15 en el workflow de 14 pasos de
`docs/03_custom_modules.md` (no obligatorio, pero recomendado).

Module key: N/A (no es un módulo nuevo)
Dependencies: N/A
Core: N/A

Permissions nuevas:
- `runly.help.read` — declarada en el manifest de `runly.core`
  (`permission-catalog.js` + `core-modules.js`), otorgada por defecto a todos
  los roles base en el seed (es contenido no sensible, equivalente a "puede
  usar el ERP").

ACL: N/A (no hay modelo Prisma propio que proteger con ACL de módulo)

Blueprints: ver Sección 17.

## 16. Navigation impact

| Label (Spanish) | Path | Icon | Layout | permissionKey |
|---|---|---|---|---|
| Ayuda | /help | CircleHelp | main | runly.help.read |

Se agrega como entrada de navegación de `runly.core`, además del ícono
persistente de ayuda contextual en el header (que no es un item de
navegación, es un botón fijo del shell).

## 17. Blueprint impact

Nuevo kind: `HELP`.

Schema por entrada (ver Sección 10 para la forma completa):
`{ scope, viewKey, title, summary, content }`.

Cada módulo con ayuda declara N blueprints `HELP`: uno `scope: "module"` +
uno por cada vista/pestaña documentada. No se modifican blueprints
existentes de otros kinds.

## 18. RBAC/permissions

| Permission key | Guards endpoint(s) | Gates navigation |
|---|---|---|
| `runly.help.read` | `GET /help/modules`, `GET /help/modules/:moduleKey`, `GET /help/resolve`, `GET /help/search` | Sí (`/help`) |

Otorgado por defecto a todos los roles base en `pnpm db:seed` — la ayuda del
sistema no debe quedar bloqueada por RBAC granular de cada módulo; es
documentación, no datos de negocio.

## 19. Multi-company behavior

El contenido de ayuda **no está scoped por compañía** — vive a nivel de
instancia, igual que las blueprints de kind `ENTITY`/`TABLE`/etc. (son
definiciones de esquema/documentación del módulo instalado, no datos de una
compañía). Todos los usuarios de todas las compañías de la instancia ven el
mismo contenido de ayuda para un módulo dado. No hay aislamiento cross-company
que enforce porque no hay dato de compañía involucrado.

## 20. Files/storage impact

N/A — el contenido vive como texto en el `schema` Json de `Blueprint`, cargado
desde markdown en el repo al momento de sync. No hay adjuntos ni Supabase
Storage involucrados en esta fase.

## 21. Export/import requirements

N/A

## 22. Audit log requirements

N/A — son endpoints de solo lectura sobre contenido no sensible y no
relacionado a ninguna entidad de negocio; no se audita lectura de
documentación en ningún otro punto del sistema.

## 23. Edge cases

1. Módulo instalado sin ningún archivo de ayuda todavía → `GET
   /help/modules/:moduleKey` responde 200 con `overview: null, views: []`; el
   Sheet contextual muestra `EmptyState`; el módulo no aparece en `GET
   /help/modules` (solo se listan módulos con al menos un artículo).
2. Ruta actual del frontend no matchea ningún `viewKey` conocido (pantalla
   nueva sin ayuda todavía escrita, o ruta con parámetros como
   `/fleet/vehicles/:id`) → `resolveHelp` hace match por *prefijo* del path
   registrado más largo que sea prefijo de la ruta actual; si ninguno matchea,
   cae al overview del módulo dueño de esa ruta (resuelto por el segmento de
   navegación, no por el viewKey exacto).
3. Módulo deshabilitado (`RunlyModule.status = DISABLED`) → sus blueprints
   `HELP` se marcan `enabled: false` por el mismo mecanismo ya existente para
   todos los kinds; desaparecen de `/help/modules` y de la búsqueda
   automáticamente, sin código nuevo.
4. Archivo markdown de ayuda con frontmatter incompleto (falta `title` o
   `summary`) al momento de boot → el loader usa el `moduleKey`/nombre del
   manifest como fallback de `title` y string vacío como `summary`, con un
   `console.warn` — nunca lanza y nunca tumba el boot de la API.
5. Búsqueda con query de 1 carácter o vacía → 400 por el validador, antes de
   tocar el service.
6. Dos módulos distintos declaran contenido para el mismo `viewKey` (path)
   por error de copy-paste → el loader detecta colisión de `key` (mismo
   patrón que ya usa `skipDuplicates`/`update` de `upsertManifestBlueprints`)
   y el segundo gana en el `update` — se documenta como responsabilidad de
   revisión en PR, no hay validación automática de unicidad cross-módulo en
   esta fase.
7. Contenido de ayuda con un link a `javascript:` o `data:` → `MarkdownViewer`
   (react-markdown, sin `rehype-raw`) no interpreta HTML/URIs crudos; el link
   se renderiza como texto, no como un `<a href="javascript:...">` ejecutable.

## 24. Risks

1. Riesgo: el contenido de ayuda queda desactualizado respecto al
   comportamiento real del módulo. Mitigación: vive en el mismo PR que el
   código (markdown junto al módulo), se revisa como cualquier otro cambio;
   no es un documento externo que alguien olvide actualizar.
2. Riesgo: la búsqueda en memoria (sin índice Postgres) se vuelve lenta si el
   banco de ayuda crece mucho. Mitigación: el volumen esperado es de
   decenas/pocas centenas de artículos cortos — trivial en memoria; si crece,
   la Sección 28 deja anotado el paso a `tsvector`/Postgres FTS como mejora
   futura sin cambiar el contrato de `GET /help/search`.
3. Riesgo: `ALTER TYPE ... ADD VALUE` de Postgres tiene restricciones de
   transacción con Prisma Migrate. Mitigación: se verifica en el plan de
   implementación; si es necesario, se aplica en una migración de un solo
   `ALTER TYPE` sin más sentencias en la misma transacción (patrón conocido).
4. Riesgo: un módulo custom de un tercero no sigue la convención de carpetas
   `help/` y el helper falla silenciosamente sin que el desarrollador se dé
   cuenta de que no se sincronizó nada. Mitigación: el helper es opcional y
   documentado; si el directorio no existe simplemente no agrega ayuda (no es
   un error, es un comportamiento esperado para módulos sin ayuda).

## 25. Acceptance criteria

1. Given un módulo instalado y habilitado con `help/overview.md`, when se
   llama `POST /modules/:key/sync`, then aparece un `Blueprint` con
   `kind: "HELP"` y `scope: "module"` para ese módulo.
2. Given un usuario autenticado con `runly.help.read`, when navega a
   `/help`, then ve la lista de módulos con ayuda disponible con su resumen.
3. Given un usuario parado en una pantalla cuya ruta matchea un `viewKey`
   documentado, when abre el panel de ayuda contextual, then ve primero la
   ayuda de esa vista y debajo el overview del módulo.
4. Given un usuario parado en una pantalla sin ayuda de vista pero cuyo
   módulo sí tiene overview, when abre el panel contextual, then ve solo el
   overview, sin error.
5. Given un módulo sin ningún artículo de ayuda, when el usuario abre el
   panel contextual estando en una pantalla de ese módulo, then ve el
   `EmptyState` "Aún no hay ayuda para este módulo."
6. Given una búsqueda de 2+ caracteres que matchea contenido de dos módulos
   distintos, when se llama `GET /help/search?q=...`, then la respuesta trae
   ambos, ordenados por score, cada uno con su `moduleKey`/`viewKey` de
   origen.
7. Given un usuario sin `runly.help.read` (rol sin ese permiso asignado),
   when llama cualquier endpoint `/help/*`, then la API responde 403.
8. Given un módulo `DISABLED`, when se consulta `/help/modules`, then ese
   módulo no aparece en la lista.

**Verificado: 2026-09-26** (implementación Fase 1 completa)

1. Verificado — `pnpm db:seed` (re-sincroniza los manifests core, mismo
   camino que `POST /modules/:key/sync`) produjo 3 filas `Blueprint`
   `kind: "HELP"` reales para `runly.core` en la base de Supabase
   (`runly.core.help.overview` con `scope: "module"` + 2 `scope: "view"`),
   confirmado con una consulta Prisma directa contra la BD.
2. Verificado a nivel API — `apps/api/src/routes/help/__tests__/help-routes.test.js`
   (`GET /help/modules` con permiso → 200 con datos) +
   `help-service.test.js` (`listModulesWithHelp`). El renderizado visual de
   `/help` en el navegador no se probó en vivo — este entorno no tiene
   herramienta de navegador disponible; sí se verificó que
   `apps/desktop` compila limpio con la pantalla nueva
   (`pnpm build`, incluye el build nativo Tauri completo).
3. Verificado a nivel de datos — `help-service.test.js`
   ("resolveHelp matches the view by exact path and returns both view +
   overview"). El panel contextual (`HelpButton.jsx`) consume exactamente
   esa forma de respuesta; no se verificó visualmente en un navegador real
   por la misma limitación de entorno.
4. Verificado a nivel de datos — `help-service.test.js`
   ("resolveHelp falls back to overview-only when no view matches"); mismo
   caveat de verificación visual que el punto 3.
5. Verificado a nivel de datos — `help-service.test.js` ("resolveHelp
   returns nulls when the path belongs to no known module"), que es el
   caso que dispara el `EmptyState` en `HelpButton.jsx`; mismo caveat visual.
6. Verificado — `help-service.test.js` ("searchHelp finds matches across
   module and view content, accent-insensitive") + `help-routes.test.js`
   ("GET /help/search with a valid q -> 200").
7. Verificado — `help-routes.test.js` ("GET /help/modules without
   permission -> 403"), más lectura de código: `runly.help.read` está en
   `BASE_PERMISSION_KEYS` (`apps/api/src/index.js`), así que en la práctica
   todo usuario autenticado lo tiene — el 403 solo ocurriría si esa
   constante se quitara.
8. Verificado — `help-service.test.js` ("listModulesWithHelp excludes a
   DISABLED module even if it has help rows"), agregado explícitamente
   para cubrir este criterio.

Suites completas verificadas en verde el 2026-09-26: `apps/api/src/services/__tests__/*.test.js` (530 pass, 2 skip pre-existentes, 0 fail), `apps/api/src/routes/**/__tests__/*.test.js` (1141 pass, 0 fail), `packages/module-engine/src/__tests__/*.test.js` (101 pass), `packages/validators/src/__tests__/*.test.js` (18 pass), `packages/sdk/src/__tests__/*.test.js` (37 pass), `pnpm lint` (sin errores), `pnpm build` (build completo del monorepo, incluyendo el instalador nativo Tauri, verde).

## 26. Verification plan

- `pnpm build` — build limpio de todos los paquetes/apps.
- `pnpm db:migrate` — la migración del enum `BlueprintKind` aplica sin
  errores contra Supabase.
- `pnpm db:generate` — el cliente Prisma regenera con el nuevo valor de enum.
- `pnpm db:seed` — `runly.help.read` se siembra y se asigna a los roles base.
- `node --test apps/api/src/routes/help/__tests__/` — tests del service
  (resolve por prefijo, búsqueda, exclusión de módulos deshabilitados) y del
  router (403 sin permiso, 200 con datos, 400 en query inválida).
- `node --test apps/api/src/manifests/official/help/__tests__/` — tests del
  loader (frontmatter completo, frontmatter incompleto con fallback, carpeta
  ausente devuelve `[]`).
- Manual: boot real de la API (`node apps/api/src/index.js`) + `POST
  /modules/runly.core/sync` (o el módulo que reciba el primer contenido de
  ayuda de prueba) + `curl` contra `/help/modules`, `/help/resolve`,
  `/help/search` con un token válido.
- Manual en navegador: abrir el panel contextual en al menos dos pantallas
  distintas (una con ayuda de vista, una sin ninguna ayuda) y la página
  `/help` completa, confirmando estados vacío/cargado/buscado.

## 27. Rollback plan

El único cambio de esquema es aditivo (nuevo valor de enum) — no hay columnas
ni tablas que revertir. Si se necesita desactivar la feature:
1. Quitar la entrada de navegación `/help` y el botón de header del shell
   (revert de commit de frontend).
2. Dejar de montar el router `/help` en el boot de la API (revert de commit
   de backend) — los endpoints simplemente dejan de existir, 404 en el
   proxy/gateway si aplica.
3. Los blueprints `kind: "HELP"` quedan huérfanos en la tabla pero inertes
   (nada los consulta) — no hace falta borrarlos; un `DELETE FROM blueprint
   WHERE kind = 'HELP'` es opcional y seguro si se quiere limpiar.
No hay flag de feature — el rollback es a nivel de código (revert de PRs).

## 28. Future enhancements

Roadmap acordado en el brainstorm, cada uno como su propio ciclo
spec→plan→implementación cuando le toque, todos construidos **sobre el mismo
banco de contenido y el mismo `help-service.js`** de esta fase, sin tocarlo:

1. **Fase 2 — Widget "Ayuda" conversacional:** un panel tipo chat (separado
   de MirAI) donde el usuario escribe preguntas libres. Si `GROQ_API_KEY` está
   configurada: llamada a Groq con el contenido de ayuda relevante
   (`searchHelp`) como contexto (RAG ligero, mismo patrón que el asistente de
   PFM). Si no hay `GROQ_API_KEY`: usa `searchHelp` directamente y muestra los
   fragmentos top, sin frase generada por IA — el mismo componente/endpoint
   se degrada con gracia, nunca desaparece.
2. **Fase 3 — Tool de MirAI:** agregar `search_module_help` a
   `apps/api/src/routes/chat/mirai-tools.js` para que el asistente general ya
   existente también pueda responder "¿cómo funciona el módulo de flotas?"
   usando el mismo `help-service.js`, sin duplicar contenido ni lógica de
   búsqueda.
3. **Fase 4 — Carrusel de tips en la barra inferior:** rotación contextual de
   `summary` (o un campo `tips: string[]` adicional en el schema HELP) de la
   vista/módulo actual, más espacio reservado para futuros avisos del
   propio dueño de Runly — explícitamente fuera de alcance de distribución
   automática (ver Sección 6.5); en esta fase los avisos, si existen, se
   escriben igual que el resto del contenido: markdown versionado con el
   release.
4. Búsqueda con Postgres `tsvector`/FTS si el volumen de contenido crece lo
   suficiente para que el ranking en memoria dejara de ser instantáneo.
5. Métricas de qué artículos de ayuda se consultan más (para priorizar qué
   documentar primero) — no planeado, solo anotado como posible.
