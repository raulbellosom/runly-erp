# runly.ledger — Densidad de pantallas, gráficas del Resumen, listado en "Compartir" y reporte PDF

Date: 2026-09-25
Status: Draft
Author: Claude Sonnet 5 (spec agent)
Spec file: docs/superpowers/specs/2026-09-25-ledger-density-charts-pdf-polish-design.md
Plan file: docs/superpowers/plans/2026-09-25-ledger-density-charts-pdf-polish.md (se crea tras aprobar esta spec)

---

## 1. Feature title

runly.ledger — Ajustes de densidad y layout en el asistente de importación y el registro de movimientos, corrección de las gráficas del tab Resumen (recorte de la dona + hover feo en dark mode) más dos gráficas nuevas, precarga de usuarios en el modal "Compartir", y rediseño del reporte PDF (texto amontonado, número de cuenta, watermark con el logo de Runly).

## 2. Status

Draft — pendiente de revisión humana antes de generar el plan de implementación (Stage 3 de `docs/spec-driven-development.md`).

## 3. Context

El 2026-09-23 se aprobó e implementó `docs/superpowers/specs/2026-09-23-ledger-ui-redesign-design.md`, que le dio a `runly.ledger` un lavado de cara visual (tarjetas de vidrio, tokens de marca, `@runly/ui`). Esa spec excluyó explícitamente (sección "Non-goals" #5) el asistente de importación IA (`AiImportScreen.jsx`) y no tocó los reportes de exportación ni las gráficas del tab Resumen.

El usuario revisó capturas reales de seis pantallas del módulo (paso 2 del import IA, tab Registro, tab Resumen con sus tres gráficas, el modal "Buscar usuario" del tab Acceso, y el PDF exportado) e identificó seis problemas de espacio/legibilidad/funcionalidad. Cada uno fue verificado contra el código fuente antes de escribir esta spec (no es solo percepción visual, hay causas concretas):

1. `AiImportScreen.jsx` fija la tabla de revisión a `max-h-112` (448px, línea 278) mientras el `StepIndicator` horizontal (líneas 21-61) ocupa una franja completa arriba — sobra espacio muerto y la tabla, que es lo importante, queda comprimida. `ImportWizard.jsx` (el importador manual CSV/XLSX) tiene el **mismo patrón duplicado**: su propio `STEPS`/step-pills (línea 201) y sus propios `max-h-40`/`max-h-64` (líneas 324, 336).
2. La tabla de movimientos (`SpreadsheetRegister.jsx`) ya usa `flex-1 overflow-auto` (línea 248) — el espacio que le falta no es un límite propio, es el "chrome" de `AccountScreen.jsx` encima (header de cuenta + fila de botones de export/import, líneas 332-404) que arranca siempre expandido (`headerCollapsed` inicia en `false`, línea 89) aunque ya existe un botón para colapsarlo.
3. En `AccountSummary.jsx`, la dona de "Distribución" fija `cy="46%"` y `outerRadius={88}` en píxeles dentro de un `ResponsiveContainer height={210}` que también contiene el `<Legend>` (líneas 249-286) — el radio no se recalcula cuando el legend reserva espacio abajo, así que el borde inferior del círculo choca contra esa franja. Además ningún `<Tooltip>` (línea 231 y 327) define `cursor`, así que Recharts usa su cursor gris/blanco por defecto, que no respeta el tema oscuro.
4. El sistema de roles editor/viewer **ya existe** (`UserSearchModal.jsx` líneas 122-130, badges en `AccountScreen.jsx` líneas 595-597) — lo que falta es que el modal liste usuarios de la empresa por default: `UserSearchModal.jsx` solo busca a partir de 2 caracteres (línea 30) y el endpoint `GET /users/search` (`apps/api/src/routes/users-routes.js`) valida `q` como obligatorio (`userSearchQuerySchema`, min 2 chars) — por eso el modal se ve vacío hasta que el usuario escribe.
5. El PDF (`export-service.js`) dibuja cada celda con `lineBreak: false` y avanza `y += 12` fijo por fila (líneas 184-202) — cuando "Concepto" o "Nombre" es más largo que su columna, el texto se desborda sobre la fila siguiente en vez de truncarse o hacer wrap. El subtítulo del header solo arma `${account.name} — ${currency}` (línea 174), sin `account.account_number`. El watermark actual (`drawPdfFooter`, `pdf-branding-service.js` líneas 398-407) es solo el texto "Hecho con Runly ERP", no el isotipo de Runly.
6. En `AccountScreen.jsx`, los filtros de fecha (`Desde`/`Hasta`, líneas 423-455) viven en la misma fila que los tabs Registro/Resumen/Acceso, lejos del buscador que vive dentro de `SpreadsheetRegister.jsx` (líneas 197-201) — son dos filas separadas cuando deberían convivir.

## 4. Problem

El módulo `runly.ledger` le da menos espacio vertical del necesario a los tres elementos que más importan al usuario — la tabla de revisión de importación, el registro de movimientos, y las gráficas del Resumen — porque el "chrome" fijo (headers, stepper horizontal, alturas de gráfica en píxeles) no se adapta al contenido real. Además, tres flujos secundarios tienen defectos funcionales concretos, no solo estéticos: el modal de compartir no facilita elegir un colaborador sin escribir, el PDF exportado superpone texto cuando los conceptos son largos y no identifica la cuenta por su número, y los filtros de fecha están desconectados del buscador con el que lógicamente deberían convivir.

## 5. Goals

1. El paso 2 ("Revisión y mapeo") de `AiImportScreen.jsx` le da a la tabla de revisión toda la altura disponible del viewport (no un `max-h` fijo en píxeles), y el indicador de pasos deja de ocupar una franja horizontal completa.
2. `ImportWizard.jsx` (importador manual CSV/XLSX) recibe el mismo tratamiento a través de un componente de pasos compartido y reutilizable, en vez de duplicar la corrección en dos archivos.
3. El header de cuenta en `AccountScreen.jsx` arranca colapsado por default cuando la cuenta tiene más de un umbral de movimientos, dejando más espacio vertical a la tabla de registro sin que el usuario tenga que colapsarlo manualmente cada vez.
4. La dona "Distribución" en el tab Resumen ya no se recorta contra su propio legend ni contra el borde de la tarjeta.
5. El cursor de hover de los tooltips de Recharts (área y barras) usa un color que respeta el tema oscuro, no el gris/blanco por default de la librería.
6. El tab Resumen gana dos gráficas nuevas reutilizando datos que el endpoint ya expone o que requieren solo una extensión aditiva de su respuesta: "Top categorías" (a partir de `by_category`) e "Ingresos vs egresos por mes" (nuevo campo aditivo `by_month`).
7. El modal "Compartir" (`UserSearchModal.jsx`, invocado desde el tab Acceso) muestra una lista por default de colaboradores potenciales de la empresa sin que el usuario tenga que escribir primero, conservando el selector de rol editor/viewer que ya existe.
8. El PDF exportado (`export-service.js`) mide la altura real de cada fila antes de avanzar el cursor vertical, de modo que texto largo en "Concepto"/"Nombre" hace wrap dentro de su propia fila en vez de superponerse con la siguiente.
9. El subtítulo del header del PDF (y el resumen del Excel) incluyen el número de cuenta junto a la moneda.
10. El footer del PDF incluye una marca de agua con el isotipo de Runly (imagen, no solo texto), además del texto "Hecho con Runly ERP" que ya existe.
11. En el tab Registro, el rango de fechas y el buscador de movimientos aparecen en la misma fila, y los tabs Registro/Resumen/Acceso quedan en su propia fila arriba.

## 6. Non-goals

1. No se crean modelos Prisma nuevos ni migraciones — todos los cambios de datos son campos aditivos en respuestas ya existentes.
2. No se toca el comportamiento offline/SQLite (Tier 2.5): Resumen, importación y exportación siguen siendo online-only, sin cambios.
3. No se agregan permisos nuevos. Se reutilizan `ledger.accounts.read` y `ledger.export` ya existentes, y el sistema de roles editor/viewer/admin ya shippeado no cambia de forma.
4. No hay cambios de paginación ni filtrado server-side en el registro de movimientos más allá de lo que ya implementó la spec del 2026-09-23.
5. No se rediseñan `TypesScreen.jsx`, `CategoriesScreen.jsx`, `GroupsScreen.jsx`, `GroupScreen.jsx` ni `MembershipsScreen.jsx` — quedan exactamente igual.
6. No se consolida `GET /users/search` con el `createUserAccessService.listCandidates` que ya usa `runly.notes` (`apps/api/src/services/user-access-service.js`) — es un patrón precedente válido que se documenta como idea futura (sección 28), pero fusionarlo implicaría reconciliar formas de respuesta distintas (`display_name`+`email` snake_case vs `displayName` camelCase sin `email`), lo cual es un cambio más amplio que esta spec no cubre.
7. No se enruta `UserSearchModal.jsx` a través de `@runly/sdk` — sigue usando `fetch` directo como hoy; ese refactor queda para el futuro.
8. No se agrega una gráfica de tendencia a 12 meses fuera del rango de fechas seleccionado — "Ingresos vs egresos por mes" opera solo sobre el rango ya filtrado por `dateFrom`/`dateTo`.

## 7. User stories

- Como usuario que está importando un estado de cuenta con IA, quiero que la tabla de revisión use todo el espacio disponible de la pantalla, para poder ver y corregir más movimientos sin scroll excesivo.
- Como usuario con una cuenta con muchos movimientos, quiero que el header de la cuenta empiece colapsado, para que la tabla de registro tenga más espacio visible desde que abro la pantalla.
- Como usuario revisando el tab Resumen en modo oscuro, quiero que la dona no se vea cortada y que el hover de las gráficas no me deslumbre con blanco, para que la información se lea con claridad.
- Como usuario que analiza sus finanzas, quiero ver qué categorías concentran más gasto y cómo evolucionan mis ingresos/egresos mes a mes, para tomar mejores decisiones sin salir del tab Resumen.
- Como dueño de una cuenta, quiero ver una lista de colaboradores de mi empresa al abrir "Compartir" sin tener que escribir su nombre completo, para invitar más rápido.
- Como usuario que exporta su libro de cuentas en PDF, quiero que los conceptos largos no se encimen con la fila siguiente y que el número de cuenta aparezca junto a la moneda, para poder compartir el reporte con confianza en su legibilidad.
- Como usuario que busca un movimiento por fecha y por texto, quiero que ambos filtros estén en la misma fila, para no tener que mirar en dos lugares distintos de la pantalla.

## 8. UX requirements

Todas las etiquetas nuevas van en español, siguiendo la convención del módulo.

**Asistente de importación (IA y manual):**
- Se crea un componente compartido `ImportStepIndicator` en `packages/ui/src/components/ImportStepIndicator.jsx` (exportado desde `packages/ui/src/index.js`, documentado en `docs/ai-context/rme3-runtime-capabilities.md`) que reemplaza los `STEPS`/step-pills locales de `AiImportScreen.jsx` y `ImportWizard.jsx`.
- En viewports de escritorio (`sm:` y arriba), el indicador se renderiza como un riel vertical angosto a la izquierda (ancho fijo, ej. `w-56`), liberando el ancho horizontal completo para la tabla de revisión debajo/al lado.
- En mobile, el mismo componente colapsa a una fila horizontal compacta (una línea, sin las tarjetas de `min-w-48` actuales) para no robarle ancho a la tabla en pantallas angostas.
- El contenedor de la tabla de revisión pasa de `max-h-112`/`max-h-40`/`max-h-64` fijos a `flex-1 min-h-0` dentro de un layout `h-full flex flex-col`, de modo que ocupa todo el espacio vertical restante del viewport.

**Registro (AccountScreen):**
- `headerCollapsed` arranca en `true` cuando la cuenta activa tiene más de un umbral de movimientos (definir el umbral en el plan, ej. > 20, usando el conteo que `SpreadsheetRegister` ya carga — no se agrega una query nueva solo para decidir esto). Con menos movimientos, arranca expandido como hoy.
- Los filtros de fecha (`Desde`/`Hasta`) se mueven de la fila de tabs a la misma fila que el buscador de `SpreadsheetRegister` (búsqueda + tipo + categoría). Los tabs Registro/Resumen/Acceso quedan solos en su propia fila, arriba.

**Resumen (AccountSummary):**
- La sección "Distribución" recalcula la geometría del Pie (radio/centro) en función de la altura real disponible descontando el espacio del `<Legend>`, en vez de usar `cy`/`outerRadius` fijos que asumen que el legend no ocupa espacio.
- Todo `<Tooltip>` de Recharts en este archivo define `cursor` explícito con tokens de tema (ej. `cursor={{ fill: 'hsl(var(--muted)/0.15)' }}` para barras, línea con `stroke={C_BORDER}` para el área) — cero cursor gris/blanco por defecto.
- Nueva sección "Top categorías": barra horizontal (mismo patrón que "Por categoría" ya existente) mostrando las 5 categorías con mayor gasto/ingreso combinado, agrupando el resto como "Otras". Se alimenta de `by_category`, ya devuelto hoy — sin cambio de backend.
- Nueva sección "Ingresos vs egresos por mes": barras agrupadas (Ingreso/Egreso) por mes dentro del rango filtrado, alimentada por el nuevo campo aditivo `by_month` en la respuesta de `GET /ledger/accounts/:id/summary`.

**Compartir (UserSearchModal, invocado desde Acceso):**
- Al abrir el modal sin haber escrito nada, se muestra automáticamente una lista de hasta 20 colaboradores potenciales de la empresa (mismo diseño de fila que los resultados de búsqueda actuales), excluyendo al usuario actual y a quienes ya son colaboradores de la cuenta (`excludeIds`, prop que el modal ya soporta).
- Si la empresa no tiene otros usuarios, se muestra el mismo mensaje de "No se encontraron usuarios." que ya existe para búsquedas sin resultado.
- El selector de rol (editor/viewer) sigue apareciendo solo después de seleccionar un usuario, sin cambios en ese flujo.

**Reporte PDF:**
- El subtítulo del header pasa de `${account.name} — ${currency}` a `${account.name} — ${currency} — ${account.account_number}`, omitiendo el tercer segmento si `account_number` está vacío.
- Cada fila de la tabla mide su altura real con `doc.heightOfString(...)` sobre la celda más alta de esa fila (considerando wrap) antes de avanzar `y`, y usa esa altura medida (no `12` fijo) para decidir el salto de página.
- El footer agrega el isotipo de Runly (imagen, no texto) con opacidad baja (`doc.opacity(0.08)` o similar) centrado en el área del footer o como marca de agua diagonal de página completa — a decidir en el plan según legibilidad; en cualquier caso debe verse en modo de la marca de la empresa igual (no debe reemplazar el logo de la empresa que ya aparece en el header).
- El resumen del Excel (`buildExcelBuffer`) agrega una fila `['Numero de cuenta', account?.account_number ?? '']` junto a las filas de Cuenta/Banco/Moneda que ya existen.

## 9. Routes/screens

| Route | Screen | Module | Description |
|---|---|---|---|
| /app/m/runly.ledger/accounts/:id (tab Registro/Resumen/Acceso) | AccountScreen | runly.ledger | Layout de header/tabs/filtros, tab Resumen con gráficas, tab Acceso con "Compartir" — todos modificados |
| /app/m/runly.ledger/accounts/import-ai | AiImportScreen | runly.ledger | Paso 2 (Revisión y mapeo) — modificado |
| /app/m/runly.ledger/accounts/:id/import | ImportWizard | runly.ledger | Importador manual CSV/XLSX — modificado (mismo fix de stepper/altura) |

No se agregan rutas nuevas.

## 10. Data model

No hay entidades nuevas ni cambios de esquema. Un solo campo aditivo en un payload de respuesta ya existente:

### Modified response shapes

- `GET /ledger/accounts/:id/summary` — agrega `by_month: { month: string /* 'YYYY-MM' */, deposito: number, retiro: number }[]`, calculado en `summary-service.js` con una agregación mensual sobre `ledger_transaction` dentro del rango `dateFrom`/`dateTo` ya recibido (mismo patrón de query que `by_category`, agrupando por `date_trunc('month', fecha)` en vez de por categoría).
- `GET /users/search` — cuando `q` se omite, la respuesta tiene la misma forma (`{ data: [{ id, display_name, email }] }`) pero devuelve los primeros N miembros de la empresa ordenados por `display_name` en vez de resultados filtrados por texto.

## 11. Prisma impact

New models: N/A
Modified models: N/A
New migration required: No
Migration safety notes: N/A — no se toca `prisma/schema.prisma` ni ninguna tabla RME3.

## 12. API contract

### GET /ledger/accounts/:id/summary (modificado)

Auth: required
Permission: `ledger.accounts.read`
Query: `from?`, `to?` (sin cambios)
Response (antes): `{ data: { kpis, balance_series, by_category } }`
Response (después): `{ data: { kpis, balance_series, by_category, by_month } }` — `by_month` es aditivo, los consumidores actuales que ignoren el campo no se rompen.

### GET /users/search (modificado)

Auth: required
Permission: `ledger.accounts.read`
Query (antes): `q` (string, **min 2 chars, obligatorio**), `limit?`
Query (después): `q?` (string, min 2 chars **cuando se envía**), `limit?` (default 20 cuando `q` está ausente, tope existente cuando `q` está presente)
Response: `{ data: [{ id, display_name, email }] }` (sin cambio de forma)
Error codes: `400` si `q` se envía pero tiene menos de 2 caracteres (sin cambio); ya no hay error `400` por `q` ausente.

Nota de implementación: la query SQL cruda de `apps/api/src/routes/users-routes.js` (líneas 20-33) mantiene su forma, solo condiciona el filtro `ILIKE` a si `q` viene presente, igual que ya hace `createUserAccessService.listCandidates` (`apps/api/src/services/user-access-service.js`, línea 67) para `runly.notes` — mismo patrón, sin fusionar el código (ver Non-goals #6).

Sin cambios de contrato en `GET/POST /ledger/accounts/:id/export/{pdf,xlsx,csv}` — el formato de request/response HTTP es idéntico; solo cambia la lógica interna de `export-service.js`/`pdf-branding-service.js` que construye los buffers.

## 13. SDK contract

Domain: `ledger` (ya existente en `packages/sdk/src/index.js`)

- `getAccountSummary(id, token, query)` — sin cambio de firma; el tipo de retorno documentado gana el campo `by_month` (aditivo).

No se agrega ningún método SDK para `/users/search` — `UserSearchModal.jsx` sigue llamándolo con `fetch` directo (Non-goals #7).

## 14. Validator contract

- `userSearchQuerySchema` (`apps/api/src/routes/ledger/validators.js`) — `q` pasa de `z.string().min(2)` (o equivalente) a `z.string().min(2).optional()`; `limit` conserva su default/clamp actual, documentando el nuevo default aplicable cuando `q` está ausente.
- No se agregan ni modifican schemas en `@runly/validators` (los cambios de query quedan en el validator local de la ruta, que ya vive fuera de `packages/validators`).

## 15. Module manifest impact

N/A — no se modifica `apps/api/src/manifests/official/core-modules.js` ni ningún manifest de `modules/custom/`. `runly.ledger` es un módulo core existente; esta spec no cambia su dependencies, permissions, navigation, blueprints ni ACL.

## 16. Navigation impact

N/A — no se agregan ni modifican entradas de navegación.

## 17. Blueprint impact

N/A — `runly.ledger` no usa blueprints declarativos para estas pantallas (son screens React directas), y esta spec no introduce ninguno.

## 18. RBAC/permissions

No se declaran permisos nuevos. Se reutilizan los siguientes, sin cambios en su alcance:

| Permission key | Guards endpoint(s) | Gates navigation |
|---|---|---|
| ledger.accounts.read | GET /ledger/accounts/:id/summary, GET /users/search | No (ya gatea la navegación de Cuentas, sin cambio) |
| ledger.export | GET /ledger/accounts/:id/export/{pdf,xlsx,csv} | No |

El rol editor/viewer/admin ya shippeado (`MEMBER_ROLE_BADGE_VARIANT`, `ROLE_LABEL` en `GroupScreen.jsx`) no cambia de forma; esta spec solo hace más fácil *elegir* un usuario y rol en el modal, no introduce un rol nuevo a nivel de cuenta individual.

## 19. Multi-company behavior

Sin cambios al modelo de aislamiento. `GET /users/search` (con o sin `q`) sigue filtrando por `membership.company_id = ${companyId}` y excluyendo al actor (`p.id != actorId`) y a los bots (`is_bot = false`) exactamente como hoy — la única diferencia es que el filtro `ILIKE` se vuelve condicional. `by_month` en el resumen usa el mismo `WHERE account_id = ... AND company_id = ...` que ya protege `by_category`/`balance_series`.

## 20. Files/storage impact

Sí, para el watermark del PDF: el header ya carga el logo **de la empresa** (`branding.logoBuffer`, vía Supabase Storage — `loadCompanyLogoBuffer` en `pdf-branding-service.js`). El watermark que pide el usuario es el isotipo **de Runly como producto**, no el logo de cada tenant — son dos imágenes distintas y no deben confundirse. Por eso el isotipo de Runly se agrega como **asset estático empaquetado** (ej. `apps/api/src/assets/runly-mark.png`, cargado una vez con `fs.readFileSync`/`import.meta.url` al boot del proceso, cacheado en memoria) en vez de subirlo a Supabase Storage — no hay `FileAsset` nuevo, no hay bucket nuevo, no depende de que cada empresa tenga algo configurado.

## 21. Export/import requirements

Sí — esta spec modifica el PDF y el Excel de `runly.ledger` (formato existente, sin nuevos formatos):
- PDF: layout de filas con wrap medido, subtítulo con `account_number`, watermark con isotipo de Runly.
- Excel: fila adicional `Numero de cuenta` en la hoja "Resumen".
- CSV: sin cambios (no tiene concepto de "header" branded ni watermark).

No hay cambios de importación (bulk import) en esta spec más allá del layout del wizard (sección 8) — la lógica de reconocimiento/commit de `use-ai-import.js` y de `ImportWizard.jsx` no cambia.

## 22. Audit log requirements

N/A — ninguno de estos cambios agrega o modifica una acción de escritura que deba auditarse. Exportar un PDF/Excel y listar usuarios para compartir ya son operaciones de lectura no auditadas hoy; esta spec no cambia esa política.

## 23. Edge cases

1. PDF: una celda de "Concepto" extremadamente larga (>200 caracteres) debe hacer wrap dentro de su fila; si el wrap resultante empuja `y` más allá del límite de página, debe dispararse `doc.addPage()` con el header redibujado **antes** de dibujar el contenido de esa fila, no a la mitad.
2. PDF: cuenta sin `account_number` (vacío o null) — el subtítulo debe omitir ese tercer segmento en vez de mostrar `— undefined` o `— `.
3. PDF: empresa sin `brandingConfig`/logo propio (`EMPTY_BRANDING`) — el watermark de Runly debe seguir apareciendo igual, porque es un asset estático independiente del logo de la empresa.
4. `/users/search` sin `q`: empresa con cero colaboradores potenciales (cuenta nueva, empresa unipersonal) — el modal debe mostrar el mensaje de "no encontrados" existente, no un spinner infinito.
5. `/users/search` sin `q`: empresa con muchos miembros (>100) — el límite por default (20) se aplica igual que en modo búsqueda, para no volcar el directorio completo en un modal.
6. Dona "Distribución" con una sola categoría presente (ej. cuenta con puros egresos en el rango) — el fix de geometría no debe introducir una regresión donde el legend de un solo ítem quede descentrado.
7. `ImportStepIndicator` en mobile: debe colapsar a una fila horizontal compacta, no reservar el mismo ancho fijo que en desktop, o le robaría espacio a la tabla en pantallas angostas — justo el problema que esta spec busca resolver.
8. Umbral de auto-colapso del header de cuenta: debe derivarse del conteo de filas que `SpreadsheetRegister` ya trae (no una query nueva), y debe recalcularse si el usuario cambia de cuenta sin recargar la página completa.
9. `by_month` con rango de fechas que cruza el cambio de año (ej. de diciembre a enero) — el agrupamiento por `date_trunc('month', fecha)` debe ordenar cronológicamente, no alfabéticamente por el string `'YYYY-MM'`.

## 24. Risks

1. Riesgo: Reescribir el loop de altura fija de `drawRow` en `export-service.js` puede romper silenciosamente la lógica de salto de página existente (`y > page.height - margins.bottom - 30`) para exportaciones grandes (miles de filas), causando crashes o páginas en blanco. Mitigación: conservar el mismo chequeo de salto de página pero alimentarlo con la altura *medida* de la fila en vez de una constante fija; probar manualmente con la cuenta "Prueba" (13 movimientos) más una fila sintética con texto largo, y con un export de varios cientos de filas para confirmar que el paginado sigue funcionando.
2. Riesgo: Relajar `userSearchQuerySchema` para aceptar `q` ausente podría reutilizarse sin querer en el futuro como un endpoint genérico de "listar todos los usuarios de la empresa" fuera de la intención original de `runly.ledger`. Mitigación: mantener el guard de permiso `ledger.accounts.read` en el endpoint y un límite más bajo (20) en modo "sin query" que en modo búsqueda.
3. Riesgo: El fix de geometría de la dona y la extracción del `ImportStepIndicator` compartido tocan layout que podría estar referenciado por selectores de test o QA manual en otro lado. Mitigación: `grep` de `data-row`/`data-col`/`aria-label` y de cualquier test en `apps/desktop/src/modules/runly.ledger/**/__tests__` antes de tocar estos archivos (al momento de escribir esta spec no se encontró ninguno que dependa de esta UI específica, pero debe reconfirmarse en la etapa de Discovery del plan).
4. Riesgo: Empaquetar un asset estático nuevo dentro de `apps/api` cambia qué archivos debe incluir el pipeline de build/deploy del API — si el pipeline solo copia `src/**/*.js`, un `.png` embebido podría no llegar a producción aunque funcione en `pnpm dev:api`. Mitigación: verificar con `pnpm build` que el asset se resuelve en runtime (no solo en dev vía path relativo a `import.meta.url`), y documentar el requisito en el plan.

## 25. Acceptance criteria

1. Given el paso 2 ("Revisión y mapeo") del asistente de importación IA, when la tabla de revisión tiene más filas de las que caben en 448px, then el área con scroll de la tabla se extiende para llenar el espacio vertical restante de la pantalla (ya no queda topada en `max-h-112`).
2. Given el mismo fix, when se aplica a `ImportWizard.jsx` (importador manual CSV/XLSX), then ambos wizards usan el mismo componente `ImportStepIndicator` compartido y el mismo comportamiento de layout.
3. Given una cuenta en el tab Registro con más movimientos que el umbral definido, when la pantalla carga por primera vez, then el header de la cuenta se renderiza colapsado por default.
4. Given la dona "Distribución" del tab Resumen, when se renderiza dentro de la tarjeta de altura actual, then ninguna parte del anillo queda visualmente recortada por el legend ni por el borde de la tarjeta.
5. Given el modo oscuro, when el usuario pasa el mouse sobre una barra o punto de cualquier gráfica del Resumen, then el cursor del tooltip usa un color que respeta el tema, no una caja blanca/gris plana.
6. Given el tab Resumen con datos disponibles, when se renderiza, then aparecen las secciones "Top categorías" e "Ingresos vs egresos por mes" además de las tres existentes.
7. Given el modal "Compartir" abierto desde Acceso, when no se ha escrito texto de búsqueda, then se muestra una lista por default de hasta 20 colaboradores potenciales de la empresa, reemplazando el estado vacío actual.
8. Given un export en PDF donde una celda de "Concepto" o "Nombre" es más larga que su columna, when se genera el PDF, then el texto hace wrap dentro de esa misma fila y no se superpone con la fila siguiente.
9. Given un export en PDF de una cuenta con `account_number` no vacío, when se dibuja el header, then el subtítulo muestra `{nombre} — {moneda} — {account_number}`.
10. Given cualquier página del PDF generado, when se visualiza, then se ve una marca de agua con el isotipo de Runly en opacidad baja, además del texto "Hecho con Runly ERP" que ya existe.
11. Given el tab Registro, when se visualiza en ancho de escritorio, then el rango de fechas y el buscador de movimientos aparecen en la misma fila, y los tabs Registro/Resumen/Acceso quedan en su propia fila arriba.

## 26. Verification plan

- `node --check` sobre cada archivo `.js`/`.jsx` modificado o creado.
- `pnpm lint` — sin violaciones nuevas (regla guardrail + stubs por paquete).
- `pnpm build` — confirma que el asset estático del isotipo de Runly se resuelve en runtime dentro del build de `apps/api`, y que `apps/desktop` compila sin errores con el `ImportStepIndicator` nuevo.
- `node --test apps/api/src/routes/ledger/__tests__/` (si existe suite para `export-service.js`/`summary-service.js`; si no existe, agregar un test enfocado para: wrap de texto largo en `buildPdfBuffer` sin lanzar error, presencia de `account_number` en el subtítulo, y `by_month` ordenado cronológicamente en `getAccountSummary`).
- Manual (`pnpm dev`, cuenta "Prueba" u otra con datos reales):
  - Redimensionar la ventana en el paso 2 del import IA y confirmar que la tabla llena el espacio disponible.
  - Alternar tema claro/oscuro y pasar el mouse sobre las gráficas del Resumen para confirmar el color del cursor del tooltip.
  - Abrir "Compartir" en una empresa con ≥2 usuarios y confirmar que la lista por default aparece antes de escribir.
  - Exportar el PDF de una cuenta con un movimiento cuyo "Concepto" tenga >150 caracteres y confirmar visualmente que no hay superposición; confirmar que aparece el `account_number`; confirmar que se ve el watermark del isotipo de Runly.
  - Confirmar el layout de la fila de filtros del tab Registro en ancho de escritorio y en mobile.

## 27. Rollback plan

Todos los cambios son de frontend/generación de PDF más un campo aditivo de API y un validator relajado — no hay migraciones que revertir. El rollback es un `git revert` directo de los commits de esta feature. El campo `by_month` es aditivo (los consumidores actuales lo ignoran sin romperse) y el validator de `q` solo amplía lo que acepta (no restringe nada que funcionara antes), así que revertir cualquiera de los dos es seguro sin necesidad de limpieza de datos.

## 28. Future enhancements

1. Aplicar el mismo patrón de `ImportStepIndicator`/altura flexible a cualquier futuro wizard fuera de `runly.ledger`.
2. Consolidar `GET /users/search` con `createUserAccessService.listCandidates` (el mismo helper que ya usa `runly.notes`) una vez que se audite la compatibilidad exacta de forma de respuesta (`display_name`+`email` snake_case vs `displayName` camelCase sin `email`).
3. Agregación mensual server-side sobre una ventana histórica más larga que el rango de fechas seleccionado (ej. "tendencia de 12 meses"), para una gráfica de tendencia real independiente del filtro activo.
4. Enrutar `UserSearchModal.jsx` a través de `@runly/sdk` en vez de `fetch` directo.
5. Extender el mismo tratamiento de `account_number` en el subtítulo y watermark de isotipo de Runly a otros PDFs del sistema (fleet, HR) una vez validado aquí.
