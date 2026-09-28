---
title: Relaciones
summary: Relaciones entre entidades de tu módulo y con módulos del sistema (Flotilla, Inventario, Contactos, RR. HH., Proyectos, Calendario, Cuentas, Archivos), su integridad y cómo usarlas desde código.
order: 4
---
Un campo de tipo **Relación** guarda el `id` (UUID) de otro registro. Puede apuntar a una entidad de tu módulo o a una entidad de un módulo del sistema.

## Relaciones dentro de tu módulo

Se definen con `targetEntity`. Opciones del campo:

- `labelField`: el campo del registro relacionado que se muestra (por defecto, su primer campo de texto). La API lo devuelve como `<campo>__label`.
- `onDisable`: qué pasa al desactivar el registro relacionado:
  - `restrict` (por defecto): no deja desactivarlo mientras otros lo usen (409 con el número de registros).
  - `setNull`: vacía la relación en los registros que lo usaban (no se permite si el campo es requerido).
  - `cascade`: desactiva también esos registros, aplicando a su vez sus propias reglas. No se permiten ciclos.

Todo ocurre en una sola transacción. Al guardar, la API valida que el registro relacionado exista, esté activo y sea de la misma empresa (400 si no).

En el diseño del detalle puedes agregar una sección de **Registros relacionados** que lista los registros que apuntan al actual. La lista usa `GET /<base-hija>?<campo>=<id>`.

## Relaciones con módulos del sistema

Se definen con `targetExternal`. El módulo dueño pasa a ser una **dependencia** de tu módulo (no se puede desinstalar mientras lo uses).

| `targetExternal` | Entidad | Módulo | Permiso de lectura |
|---|---|---|---|
| `contact` | Contacto | runly.contacts | `contacts.contacts.read` |
| `hr_employee` | Colaborador | runly.hr | `hr.employee.read` |
| `vehicle` | Vehículo | runly.fleet | `fleet.vehicles.read` |
| `inventory_item` | Artículo de inventario | runly.inventory | `inventory.item.read` |
| `project` | Proyecto | runly.projects | `projects.project.read` |
| `task` | Tarea | runly.projects | `projects.task.read` |
| `calendar_event` | Evento de calendario | runly.calendar | `calendar.events.read` |
| `ledger_account` | Cuenta | runly.ledger | `ledger.accounts.read` |
| `file` | Archivo | runly.files | `files.assets.read` |

- La búsqueda y la validación usan las reglas del módulo dueño: empresa activa y visibilidad por usuario (miembros de proyectos y tareas, calendarios compartidos, cuentas con acceso, alcance de archivos).
- La API de tu módulo devuelve `<campo>__label` ("Título · detalle", por ejemplo "ABC-123 · Nissan NP300") y `<campo>__url` (la ficha original). Si el usuario no puede verlo o está inactivo: "No disponible (inactivo o sin acceso)".
- Las reglas `onDisable` no aplican: los registros del sistema los administra su propio módulo.

### Usarlas desde tus pantallas React

```js
// Buscar vehículos (selector propio)
const res = await fetch(`${apiBaseUrl}/relation-targets/vehicle/search?search=abc&pageSize=20`, { headers: buildApiHeaders(token, companyId) })
const { data } = await res.json()          // [{ id, title, subtitle }]

// Resolver varios ids a título, detalle y enlace
const resolved = await fetch(`${apiBaseUrl}/relation-targets/vehicle/resolve`, {
  method: 'POST',
  headers: buildApiHeaders(token, companyId, { 'Content-Type': 'application/json' }),
  body: JSON.stringify({ ids: ['<uuid>', '<uuid>'] }),   // máximo 100
}).then((r) => r.json())                   // { data: [{ id, title, subtitle, url }] } solo los visibles
```

Sin el permiso de lectura del tipo, estas rutas responden 403. `GET /relation-targets` (catálogo de tipos y si su módulo está instalado) requiere el permiso del Constructor.
