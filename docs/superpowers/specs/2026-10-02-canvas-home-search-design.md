# Runly Canvas — inicio con filtros, búsqueda inteligente y portadas automáticas

## 1. Feature title

Página principal de Canvas: filtros, búsqueda dentro del contenido y portadas automáticas.

## 2. Status

Complete — Verified: 2026-10-02 (node --test API 66/66 y desktop 97/97, SQL de búsqueda ejecutado en la base de desarrollo en modo lectura, eslint, build:web). Smoke manual pendiente.

## 3. Context

`CanvasHome` sólo filtra por nombre/descripción en el cliente. Las miniaturas
(fase 1) sólo se generan tras guardados propios, así que los Boards que nadie
ha editado desde entonces no tienen portada. La base ya tiene `pg_trgm` y
`atlas_unaccent()` (migración de búsqueda del chat).

## 4. Problem

1. No hay filtros (plantilla, acceso, fecha, orden).
2. La búsqueda no encuentra un Board por lo que contiene (hotspots, textos,
   páginas, registros vinculados) ni tolera acentos o errores de dedo.
3. Muchos Boards no tienen portada.

## 5. Goals

1. Barra de filtros: **Plantilla** (selección múltiple), **Acceso** (Todos,
   Míos, Compartidos conmigo), **Actualizado** (Cualquier fecha, Hoy, Últimos
   7 días, Últimos 30 días) y **Orden** (Recientes, Nombre A-Z, Más antiguos).
   Persisten por usuario en `localStorage` (con try/catch).
2. **Búsqueda inteligente** en servidor: ignora mayúsculas y acentos; varias
   palabras deben aparecer todas (en cualquier campo del Board); tolera
   errores de dedo en nombres y títulos (trigramas); busca en nombre,
   descripción, nombres de páginas, títulos/descripciones/etiquetas de
   hotspots, textos del lienzo y títulos de registros vinculados. Cada
   resultado dice **dónde** coincidió ("Hotspot: Extintor 2", "Texto:
   …bodega norte…").
3. **Portada automática**: al abrir un Board sin portada (o con portada de
   más de 7 días y cambios posteriores) que el usuario puede editar, se genera
   unos segundos después de cargar; además se mantiene la regeneración tras
   ediciones.

## 6. Non-goals

1. Subir una portada manual.
2. Búsqueda dentro de PDFs/imágenes.
3. Índices nuevos (volumen actual bajo; posible mejora futura).

## 7. User stories

1. Como usuario con muchos Boards, quiero ver sólo los planos que me
   compartieron esta semana.
2. Como usuario, quiero escribir "extintor bodega" y encontrar el Board que
   tiene un hotspot "Extintor" en la página "Bodega".
3. Como usuario, quiero reconocer cada Board por su portada.

## 8. UX requirements

- Cabecera: buscador (placeholder "Buscar en nombres, hotspots, textos y
  registros…") + fila de filtros con `DropdownMenu` de casillas (Plantilla) y
  `SelectField` (Acceso, Actualizado, Orden); botón "Limpiar filtros" cuando
  hay alguno activo; contador "N Boards".
- En móvil los filtros van en un `Sheet` "Filtros" abierto con un botón con
  contador de filtros activos.
- Con texto de búsqueda: resultados del servidor (debounce 250 ms,
  `Skeleton` mientras carga) con los filtros aplicados; cada tarjeta muestra
  bajo el nombre una línea "Coincide en: …" (máx. 2 coincidencias).
- Sin resultados: `EmptyState` con "Limpiar búsqueda" / "Limpiar filtros".
- Textos en español, sin emojis.

## 9. Routes/screens

`/app/m/runly.canvas` — `CanvasHome`, `BoardCard`, nuevo `BoardFilters`.

## 10. Data model

Sin cambios.

## 11. Prisma impact

N/A (sin migración; usa `atlas_unaccent` y `pg_trgm` existentes).

## 12. API contract

`GET /canvas/search?q=` — `canvas.view`. `q` 2..120 caracteres (400 si no).
Respuesta `{ data: [{ boardId, score, matches: [{ field, label, snippet }] }] }`
sólo con Boards accesibles (owner/colaborador, empresa activa, no
archivados), máx. 50, ordenados por `score`. `field` ∈ `name | description |
page | hotspot | text | link`. Puntuación: nombre 10, descripción 5, hotspot
4, página 3, texto 2, vínculo 2; coincidencia difusa (similitud ≥ 0.45, sólo
nombre y hotspot) vale la mitad.

## 13. SDK contract

`runly.canvas.search(q, token)`.

## 14–19

N/A.

## 20. Files/storage impact

Portadas: mismo flujo que las miniaturas (Files, `runly.canvas/CanvasBoard`).

## 21–22

N/A.

## 23. Edge cases

1. Comillas o `%`/`_` en la búsqueda: se escapan para `ILIKE`.
2. Una palabra de 1 carácter se ignora salvo que sea la única.
3. Hotspots archivados y objetos eliminados no cuentan.
4. Un Board sin objetos no genera portada.
5. Lectores no generan portada.

## 24. Risks

1. Coste de búsqueda sin índices → acotada a Boards accesibles de la empresa
   y máx. 50; índices trigram como mejora futura.

## 25. Acceptance criteria

1. Dado "extintor bodega", cuando un Board tiene un hotspot "Extintor" y una
   página "Bodega", entonces aparece con ambas coincidencias.
2. Dado "almacen", cuando un Board se llama "Almacén norte", entonces aparece.
3. Dado "extintr", cuando un hotspot se llama "Extintor", entonces aparece
   (difuso).
4. Dado el filtro Acceso = Compartidos conmigo, entonces sólo se ven Boards
   cuyo `myRole` no es OWNER.
5. Dado un Board editable sin portada con objetos, cuando se abre, entonces en
   ≤ 10 s se sube una portada.

## 26. Verification plan

`node --test apps/api/src/routes/canvas/__tests__/*.test.js`,
`node --test apps/desktop/src/modules/runly.canvas/engine/*.test.js apps/desktop/src/modules/runly.canvas/lib/*.test.js`,
`npx eslint` de archivos tocados, `pnpm --filter ./apps/desktop build:web`.

## 27. Rollback plan

Revertir commits.

## 28. Future enhancements

1. Índices trigram sobre títulos de hotspots y textos.
2. Portada manual desde una página o una imagen.
3. Búsqueda en el contenido de PDFs.
