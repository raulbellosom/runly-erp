# Importación de estados de cuenta con IA en runly.ledger

Date: 2026-09-19
Status: Draft
Author: Claude Sonnet 5
Spec file: docs/superpowers/specs/2026-09-19-ledger-ai-statement-import-design.md
Plan file: docs/superpowers/plans/2026-09-19-ledger-ai-statement-import.md (created after spec approval)

---

## 1. Feature title

Importación de estados de cuenta y archivos financieros con IA en runly.ledger.

## 2. Status

Draft

## 3. Context

`runly.ledger` ya tiene un import CSV manual (`ImportWizard.jsx` + `import-service.js`): el usuario mapea columnas a mano, dentro de una cuenta específica, y solo acepta CSV con una fila de encabezado limpia. En la práctica, los estados de cuenta que los usuarios reciben de sus bancos no vienen así: son PDFs con layout de tabla (texto seleccionable o escaneado/fotografiado), a veces mezclando formatos dentro del mismo archivo (un registro oficial del banco + una captura de pantalla de la app bancaria como comprobante, como en el ejemplo real revisado durante el diseño), con columnas cuyo significado (depósito vs. retiro) solo es inferible cruzando el saldo corriente, y a veces sin que el usuario sepa de antemano a qué cuenta de `ledger` corresponde.

Otros módulos de este repo ya resuelven el problema de "documento no estructurado → dato estructurado revisado por el usuario" con IA (Groq): `runly.pfm` (OCR de recibos, revisión manual antes de insertar) y `runly.inventory` (intake de fotos → reconocimiento → validación de duplicados → creación, con lock de idempotencia). Existe también un worker (`inventory-chat-pdf-worker.js`) que extrae texto de PDF por página con `pdfjs-dist` en un hilo aislado.

## 4. Problem

Un usuario que recibe un estado de cuenta bancario (PDF, foto, o Excel/CSV con columnas no estandarizadas) no tiene manera de importarlo a `runly.ledger` sin transcribir los movimientos a mano o adaptar el archivo al formato CSV rígido que exige el wizard actual. Además, reimportar el mismo período (o un archivo que combina dos representaciones del mismo movimiento, como en el ejemplo real) puede duplicar transacciones, y hoy no existe ninguna detección de duplicados en el import.

## 5. Goals

1. El usuario puede subir un PDF (con texto o escaneado/fotografiado), una imagen, o un CSV/XLSX de cualquier banco, sin mapear columnas a mano, y obtener una lista de movimientos extraídos y editables.
2. El sistema sugiere automáticamente a qué cuenta de `ledger` pertenece el archivo, cuando el documento trae un número de cuenta o banco identificable.
3. El sistema detecta y marca movimientos que ya existen en la cuenta (contra la base de datos) y movimientos repetidos dentro del mismo archivo (p. ej. el mismo movimiento representado dos veces en dos formatos), sin descartar nada automáticamente.
4. El usuario revisa, edita, decide sobre cada posible duplicado, confirma la cuenta destino, y solo entonces los movimientos se insertan — nunca hay inserción automática sin revisión.
5. Un PDF de hasta ~10 páginas (varios cientos de movimientos) se procesa correctamente en una sola operación, sin truncar movimientos ni perder páginas.
6. Reintentar el commit del mismo lote (doble clic, reconexión) no duplica los movimientos ya insertados.

## 6. Non-goals

1. No se construye en esta fase el asistente de chat de `ledger` (queda para una iteración siguiente que reutilizará este mismo pipeline como una tool, igual que `runly.inventory`).
2. No se reemplaza ni modifica el wizard CSV manual existente (`ImportWizard.jsx`) — queda intacto como alternativa.
3. No se soportan archivos de más de 20 páginas o mayores a un límite de tamaño (ver Edge cases) en esta versión — se le pide al usuario dividir el archivo.
4. No se procesan estados de cuenta de tarjetas de crédito con estructura de "cargos por autorizar/pendientes" — solo movimientos liquidados con fecha y monto.
5. No se automatiza la creación de cuentas nuevas cuando la IA no reconoce ninguna cuenta existente — el usuario siempre elige o crea la cuenta manualmente en ese caso.

