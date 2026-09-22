# Importación de calendarios .ics — diseño

Fecha: 2026-09-22
Estado: aprobado por el usuario ("toma siempre las mejores opciones y recomendadas"), pasando directo a plan + implementación

## Contexto

Algunos clientes de runly.calendar usan aCalendar / aCalendar+ (Android) para llevar su agenda. aCalendar no tiene backend propio ni API en la nube — es una UI sobre el proveedor de calendarios de Android (cuentas Google/Exchange sincronizadas, o calendarios puramente locales al dispositivo). Cuando el calendario del cliente está respaldado por una cuenta Google, ya existe una ruta de cero desarrollo: conectar esa cuenta con la integración de Google Calendar que ya tiene runly.calendar (`apps/api/src/routes/calendar/google/`). Pero cuando el calendario es local-only, la única forma de sacar los eventos es exportar un archivo `.ics` desde la app y traerlo a mano.

Este documento cubre esa segunda ruta: una importación manual, repetible, de archivos `.ics` hacia runly.calendar, con detección de duplicados para que re-subir un export más reciente no duplique lo ya importado.

## Alcance

Incluido:
- Endpoint de importación que recibe un archivo `.ics` (multipart) y un calendario destino (existente del usuario, o "crear uno nuevo").
- Parseo de `VEVENT`s con la librería `node-ical` (bundlea expansión de RRULE vía `rrule`) — no se escribe un parser ICS a mano.
- Expansión de eventos recurrentes a instancias individuales concretas (no se intenta mapear RRULE a nuestro modelo de recurrencia propio, que es mucho más limitado — ver "Decisiones" abajo).
- Detección de duplicados por `(calendarId, externalUid)`, donde `externalUid` combina el `UID` de icalendar con la fecha de la ocurrencia (para que una serie recurrente expandida en N eventos no colisione consigo misma).
- Mapeo de campos: `SUMMARY`→`title`, `DESCRIPTION`→`description`, `LOCATION`→`location`, `DTSTART`/`DTEND`→`startAt`/`endAt`, eventos de solo-fecha (sin hora) →`allDay: true`.
- UI: diálogo "Importar .ics" en la pantalla de calendario, con selector de calendario destino y resumen del resultado (importados / duplicados omitidos / con error).
- Límites: tamaño de archivo (~5 MB) y tope de instancias expandidas por import (2000), para no colgar el request con un `.ics` gigante o una recurrencia sin fin razonable.

Explícitamente fuera de alcance (v1):
- Invitados (`ATTENDEE`): se ignoran. No se intenta emparejar correos con usuarios de la empresa.
- Recordatorios (`VALARM`): se ignoran, no se crean `CalendarReminder`.
- Sincronización continua/automática: es importación manual bajo demanda, igual que el cliente exporta el `.ics` manualmente desde aCalendar+. No hay polling ni webhook.
- Exportar *desde* Runly hacia `.ics` (dirección inversa) — no se pidió, no se construye.
- Zonas horarias custom por evento más allá de lo que `node-ical` ya resuelve internamente (usa el `VTIMEZONE` del archivo o UTC); no se añade selector de timezone en la UI de import.

## Decisiones de diseño

**Por qué `node-ical` y no un parser propio:** el formato ICS tiene folding de líneas, caracteres escapados, y bloques `VTIMEZONE` con reglas de DST — son errores sutiles y bien documentados si se reimplementan a mano. `node-ical` ya resuelve esto y trae `rrule` para expandir recurrencia con `.between(start, end)`, que es exactamente lo que necesitamos.

**Por qué expandir recurrencia en vez de mapear RRULE→nuestro modelo:** nuestro `recurrenceRule` (`calendar-event-service.js`) solo soporta `{freq, interval, count, until}` con `freq` en `DAILY/WEEKLY/MONTHLY/YEARLY` — no soporta `BYDAY`, `BYMONTHDAY`, excepciones (`EXDATE`), etc., que sí son comunes en exports reales de calendario. Mapear "cuando el RRULE es simple, si no expandir" añade una rama de código y de pruebas por cada caso raro de RRULE que aparezca en producción. Expandir siempre es más simple, no puede interpretar mal una regla compleja, y es aceptable para una importación de datos históricos/ajenos: el usuario pierde la capacidad de "mover toda la serie" editando una instancia, pero eso ya no tiene sentido para eventos que vinieron de otra app de todos modos.

