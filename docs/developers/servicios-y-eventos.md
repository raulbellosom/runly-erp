---
title: Servicios y eventos entre módulos
summary: Cómo tu módulo usa datos de Inventario, Contactos y Proyectos con autorización del administrador (consumes) y cómo reacciona a lo que pasa en ellos (events).
order: 4.3
---
Tu módulo no lee ni escribe tablas de otros módulos directamente. Para eso hay dos mecanismos controlados por Runly:

- **Servicios**: llamas funciones de otro módulo (buscar artículos, crear un contacto, crear una tarea).
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

Cada llamada se ejecuta en la **empresa activa** de la petición y exige que el **usuario** tenga el permiso del servicio; las que escriben quedan en la bitácora.

| Servicio | Qué hace | Permiso del usuario |
|---|---|---|
| `runly.inventory` `items.read({ id })` | Un artículo: `id, name, assetTag, status` | `inventory.item.read` |
| `runly.inventory` `items.search({ search, limit })` | `{ items, total }` | `inventory.item.read` |
| `runly.contacts` `contacts.read({ id })` | Un contacto: `id, name, type, email, phone` | `contacts.contacts.read` |
| `runly.contacts` `contacts.search({ search, limit })` | `{ items, total }` | `contacts.contacts.read` |
| `runly.contacts` `contacts.create({ name, type, email, phone })` | Crea y devuelve el contacto | `contacts.contacts.create` |
| `runly.projects` `tasks.read({ id })` | Una tarea | `projects.task.read` |
| `runly.projects` `tasks.create({ projectId, title, description, dueDate, assigneeId })` | Crea la tarea en el primer estado del proyecto | `projects.task.create` |

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
