# Runly Preview Runtime

Presentación RME3 compartida entre el shell ERP y hosts externos. JavaScript/React;
no importa `apps/desktop`, `apps/api`, autenticación, instalación ni persistencia.

`BlueprintRenderer` selecciona los originales `RunlyCrudView`, `RunlyDashboard`
y `RunlyKanban`; CRUD conserva `RunlyTable`, `RunlyForm` y `RunlyDetail`.
`resolver` y `presentation` contienen la selección/rutas y aliases Atlas extraídos
del shell. `navigationTarget` conserva rutas de create/detail/edit y modo sheet.
El ERP conserva disponibilidad, permisos, sesión, empresa, CUSTOM y extensiones.

`createErpAdapters` recibe getters de sesión/empresa, base URL y fetch opcional;
conserva cabeceras y rechaza otros orígenes. `createRuntimeSession` exige `id`,
`transport.fetch`, `preferences.{get,set,remove}` y `resources`. El transporte
devuelve Response compatible con fetch; no modifica fetch global. Las preferencias
se resuelven mediante su puerto. Cada sesión mantiene registry y ciclo de vida;
`dispose()` vacía registry, dispone adapters y rechaza peticiones posteriores.

`PreviewHost` recibe blueprints JSON, selección y callbacks de navegación,
dashboard/Kanban. Posee QueryClient por sesión, limpia su caché al desmontarse
y rechaza funciones pendientes antes de montar vistas. No carga bundles,
ZIPs ni CUSTOM; relaciones, archivos, auditoría, attachments y servicios requieren
extracciones posteriores. La presencia de un puerto de recursos no habilita Storage.

Importar `@runly/ui/theme.css` y `@runly/ui/runtime.css`, generar utilities desde
los sources de UI y deduplicar React/React DOM/TanStack Query. Usar `@runly/ui/preview`
para conservar la misma instancia del contexto dentro de prebundles. El host
externo decide scroll, anchos y tema; los estilos compartidos provienen del ERP.

`contracts` declara capacidades v1. La implementación se identifica mediante
revisión Git, versión snapshot y digests del paquete/contrato, además del número
de contrato. `externals` centraliza las mismas claves/shims para API y desktop;
`css` y `styles` mantienen helpers originales de scoping/carga de estilos.

Pruebas: `node --test packages/preview-runtime/src/runtime.test.js` desde el monorepo.
Los fixtures externos y la prueba de pantalla ERP con adapters ficticios viven
en Developer Hub. No equivalen a una prueba de permisos o DB de producción.