**Calendario destino y deduplicación:** el diálogo de import deja elegir "Crear calendario nuevo" (default, crea uno con `companyId` = empresa activa, nombre tomado de `X-WR-CALNAME` del `.ics` si existe, si no `"Importado — <nombre de archivo>"`) o cualquier calendario propio existente. La deduplicación es por calendario destino: si el usuario vuelve a importar el mismo `.ics` (o una versión más reciente con eventos nuevos) apuntando al mismo calendario que usó antes, los eventos ya presentes (mismo `externalUid` en ese calendario) se omiten y solo se crean los nuevos.

## Arquitectura

### 1. Migración de base de datos

Tabla nueva (Prisma core, no es una tabla de módulo RME3):

```prisma
model CalendarEventImportSource {
  id          String   @id @default(uuid(7)) @db.Uuid
  calendarId  String   @db.Uuid @map("calendar_id")
  externalUid String   @map("external_uid")
  eventId     String   @db.Uuid @map("event_id")
  createdAt   DateTime @default(now()) @map("created_at")

  calendar CalendarCalendar @relation(fields: [calendarId], references: [id], onDelete: Cascade)
  event    CalendarEvent    @relation(fields: [eventId], references: [id], onDelete: Cascade)

  @@unique([calendarId, externalUid])
  @@map("calendar_event_import_source")
}
```

Con las relaciones inversas correspondientes agregadas a `CalendarCalendar` (`importSources CalendarEventImportSource[]`) y `CalendarEvent` (`importSource CalendarEventImportSource?`).

`externalUid` se construye como `` `${event.uid}:${occurrenceStartIso}` `` — para un evento no-recurrente, una sola fila; para uno recurrente expandido, una fila por instancia, usando el ISO de inicio de esa instancia específica como parte de la clave.

### 2. `calendar-ics-import-service.js` (nuevo, junto a `calendar-event-service.js`)

```
createCalendarIcsImportService({ prisma })
  → importIcs({ userId, companyId, calendarId, calendarName, fileBuffer })
```

Flujo:
1. Parsear `fileBuffer` con `node-ical` (`ical.parseICS` o `ical.async.parseICS`, corriendo sync ya que el archivo cabe en memoria dado el límite de tamaño).
2. Si no hay `calendarId`: crear un `CalendarCalendar` nuevo (`ownerId: userId`, `companyId`, `name: calendarName`, `isDefault: false`). Si `calendarId` viene, validar que existe, está `enabled`, y el usuario tiene permiso de escritura (mismo chequeo `ownerId === userId || share EDITOR/MANAGER` que ya usa `calendar-event-service.js#createEvent` — se reutiliza esa lógica, no se reescribe).
3. Para cada objeto `VEVENT` del parseo:
   - Si tiene `rrule`: expandir con `.between(now - 2 años, now + 2 años)`, respetando `EXDATE` (que `node-ical`/`rrule` ya excluyen del resultado). Tope acumulado de 2000 instancias por import completo (no por evento) — al llegar al tope se detiene la expansión y el resultado final reporta cuántas quedaron fuera.
   - Si no tiene `rrule`: una sola instancia (su propio `start`/`end`).
   - Por cada instancia: calcular `externalUid`, `SELECT` en `CalendarEventImportSource` por `(calendarId, externalUid)` — si existe, contar como duplicado y omitir; si no, insertar `CalendarEvent` (campos mapeados, `sourceModule: 'ics_import'`, `sourceEntityId: null` — no aplica un UUID de otra tabla) + la fila de `CalendarEventImportSource` en la misma operación (ambos inserts dentro de una transacción corta por instancia, no una transacción gigante para todo el archivo — un archivo de 2000 eventos no debe mantener un solo `$transaction` abierto todo ese tiempo).
   - Un evento individual que falle al parsear/mapear (fecha inválida, etc.) se cuenta como error y se sigue con el resto — no aborta el import completo.
4. Devuelve `{ calendarId, calendarName, imported, duplicates, errors, truncated }` (`truncated: true` si se llegó al tope de 2000).

### 3. Ruta API