## 7. User stories

- Como usuario de `ledger`, quiero subir el PDF que me manda mi banco y ver los movimientos ya separados en fecha/monto/concepto, para no transcribirlos a mano.
- Como usuario, quiero que el sistema me diga a qué cuenta pertenece el archivo cuando sea obvio, para no tener que buscarla yo.
- Como usuario, quiero que se me avise si un movimiento que estoy importando ya existe, para no duplicar mi registro contable.
- Como usuario, quiero poder editar cualquier campo extraído (fecha, monto, categoría, etc.) antes de confirmar, porque la IA puede equivocarse.
- Como usuario, si mi archivo trae el mismo movimiento representado dos veces (p. ej. tabla oficial + comprobante fotografiado), quiero que se detecte automáticamente y no se inserte dos veces.

## 8. UX requirements

- Punto de entrada nuevo, global (no dentro de una cuenta): botón "Importar con IA" visible en `AccountsScreen.jsx`.
- Flujo de 3 pasos en una pantalla nueva `AiImportScreen.jsx`:
  1. **Subir archivo** — dropzone (reutiliza `DistDropZone` de `@runly/ui`) aceptando PDF, JPG/PNG/WEBP, CSV, XLSX. Muestra estado "Analizando..." con spinner mientras se llama a `recognize`.
  2. **Revisar** — tabla editable (similar en espíritu a `SpreadsheetRegister`, pero más simple: sin navegación de teclado por celdas) con una fila por movimiento extraído. Cada fila muestra: fecha, nombre, monto (dep/retiro), referencia, concepto, categoría sugerida (editable, `SelectField`), y un badge "Posible duplicado" cuando aplica, con un toggle "Importar de todas formas" por fila. Selector de cuenta destino arriba de la tabla, pre-seleccionada si la IA la detectó, con aviso visible ("Detectamos esta cuenta por el número xxxx9917") o "No se detectó — selecciona la cuenta" si no.
  3. **Confirmar** — resumen (N movimientos a importar, M marcados como duplicado que se omitirán salvo que el usuario los active) y botón "Importar".
- Estados de error explícitos (usando `ErrorState`, nunca texto suelto): archivo no soportado, no se pudo extraer texto/contenido, todas las filas fueron descartadas.
- Filas con confianza baja de la IA se marcan visualmente (`Badge` "Revisar") pero nunca se ocultan ni se auto-corrigen.
- Todo el texto de UI en español, siguiendo la política UI-first (`PageHeader`, `EmptyState`, `ErrorState`, `ConfirmDialog`, `SelectField`/`CreatableComboboxField` — nunca `<select>` nativo aquí, a diferencia de la excepción ya documentada en `SpreadsheetRegister`).

## 9. Routes/screens

| Route | Screen | Module | Description |
|---|---|---|---|
| /app/m/runly.ledger/import-ai | AiImportScreen | runly.ledger | Flujo de 3 pasos: subir, revisar, confirmar |

## 10. Data model

### New models

Ninguno. Ver Sección 11 — se reutiliza infraestructura existente.

### Modified models

Ninguno.

## 11. Prisma impact

New models: N/A
Modified models: N/A
New migration required: No

Notas:
- La idempotencia del commit se resuelve reutilizando el modelo `AuditLog` ya existente (`prisma.auditLog`), con el mismo patrón que `inventory-intake-service.js`: se busca un `auditLog` previo con `moduleKey: 'runly.ledger'`, `action: 'ledger.import.committed'`, y `metadata.key` igual al `batchKey` que manda el cliente; si existe y el `fingerprint` (hash del payload final) coincide, se responde con el resultado ya guardado sin volver a insertar; si el `fingerprint` no coincide, se rechaza con 409 ("Este lote ya se importó con otros datos").
- El archivo original (si el usuario quiere conservarlo) se sube vía el `filesService` ya existente como `FileAsset` (`moduleKey: 'runly.ledger'`, `entityType: 'LedgerImport'`), igual que hacen otros módulos — ver Sección 20.
- Las tablas `ledger_account` y `ledger_transaction` (gestionadas por `$queryRaw`, no por Prisma) no cambian de estructura.

