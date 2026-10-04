---
title: Servicios y eventos entre módulos
summary: Cómo tu módulo lee, crea y actualiza registros de Calendario, Archivos, Notificaciones, Inventario, Contactos y Proyectos con autorización del administrador (consumes) y cómo reacciona a lo que pasa en ellos (events).
order: 4.3
---
Tu módulo no lee ni escribe tablas de otros módulos directamente. Para eso hay dos mecanismos controlados por Runly:

- **Servicios**: llamas funciones de otro módulo (agendar un evento, guardar un archivo, notificar, actualizar un contacto o una tarea).
- **Eventos**: Runly te avisa cuando algo pasa en otro módulo (se creó un contacto, cambió un artículo).

## Servicios

Declara en `module.manifest.js` lo que tu módulo necesita:

```js
consumes: {
  'runly.inventory': ['items.read', 'items.search'],
  'runly.contacts': ['contacts.create'],
},
```

Un administrador lo autoriza: al instalar desde el catálogo (diálogo de consentimiento) o en **Módulos > detalle del módulo**. Sin esa autorización la llamada falla con 403.

Úsalo desde tus rutas en `api/`:

```js
export default function createRouter({ requirePermission, moduleContext }) {
  const app = new Hono()
  app.get('/mimodulo/buscar-equipo', requirePermission('mimodulo.registro.read'), async (c) => {
    const inventory = moduleContext.services.forRequest(c).module('runly.inventory')
    const { items } = await inventory.items.search({ search: c.req.query('q') ?? '' })
    return c.json({ data: items })
  })
  return app
}
```

Cada llamada se ejecuta en la **empresa activa** de la petición y exige que el **usuario** tenga el permiso del servicio; las que escriben quedan en la bitácora. Tu módulo **nunca** toca tablas ni estructura de otros módulos: crea y actualiza registros a través del código del módulo dueño, con sus mismas validaciones.

### Argumentos

Runly revisa los argumentos de cada llamada contra el contrato publicado del servicio **antes** de ejecutarlo:

- Los campos que el servicio no declara se descartan (no puedes enviar `companyId`, `enabled`, estados internos, etc.).
- En los servicios de actualización solo cambian los campos que envías; `null` vacía un campo opcional.
- Fechas con hora (`datetime`) en ISO 8601; fechas solas (`date`) como `AAAA-MM-DD`.
- Si algo no es válido la llamada falla con **422** `invalid_args` y `error.fields` (`{ campo: mensaje }`).

```js
try {
  await calendar.events.create({ title: '', startAt: 'mañana' })
} catch (error) {
  // error.status 422, error.code 'invalid_args', error.fields.title, error.fields.startAt
}
```

### Origen y alcance

Lo que tu módulo crea queda marcado con su origen: `sourceEntityId` es el id de **tu** registro (por ejemplo, la orden de servicio que agendó la visita).

| Destino | Dónde queda el origen |
|---|---|
| Calendario | El evento guarda tu módulo y `sourceEntityId`. |
| Archivos | El archivo guarda `metadata.source = { moduleKey, sourceEntityId }`. |
| Notificaciones | `sourceType` es tu módulo y `sourceId` es `sourceEntityId`. |
| Contactos, Inventario, Proyectos | La bitácora del servicio registra tu módulo. |

Los servicios marcados como **propios** solo actúan sobre lo que tu módulo creó: un evento o archivo ajeno responde **404**, como si no existiera.

### Catálogo

