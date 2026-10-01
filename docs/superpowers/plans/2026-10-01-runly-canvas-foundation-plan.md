# Runly Canvas — plan por fases

## Fase 1 — Contratos, datos y módulo oficial

Objetivo: registrar `runly.canvas`, crear modelos/migración, validadores,
servicio tenant-aware y API de Board/Page/Layer/Object batch/Hotspot/links.

Archivos: Prisma, manifest oficial, permission catalog, `routes/canvas`, mount
de API, SDK y tests del servicio/router.

Riesgos: relaciones polimórficas, restauración de snapshots y fugas por ID.

Tests: CRUD, tenant isolation, permisos, orden de capas, batch/revisiones,
hotspot links y rechazo cross-company.

Terminado: Prisma valida, rutas requieren RBAC + ACL, auditoría se escribe y
tests focalizados pasan.

## Fase 2 — Shell del editor y renderer Canvas2D

Objetivo: lista/creación de Boards y editor funcional básico con páginas,
capas, rectángulos/hotspots, selección, mover, borrar, zoom/pan y persistencia.

Archivos: `apps/desktop/src/modules/runly.canvas`, `ModuleOutlet`, dominio SDK.

Riesgos: mezclar estado React con el loop gráfico o emitir una mutation por
evento de puntero.

Tests: transformaciones, command queue y renderer; React Doctor y build web.

Terminado: se crea y abre un Board, se edita un objeto básico y el batch se
persiste sin renderizar objetos como DOM.

## Fase 3 — Realtime autorizado y autosave resiliente

Objetivo: integrar el topic privado por Board, presence de participantes,
cursor/selección efímeros e invalidaciones persistentes.

Archivos: migración de políticas, realtime access service, authorized client,
hook Canvas realtime y tests de autorización.

Riesgos: grants cacheados, storms de cursor y payloads demasiado grandes.

Tests: acceso owner/collaborator, revocación, rechazo tenant, throttling.

Terminado: un usuario sin ACL no puede subscribir/enviar; cursores no escriben
en tablas de dominio.

## Fase 4 — Archivos, comentarios y versiones operativas

Objetivo: asociación segura de FileAsset, comentarios Board/Hotspot, snapshots
explícitos y restore transaccional.

Archivos: servicio/rutas Canvas, componentes con `AttachmentsPanel`, historial.

Riesgos: archivos huérfanos, snapshots grandes y restore parcial.

Tests: signed URL tenant-aware, comentarios ACL, snapshot/restore y auditoría.

Terminado: ningún asset externo se puede asociar o resolver y restore es
atómico.

## Fase 5 — Escala del renderer e importadores

Objetivo: métricas reales, índice espacial, culling, adapters PDF/image/tiles y
pipeline asíncrono de derivados.

Riesgos: memoria del navegador, text rendering, límites móvil y PDFs enormes.

Terminado: benchmarks acordados con miles de objetos y fondos grandes guían si
Canvas2D se conserva o se añade PixiJS/WebGL.