## 12. API contract

### POST /ledger/imports/recognize

Auth: required
Permission: `ledger.import` (reutiliza el permiso existente que ya gatea el import CSV)
Body: `multipart/form-data` — campo `file` (PDF/imagen/CSV/XLSX, límites en Sección 23)
Response (éxito):
```
{
  data: {
    proofToken: string,            // HMAC firmado, expira en 2h
    detectedAccount: { id, name, bank, confidence } | null,
    candidateAccounts: [{ id, name, bank }],  // si no hay un match único
    rows: [{
      tempId: string,
      fecha, nombre, referencia, concepto, numero,
      deposito: number | null, retiro: number | null,
      suggestedCategoryId: string | null,
      suggestedTipoId: string | null,
      confidence: number,          // 0-1
      possibleDuplicate: { existingTransactionId, existingConsecutive } | null,
      sourcePage: number | null,
    }],
    warnings: string[],            // p. ej. "Página 4 no se pudo leer, revisa manualmente"
  }
}
```
Response (error): `{ error: string }` — 400 (archivo no soportado/vacío), 422 (no se extrajo ningún movimiento), 503 (IA no configurada, sin `GROQ_API_KEY`).

### POST /ledger/imports/commit

Auth: required
Permission: `ledger.import`
Body:
```
{
  proofToken: string,
  accountId: string,
  batchKey: string,               // uuid generado por el cliente, estable entre reintentos
  rows: [{ tempId, fecha, nombre, referencia, concepto, numero, deposito, retiro, categoryId, tipoId, includeDuplicate: boolean }],
}
```
Response: `{ data: { inserted: number, skipped: number } }` — 200 (o el resultado ya cacheado si `batchKey` se repite con el mismo contenido), 409 (conflicto de idempotencia), 400/403 (token inválido/expirado, cuenta sin permiso de escritura).

## 13. SDK contract

Domain: `ledger` (extiende el dominio existente en `packages/sdk`)

- `recognizeImport(file, token)` — `multipart/form-data`, retorna `{ data }` como arriba.
- `commitAiImport(payload, token)` — retorna `{ data: { inserted, skipped } }`.

## 14. Validator contract

Nuevos schemas en `apps/api/src/routes/ledger/validators.js` (no en `@runly/validators`, siguiendo el patrón ya usado por el resto de `ledger`, cuyos validadores viven localmente al módulo):

- `aiImportCommitSchema` — valida: `proofToken` (string, requerido), `accountId` (uuid, requerido), `batchKey` (uuid, requerido), `rows` (array, min 1, cada fila con `fecha` ISO, `deposito`/`retiro` (uno de los dos > 0), `nombre` requerido).

## 15. Module manifest impact

`runly.ledger` ya existe y está instalado; no es un módulo nuevo. No se requiere manifest nuevo.

Permisos: se reutiliza `ledger.import` (ya declarado en `permission-catalog.js`), sin permisos nuevos.

## 16. Navigation impact

Ninguna entrada de navegación nueva a nivel de sidebar — el acceso es un botón dentro de `AccountsScreen.jsx` (no una ruta del menú principal), consistente con cómo hoy se llega al wizard CSV (dentro de una cuenta, no desde el menú).

## 17. Blueprint impact

N/A — `runly.ledger` no usa blueprints RME3, sus pantallas son código React a medida.

## 18. RBAC/permissions

| Permission key | Guards endpoint(s) | Gates navigation |
|---|---|---|
| ledger.import | POST /ledger/imports/recognize, POST /ledger/imports/commit | No (el botón se oculta si el usuario no tiene el permiso, igual que el import CSV actual) |
| ledger.accounts.read | Necesario indirectamente para listar cuentas candidatas en el selector | No |

## 19. Multi-company behavior

Toda extracción y todo commit se scoped por `companyId` del actor (igual que el resto de `ledger`): la detección de cuenta solo busca entre `ledger_account` de la compañía activa; la detección de duplicados solo compara contra `ledger_transaction` de esa misma compañía/cuenta; el `proofToken` firma `companyId` + `actorId` para que no pueda reutilizarse cruzando compañías.

