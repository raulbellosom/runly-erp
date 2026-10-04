---
title: Conexiones con módulos del sistema
summary: Cómo un módulo propio agrega campos o registros a las fichas de Inventario, Contactos, RR. HH. y Proyectos — declaración en el manifiesto, activación por empresa, superficies, borrado e integridad.
order: 4.2
---
Una **conexión** hace que los datos de tu módulo aparezcan **dentro de un módulo del sistema**. Por ejemplo, un módulo *Calibraciones* puede agregar "Certificado", "Laboratorio" y "Fecha de calibración" a la ficha de cada artículo de Inventario: se ven en el detalle, se editan en el formulario del artículo con el mismo botón *Guardar*, salen como columnas en la lista y se pueden buscar.

Es distinto de una [relación](/documentacion/desarrolladores/relaciones): una relación hace que **tu** registro apunte a un registro del sistema y se muestra en **tus** pantallas; una conexión además **muestra y guarda tus datos en las pantallas del módulo del sistema**.

## Destinos disponibles

| `target` | Ficha donde aparecen tus datos | Permiso para administrarlas |
|---|---|---|
| `inventory_item` | Inventario > artículo | `inventory.connections.manage` |
| `contact` | Contactos > contacto | `contacts.connections.manage` |
| `hr_employee` | RR. HH. > colaborador | `hr.connections.manage` |
| `project` | Proyectos > proyecto | `projects.connections.manage` |

Cada uno de estos módulos tiene en su menú la pantalla **Conexiones**. Otros tipos del catálogo de relaciones (`vehicle`, `task`, `calendar_event`, `ledger_account`, `file`) aún no tienen esa pantalla: la API acepta la declaración, pero nadie puede activarla todavía.

## Dos tipos

| `kind` | Qué representa | Dónde se ve en la ficha del sistema |
|---|---|---|
| `fields` | **Campos extra** 1:1: como máximo un registro de tu entidad por cada registro del sistema. | Detalle (cuadrícula de campos), formulario (sección editable que se guarda junto con la ficha), columnas de la lista y búsqueda. |
| `related` | **Registros relacionados** 1:N: muchos registros de tu entidad por cada registro del sistema (préstamos, visitas, mantenimientos…). | Detalle: lista compacta con el total, *Agregar* y *Ver todo*. |

## Declararla en el manifiesto

Por ahora el Constructor no tiene un asistente para conexiones: se declaran en `module.manifest.js` (modo desarrollador o paquete base) y se suben con **Subir actualización**.

1. Tu entidad necesita un campo de tipo **Relación** que guarde el `id` del registro del sistema (`targetField`).
2. Agrega `connections` al manifiesto y declara el módulo dueño en `dependencies`.

```js
// module.manifest.js
export default defineRunlyModule({
  key: 'custom.calibraciones',
  version: '1.0.1',
  dependencies: [{ key: 'runly.core' }, { key: 'runly.inventory' }],
  connections: [
    {
      key: 'calibracion_item',        // estable, a-z 0-9 _ ; no la cambies después
      target: 'inventory_item',
      kind: 'fields',                 // 'fields' | 'related'
      entity: 'calibracion',          // key del modelo de tu módulo
      targetField: 'articulo',        // campo relation de ese modelo con el id del artículo
      label: 'Calibración',           // título de la sección en la ficha
      fields: [                       // campos que OFRECES; los demás nunca se muestran
        { field: 'certificado', form: true, detail: true, column: true, search: true },
        { field: 'laboratorio', form: true, detail: true, search: true },
        { field: 'fecha',       form: true, detail: true, column: true },
        { field: 'vigente',     form: true, detail: true },
      ],
      // onTargetDelete: 'setNull',   // solo para kind 'related' (ver Borrado)
      // required: false,
    },
  ],
  // ...models, views, permissions, navigation
})
```

```js
// models/calibracion.model.js
fields: [
  { name: 'articulo', type: 'relation', label: 'Artículo', required: true },
  { name: 'certificado', type: 'text', label: 'Certificado', required: true },
  // ...
]
```

Reglas que revisa Runly al subir e instalar:

- Máximo **10** conexiones por módulo; `key` única y con formato `^[a-z][a-z0-9_]{1,40}$`.
- `entity` debe ser un modelo del módulo y `targetField` un campo `relation` de ese modelo.
- `fields` ofrece al menos un campo, sin repetir y sin incluir el propio `targetField`.
- Las superficies (`form`, `detail`, `column`, `search`) son booleanas; si no las pones, quedan apagadas.
- `onTargetDelete` solo aplica a `related`; `setNull` exige que `targetField` no sea requerido.