`POST /calendar/ics-import` en `calendar-routes.js`, protegida por el mismo permiso que crear eventos (`calendar.events.create`) más `calendar.calendars.create` si el flujo va a crear un calendario nuevo — en la práctica basta con `calendar.events.create` ya que crear el calendario es un paso interno del import, igual que `ensureDefaultCalendar` ya crea calendarios sin exigir el permiso de calendarios por separado.

Multipart: campo `file` (el `.ics`) + campo `calendarId` (opcional, string) + `calendarName` (opcional, solo usado si no hay `calendarId`). Valida tamaño de archivo (~5 MB) antes de parsear. Reusa el patrón de límite de tamaño que ya existe en `files-service.js` para subidas.

### 4. Frontend

Nuevo `ImportIcsDialog.jsx` en `apps/desktop/src/modules/runly.calendar/components/`, invocado desde un botón "Importar .ics" en `CalendarScreen.jsx` (junto a donde ya vive la entrada de conexión con Google Calendar). Contenido del diálogo:
- `FileUploader` (`@runly/ui`) para el `.ics`.
- `SelectField` "Importar en": opciones = calendarios propios existentes + "Crear calendario nuevo" (default).
- Botón "Importar" → `POST /calendar/ics-import`, deshabilitado mientras está en curso.
- Resultado: reutiliza el patrón de resumen ya usado para invitaciones de llamadas (`describeInviteOutcome`-style): toast con "`N` eventos importados · `M` duplicados omitidos" y, si hubo errores o truncamiento, un `ErrorState`/nota adicional.

SDK: `packages/sdk/src/domains/calendar.js` gana `importIcs(formData, token)` — `POST` multipart (no JSON, así que no usa el helper `json()` existente; sigue el patrón de subida de archivos ya usado en el dominio `files` del SDK).

## Manejo de errores y casos límite

- Archivo no es un `.ics` válido (parseo falla por completo): error único claro, "No se pudo leer el archivo .ics.", nada se crea.
- Archivo excede el límite de tamaño: rechazado antes de parsear.
- `calendarId` provisto no existe, está deshabilitado, o el usuario no tiene permiso de escritura: mismo `CalendarServiceError` 403/404 que ya usa `createEvent` (se reutiliza, no se duplica lógica).
- Evento sin `UID` en el `.ics` (raro pero permitido por el spec ICS): se genera un `externalUid` determinístico a partir de un hash de sus campos (`SUMMARY`+`DTSTART`) para que al menos la deduplicación funcione dentro de una misma sesión de import; se documenta como mejor-esfuerzo, no garantizado entre archivos exportados en momentos distintos.
- Recurrencia sin fin (`RRULE` sin `COUNT`/`UNTIL`, ej. "todos los días para siempre"): la ventana fija de 2 años atrás/adelante ya la acota, no requiere manejo especial.
- Reintentar el mismo archivo dos veces seguidas contra el mismo calendario: segunda vez, todo cae en "duplicados", cero eventos nuevos — es el comportamiento esperado, no un error.

## Pruebas

Cobertura enfocada (no exhaustiva) en `calendar-ics-import-service.test.js`, siguiendo el patrón de mocks ya usado en `calendar-event-service.test.js`:
- Importa un `.ics` con un evento simple no-recurrente → crea `CalendarEvent` + `CalendarEventImportSource`.
- Importa un evento con `RRULE` semanal con `COUNT` → se expande en N instancias.
- Reimportar el mismo archivo al mismo calendario → segunda vez, cero nuevos, todos duplicados.
- Rechaza `calendarId` de un calendario donde el usuario no tiene permiso de escritura.
- `.ics` corrupto → error controlado, no una excepción sin capturar.

No se agregan pruebas de UI automatizadas (no hay infraestructura de pruebas de componentes React en este repo — `node --test` es todo lo que hay). La verificación del diálogo es manual antes de dar por terminado, corriendo `pnpm dev` y probando el flujo real con un `.ics` de ejemplo.

## Documentación

No se toca `docs/03_custom_modules.md` (esto no es un módulo RME3, es una extensión del módulo core `runly.calendar` vía Prisma). Se añade una línea breve a `docs/08_blueprints.md` o donde corresponda si existe una sección de "importación de datos" para módulos core; si no existe tal sección, no se crea una nueva por esto — el código y este spec son la documentación.
