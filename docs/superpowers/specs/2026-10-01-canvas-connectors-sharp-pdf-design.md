# Runly Canvas — herramientas de plano (4b): conectores y PDF nítido

## 1. Feature title

Canvas Fase 4b — flechas y líneas conectadas a formas; páginas PDF nítidas al acercar.

## 2. Status

Complete — Verified: 2026-10-01 (node --test API 51/51 y desktop 65/65, eslint de archivos tocados, build:web). Smoke manual pendiente.

## 3. Context

Segunda mitad de la fase de herramientas de plano. Diagramas necesitan
flechas que sigan a las formas al moverlas. Las páginas PDF se insertan como
PNG rasterizados a DPI fijo (`lib/media.js`, `renderPdfPage`) guardando
`properties.sourceFileId` y `properties.page`; al acercar se ven borrosas.

## 4. Problem

1. Al mover una forma, las flechas que la unen quedan desconectadas.
2. Los planos en PDF pierden nitidez al hacer zoom.

## 5. Goals

1. Una línea o flecha cuyo extremo se suelta sobre una forma queda conectada
   a ella; al mover o redimensionar la forma, el extremo la sigue y toca su
   borde.
2. Arrastrar un extremo conectado fuera de la forma lo desconecta; soltarlo
   sobre otra lo reconecta.
3. Las páginas PDF se vuelven a renderizar desde el PDF original con más
   resolución cuando el zoom lo requiere (en el editor).

## 6. Non-goals

1. Conectores en codo u ortogonales y puntos de anclaje específicos.
2. Etiquetas sobre conectores.
3. PDF nítido en enlaces públicos, miniaturas y exportación (usan la
   imagen guardada).
4. PDF como fondo de página (`CanvasPage.background`); sigue siendo un objeto
   imagen en la capa de fondo de la plantilla.

## 7. User stories

1. Como editor de un diagrama, quiero que las flechas sigan a los pasos al
   reordenarlos.
2. Como usuario de un plano en PDF, quiero leer las cotas pequeñas al
   acercarme.

## 8. UX requirements

- Al dibujar una línea/flecha, la forma bajo el puntero se resalta con un
  contorno del color primario para indicar que se conectará.
- Extremo conectado: el asa del extremo se dibuja rellena del color primario.
- Al acercar sobre una página PDF, la nitidez mejora en ≤ 1 s sin parpadeo
  (se mantiene la imagen anterior hasta que la nueva está lista).
- Sin texto nuevo en la interfaz salvo la ayuda.

## 9. Routes/screens

`/app/m/runly.canvas/:boardId` — `CanvasViewport`, `Canvas2DRenderer`,
`BoardEditor`. `PublicBoardScreen` también resuelve conectores (es el mismo
`CanvasViewport`).

## 10. Data model

Sin tablas nuevas. Línea/flecha: `properties.connect = { start: objectId | null, end: objectId | null }`.
La geometría guardada (`transform` + `geometry.x2/y2`) se mantiene como
última posición conocida (respaldo si la forma conectada desaparece).

## 11. Prisma impact

N/A.

## 12. API contract

`validateCanvasObject`: si `properties.connect` existe debe ser un objeto con
`start`/`end` `null` o UUID; si no, 400.

## 13. SDK contract

N/A.

## 14. Validator contract

N/A.

## 15. Module manifest impact

N/A.

## 16. Navigation impact

N/A.

## 17. Blueprint impact

N/A.

## 18. RBAC/permissions

Sin cambios.

## 19. Multi-company behavior

Sin cambios.

## 20. Files/storage impact

El PDF original (`sourceFileId`) se descarga con URL firmada (`batchSignedUrls`)
y `fetch` CORS, sólo en el editor; se cachea en memoria por sesión.

## 21. Export/import requirements

Miniaturas y exportación resuelven conectores (usan la misma función pura).

## 22. Audit log requirements

N/A.

## 23. Edge cases

1. Forma conectada eliminada u oculta: el extremo usa la geometría guardada.
2. Conector cuyo inicio y fin apuntan a la misma forma: se ignora la conexión
   del fin.
3. Elipses: el extremo toca el borde de la elipse, no de su caja.
4. Formas rotadas: se usa el borde de su caja rotada.
5. PDF sin CORS o error de carga: se queda la imagen rasterizada original.
6. Zoom muy alto: el render se limita a 4096 px por lado.

## 24. Risks

1. Coste de resolver conectores en cada frame → O(n) con un `Map` por id;
   sólo líneas con `connect` hacen trabajo.
2. Memoria por renders de PDF → caché LRU de 12 renders y escalones de
   resolución (2×, 4×, 8× del DPI base).

## 25. Acceptance criteria

1. Dadas dos formas conectadas por una flecha, cuando se mueve una, entonces
   la flecha termina en su nuevo borde durante el arrastre y después.
2. Dado un extremo arrastrado al vacío, cuando se suelta, entonces
   `connect.end` es `null`.
3. Dada una elipse conectada, cuando se resuelve, entonces el punto está a
   distancia ≤ 0,5 px de su borde.
4. Dada una página PDF a zoom 4×, cuando pasa 1 s, entonces se dibuja una
   versión de mayor resolución.
5. Dado `connect.start: 'x'`, cuando se valida, entonces 400.

## 26. Verification plan

- `node --test apps/api/src/routes/canvas/__tests__/*.test.js`
- `node --test apps/desktop/src/modules/runly.canvas/engine/*.test.js apps/desktop/src/modules/runly.canvas/lib/*.test.js`
- `npx eslint` de archivos tocados; `pnpm --filter ./apps/desktop build:web`.
- Smoke manual: diagrama con flechas conectadas; PDF de plano con zoom.

## 27. Rollback plan

Sin migraciones; revertir commits (`connect` queda como JSON inerte y las
líneas usan su geometría guardada).

## 28. Future enhancements

1. Conectores ortogonales y anclajes por lado.
2. Fondo de página PDF vectorial con teselas.
3. Actualizar la geometría guardada del conector al mover la forma.