## 20. Files/storage impact

Sí. El archivo original subido es opcionalmente conservado como adjunto de auditoría:
- Bucket: `atlas-files` (el bucket canónico ya usado por `filesService`).
- objectKey prefix: `modules/runly.ledger/LedgerImport/<accountId>/<timestamp>-<filename>`.
- Metadata de `FileAsset` escrita vía Prisma (`filesService.upload()`), con `visibility: 'PRIVATE'`, vinculado a la cuenta ya confirmada (se sube en el commit, no en el recognize, para no guardar archivos de intentos abandonados).
- El PDF/imagen se guarda para trazabilidad contable (poder volver a ver de dónde salió un movimiento), visible después vía `AttachmentsPanel` en `AccountScreen`.

## 21. Export/import requirements

Sí — este es el propio feature. Formatos de entrada: PDF (texto o escaneado), JPG/PNG/WEBP, CSV, XLSX. Trigger: acción manual del usuario ("Importar con IA" en `AccountsScreen`). No hay importación programada/automática.

## 22. Audit log requirements

| Action key | Trigger | Payload |
|---|---|---|
| ledger.import.recognized | POST /ledger/imports/recognize (éxito) | after: { accountId (si detectada), rowCount, warnings } |
| ledger.import.committed | POST /ledger/imports/commit (éxito) | metadata: { key: batchKey, fingerprint }, after: { accountId, inserted, skipped } |

## 23. Edge cases

1. **PDF de 10 páginas con texto**: se extrae texto de todas las páginas (worker dedicado, ver Sección "Approach"/plan) y se manda al modelo de texto en una sola llamada si cabe en el presupuesto de tokens; si no, se parte en bloques de páginas y se fusiona, aplicando el mismo dedup intra-archivo entre bloques.
2. **Documento mixto (texto + página escaneada)**: se detecta por página si la extracción de texto vino vacía/ilegible (igual que el flag `empty` del worker de `inventory-chat-pdf-worker.js`); esa página específica cae a extracción por visión, el resto sigue por texto — ambas rutas producen la misma forma de fila para poder fusionarse.
3. **Mismo movimiento representado dos veces en el archivo** (como el ejemplo real: tabla oficial + captura de la app bancaria): fingerprint intra-archivo (fecha + monto + referencia/nombre normalizado) colapsa duplicados exactos del mismo lote antes de mostrarlos al usuario; casos ambiguos (montos iguales pero fechas/nombres ligeramente distintos) se muestran como filas separadas, no se adivina.
4. **Columna depósito/retiro ambigua en el texto extraído** (la alineación de columnas se pierde en texto plano): el prompt exige al modelo usar el saldo corriente (cuando está presente en el documento) para inferir el signo del movimiento.
5. **Ningún número de cuenta reconocible en el documento**: `detectedAccount` es `null`, se listan `candidateAccounts` (todas las cuentas de la compañía) para selección manual; el commit exige `accountId` explícito.
6. **Archivo demasiado grande o con demasiadas páginas** (> 20 páginas o > 15MB): se rechaza en `recognize` con 400 y un mensaje pidiendo dividir el archivo — no se intenta procesar parcialmente sin avisar.
7. **Reintento de commit con la misma `batchKey`**: responde con el resultado ya guardado (ver Sección 11), no inserta de nuevo.
8. **`proofToken` expirado o manipulado** (usuario dejó la pantalla de revisión abierta más de 2h, o el payload de filas no coincide con lo firmado): 403, se le pide repetir `recognize`.
9. **`GROQ_API_KEY` no configurada**: el botón "Importar con IA" se deshabilita con un tooltip explicativo, igual que hoy pasa con el asistente de PFM cuando falta la key.
10. **Fila con `deposito` y `retiro` ambos en cero/nulos** (la IA no pudo determinar el monto): se marca con confianza baja y se bloquea su inclusión hasta que el usuario complete el monto manualmente.

## 24. Risks