| Servicio | Qué hace | Permiso del usuario |
|---|---|---|
| `runly.inventory` `items.read({ id })` | Un artículo: `id, name, assetTag, status` | `inventory.item.read` |
| `runly.inventory` `items.search({ search, limit })` | `{ items, total }` | `inventory.item.read` |
| `runly.inventory` `items.update({ id, name, description, status, locationId, notes })` | Actualiza el artículo; `status` solo `available` o `maintenance` | `inventory.item.update` |
| `runly.contacts` `contacts.read({ id })` | Un contacto: `id, name, type, email, phone` | `contacts.contacts.read` |
| `runly.contacts` `contacts.search({ search, limit })` | `{ items, total }` | `contacts.contacts.read` |
| `runly.contacts` `contacts.create({ name, type, email, phone })` | Crea y devuelve el contacto | `contacts.contacts.create` |
| `runly.contacts` `contacts.update({ id, name, type, email, phone })` | Actualiza y devuelve el contacto | `contacts.contacts.update` |
| `runly.projects` `tasks.read({ id })` | Una tarea | `projects.task.read` |
| `runly.projects` `tasks.create({ projectId, title, description, dueDate, assigneeId })` | Crea la tarea en el primer estado del proyecto | `projects.task.create` |
| `runly.projects` `tasks.update({ id, title, description, statusId, assigneeId, dueDate, priority })` | Actualiza la tarea (mover de estado con `statusId`); `priority`: `NONE, LOW, MEDIUM, HIGH, URGENT` | `projects.task.update` |
| `runly.calendar` `calendars.list()` | Calendarios donde el usuario puede crear eventos: `id, name, isDefault` | `calendar.events.read` |
| `runly.calendar` `events.list({ from, to, sourceEntityId })` | Eventos **propios** en el rango (las repeticiones se expanden) | `calendar.events.read` |
| `runly.calendar` `events.create({ calendarId, title, description, startAt, endAt, allDay, location, attendeeIds, reminderMinutes, sourceEntityId })` | Crea el evento; sin `calendarId` va al calendario principal del usuario. Invitados solo de la empresa | `calendar.events.create` |
| `runly.calendar` `events.update({ id, title, description, startAt, endAt, allDay, location })` | Actualiza un evento **propio** | `calendar.events.update` |
| `runly.calendar` `events.cancel({ id })` | Cancela un evento **propio** (el usuario debe ser dueño o administrador del calendario) | `calendar.events.update` |
| `runly.files` `files.save({ name, mimeType, contentBase64, shareWithCompany, sourceEntityId })` | Guarda el archivo en **Archivos** del usuario (privado salvo `shareWithCompany: true`). Máximo 10 MB; imagen, PDF, texto u oficina | `files.assets.create` |
| `runly.files` `files.signedUrl({ id })` | Enlace temporal de descarga de un archivo **propio** | `files.assets.read` |
| `runly.notifications` `notifications.send({ userIds, title, body, link, priority, sourceEntityId })` | Notifica a usuarios de la empresa (los demás se ignoran); `priority`: `low, medium, high, critical` | Ninguno: basta ser miembro de la empresa |

Para adjuntar archivos a **tus propios** registros usa los adjuntos del registro (`GET /<base>/:id/files`, ver [API del módulo](/documentacion/desarrolladores/api-modulos), y el componente `AttachmentsPanel`); `files.save` es para dejar un documento en el explorador de Archivos del usuario.

```js
app.post('/mimodulo/ordenes/:id/agendar', requirePermission('mimodulo.orden.update'), async (c) => {
  const services = moduleContext.services.forRequest(c)
  const calendar = services.module('runly.calendar')
  const event = await calendar.events.create({
    title: 'Visita de servicio',
    startAt: '2026-10-06T16:00:00.000Z',
    endAt: '2026-10-06T17:00:00.000Z',
    reminderMinutes: [30],
    sourceEntityId: c.req.param('id'),
  })
  await services.module('runly.notifications').notifications.send({
    userIds: [tecnicoId], title: 'Nueva visita asignada', link: '/calendar', sourceEntityId: c.req.param('id'),
  })
  return c.json({ data: event })
})
```

```js
// module.manifest.js
consumes: {
  'runly.calendar': ['events.create', 'events.update', 'events.cancel'],
  'runly.notifications': ['notifications.send'],
},
```

El contrato completo (argumentos, tipos, límites y campos de respuesta) se publica en `@runly/module-engine/contracts` como `SERVICE_CONTRACTS`; el Developer Hub simula los servicios con ese mismo contrato.

## Eventos

Suscríbete en el manifiesto y maneja los eventos en `api/events.js`:

```js
// module.manifest.js
events: { subscribes: ['contacts.contact.created'] },
```

```js
// api/events.js
export const handlers = {
  'contacts.contact.created': async ({ payload, companyId, prisma }) => {
    await prisma.$executeRaw`INSERT INTO "mimodulo_bitacora" (company_id, texto) VALUES (${companyId}::uuid, ${'Nuevo contacto ' + payload.id})`
  },
}
```

| Evento | `payload` |
|---|---|
| `inventory.item.created` | `{ id, name, assetTag }` |
| `inventory.item.updated` | `{ id, name }` |
| `contacts.contact.created` | `{ id }` |
| `projects.task.created` | `{ id, projectId, title }` |

- La entrega es **al menos una vez**: tu handler debe poder recibir el mismo evento dos veces sin duplicar datos.
- Si tu handler falla, se reintenta con espera creciente (1, 2, 4… hasta 60 minutos) hasta 8 veces.
- Los eventos llegan unos segundos después del cambio (los entrega el proceso de fondo de Runly).
- Si el módulo está desactivado para una empresa, no recibe sus eventos.