## Activación por empresa

1. Al instalar (o al aplicar una actualización de un módulo ya instalado) Runly registra cada conexión como **pendiente** en cada empresa y crea en la base de datos la llave foránea, el índice 1:1 (`fields`) y el disparador que mantiene el índice de búsqueda.
2. Una persona con el permiso `<módulo>.connections.manage` abre **Conexiones** en el módulo del sistema, revisa los campos y la activa. Al activarla se indexan los registros que ya existían.
3. En esa misma pantalla puede **apagar** cada campo por superficie (formulario, detalle, columna, búsqueda) o desactivar la conexión (el orden de las secciones, `sortOrder`, por ahora solo se cambia por API). Solo puede reducir lo que tu módulo ofrece, nunca agregar campos que no ofreciste.

Si después de actualizar Runly no ves el menú *Conexiones*, usa **Sincronizar módulos** una vez.

## Qué pasa al guardar

- El formulario del módulo del sistema envía tus secciones junto con la ficha y **todo se guarda en una sola transacción**: si tu sección no es válida, no se guarda nada.
- Los valores se validan con los **validadores Zod de tu módulo** (`validators/`) y con los permisos de tu entidad: quien no puede leerla no ve la sección; quien no puede editarla no la envía.
- Concurrencia: si otra persona cambió tus datos mientras tanto, la API responde `409 connection_conflict` y la sección ofrece *Recargar*.
- El cambio queda en el historial de tu entidad como cualquier otra edición.

## Borrado e integridad

La consistencia la garantiza la base de datos (llaves foráneas y disparadores), no el código de tus pantallas.

| Caso | `fields` | `related` |
|---|---|---|
| El registro del sistema se **desactiva** | Tus datos se conservan y vuelven si se reactiva. | Igual. |
| El registro del sistema se **elimina** | Tu registro se elimina (siempre `cascade`). | Según `onTargetDelete`: `cascade` elimina tus registros, `setNull` (por defecto) vacía el campo, `restrict` impide eliminar y responde `409 connection_restrict` ("No se puede eliminar: tiene 3 en Préstamos"). |
| Desactivas tu registro | La sección queda vacía; un nuevo guardado la vuelve a llenar. | Deja de contarse. |
| Tu módulo se **deshabilita** | Las secciones dejan de mostrarse y de guardarse; los datos quedan. | Igual. |
| Tu módulo se **desinstala conservando datos** | La conexión pasa a desactivada; al reinstalar se reactiva y se reindexa. | Igual. |
| **Restablecer** o **purgar** tu módulo | Se borran tus registros y su índice en la misma transacción. | Igual. |

## Desde código

Normalmente no necesitas llamar estas rutas: las pantallas del sistema ya las usan. Sirven para diagnóstico o para pantallas propias.

| Método y ruta | Uso | Permiso |
|---|---|---|
| `GET /connections?targetType=inventory_item` | Conexiones de la empresa para ese destino, con su configuración. | `<módulo>.connections.manage` |
| `PATCH /connections/:id` | `{ status?: 'active' \| 'disabled', fieldConfig?, sortOrder? }` | `<módulo>.connections.manage` |
| `GET /connections/records?targetType=&targetId=&surface=detail\|form` | Secciones y valores de un registro del sistema. | Lectura del destino (y de tu entidad por sección) |
| `POST /connections/records/batch` | `{ targetType, targetIds }` → columnas conectadas (máximo 200 ids). | Lectura del destino |
| `POST /connections/rebuild` | `{ moduleKey? }` reconstruye el índice desde tus tablas. | `core.modules.manage` |

Al guardar una ficha del sistema, el cuerpo lleva `connections: { [connectionId]: { values, expectedUpdatedAt } }`. Errores: `422 connection_validation` (con `fields: { '<connectionId>.<campo>': mensaje }`), `409 connection_conflict` y `409 connection_restrict`.

## Pedírsela a una IA

```
En este módulo (lee AGENTS.md, GUIA_DESARROLLO_RUNLY.md y docs/conexiones.md):
agrega una conexión de tipo fields a inventory_item para que "Certificado"
y "Fecha de calibración" se vean y editen en la ficha del artículo, con
el certificado buscable. Usa el campo relation "articulo" como targetField
(créalo si no existe), agrega runly.inventory a dependencies y sube la versión.
```

Después de subirlo: instala o aplica la actualización, ve a **Inventario > Conexiones** y activa la conexión.