1. Riesgo: el modelo de texto alucina montos o conceptos en tablas con formato inconsistente entre bancos. Mitigación: revisión humana obligatoria antes de insertar (nunca hay auto-commit); campo `confidence` por fila con umbral visual de "revisar".
2. Riesgo: costo/latencia de Groq en documentos largos. Mitigación: extracción de texto (barata) como ruta primaria; visión (cara) solo para páginas sin texto; límite duro de 20 páginas por archivo en v1.
3. Riesgo: falsos positivos de duplicado (dos movimientos legítimos idénticos en fecha/monto/referencia, p. ej. pagos recurrentes) causan que el usuario ignore por hábito el badge de duplicado. Mitigación: el badge siempre requiere una acción explícita por fila para omitir, nunca se pre-desmarca ni se auto-excluye del commit.
4. Riesgo: el `proofToken` firmado crece mucho con cientos de filas (JWT/HMAC de payload grande). Mitigación: el token firma solo un hash del conjunto de filas + metadata de contexto (companyId, actorId, accountId candidato), no las filas completas; las filas viajan en el body del commit y se verifican contra el hash.

## 25. Acceptance criteria

1. Dado un usuario con `ledger.import`, cuando sube el PDF de ejemplo (10 páginas, texto seleccionable), entonces `recognize` devuelve todas las filas de movimientos sin duplicar las que aparecen representadas dos veces en el documento.
2. Dado un documento con el número de cuenta impreso y coincidencia única en `ledger_account`, cuando se llama `recognize`, entonces `detectedAccount` no es `null` y coincide con esa cuenta.
3. Dado un movimiento extraído cuya fecha+monto+referencia coincide con una transacción ya existente en la cuenta destino, cuando se muestra en la revisión, entonces trae `possibleDuplicate` no nulo y no se incluye en el commit salvo que el usuario lo active explícitamente.
4. Dado un usuario sin `ledger.import`, cuando llama a `POST /ledger/imports/recognize`, entonces la API responde 403.
5. Dado un commit ya procesado exitosamente, cuando se reenvía con la misma `batchKey`, entonces no se insertan movimientos nuevos y se devuelve el mismo resultado.
6. Dado un archivo sin `GROQ_API_KEY` configurada en el entorno, cuando se intenta usar el importador con IA, entonces la UI lo indica claramente y no se puede iniciar el flujo.

## 26. Verification plan

- `node --test apps/api/src/routes/ledger/__tests__/` — incluye nuevos tests unitarios para: fingerprint de dedup intra-archivo, matching de cuenta por número, merge de bloques de páginas, verificación del proof token, e idempotencia del commit (mockeando Groq, nunca llamando a la API real en tests).
- `pnpm --filter apps/desktop build:web` — build de producción sin errores.
- `npx eslint apps/api/src/routes/ledger apps/desktop/src/modules/runly.ledger` — sin errores.
- Manual: subir el PDF de ejemplo real (10 páginas simuladas) contra un entorno con `GROQ_API_KEY` configurada, confirmar que la cuenta se detecta, los duplicados de la página 2 se marcan, y el commit inserta la cantidad correcta.
- Manual: usuario sin `ledger.import`, confirmar 403 en ambos endpoints.

## 27. Rollback plan

No hay migración que revertir (no hay cambios de esquema). Rollback = quitar la ruta `/app/m/runly.ledger/import-ai` del router y los dos endpoints nuevos; el resto del módulo (`ledger.import` existente, CSV wizard) sigue funcionando sin cambios porque esta feature es aditiva y no toca código existente de import CSV.

## 28. Future enhancements

1. Asistente de chat de `ledger` (fase 2) que invoque este mismo pipeline como tool (`propose_import`), igual que `inventory_prepare_create`.
2. Soporte para estados de cuenta de tarjeta de crédito (cargos pendientes/liquidados).
3. Creación de cuenta nueva directamente desde el flujo, cuando la IA detecta un banco/número no registrado.
4. Reglas de categorización aprendidas por el usuario (si siempre corrige "PLA ACEITE" a la misma categoría, sugerirla automáticamente la próxima vez).
5. Procesamiento asíncrono (worker + polling) para documentos que excedan el límite de 20 páginas, si en la práctica resulta ser una necesidad real.
