---
title: Automatizaciones del Constructor
summary: Cómo un módulo hecho con el Constructor crea o actualiza registros en Calendario, Notificaciones, Contactos, Inventario, Proyectos, Libro de cuentas, Flota y más al guardar un registro o cuando pasa algo en otro módulo, sin programar.
order: 4.4
---
Una **automatización** dice: «cuando pase esto, haz aquello en otro módulo». Por ejemplo: al crear una orden de servicio, agendar la visita en el Calendario; al cerrar la orden, avisar a quien la cerró; cuando un vehículo entra a mantenimiento, crear el contacto del taller.

Debajo usa los mismos [servicios entre módulos](/documentacion/desarrolladores/servicios-y-eventos) que un módulo programado a mano: tu módulo nunca toca las tablas de otro módulo; todo pasa por el código del módulo dueño, con sus validaciones y su bitácora.

## Crear una automatización

En el Constructor, pestaña **Automatizaciones** > *Nueva automatización*:

1. **Cuándo**
   - *Cuando se guarda un registro de este módulo*: elige la entidad y el momento (*Al crear*, *Al actualizar* o *Al crear o actualizar*).
   - *Cuando pasa algo en otro módulo*: elige el evento (por ejemplo, «Se actualizó un vehículo de la flota»).
2. **Solo si** (opcional): un campo del registro o un dato del evento y una condición: *Es igual a* un valor, *Tiene valor* o *Cambió* (solo al actualizar).
3. **Qué hacer**: la acción en el otro módulo (crear un evento de calendario, enviar una notificación, crear o actualizar un contacto, registrar un movimiento…).
4. **Datos que se envían**: para cada dato de la acción, de dónde sale su valor.

| Origen | Qué envía |
|---|---|
| Valor fijo | El valor que escribes (texto, número, lista separada por comas, sí/no). |
| Campo del registro / Dato del evento | El valor de ese campo del registro guardado, o ese dato del evento. |
| Texto con campos | Texto con campos entre llaves dobles: `Visita {{folio}} — {{cliente}}`. |
| Id del registro | El id del registro guardado (o el del registro del sistema, en un evento). |
| Usuario que guarda | La persona que guardó el registro (por ejemplo, como destinatario de una notificación). Solo al guardar un registro. |

Los datos marcados *Obligatorio* deben tener origen. Runly agrega solo el origen (`sourceEntityId`, para que el evento o la notificación sepan de qué registro vienen) y la protección contra duplicados.

## Qué pasa al guardar

- La automatización corre **después** de guardar. Si falla (por ejemplo, el usuario no tiene permiso en el Calendario), **el registro se guarda igual** y la respuesta incluye el resultado:

```json
{ "data": { "id": "…", "folio": "OS-7" }, "automations": [{ "key": "agendar_visita", "ok": false, "error": "No tienes permiso para \"Crear eventos de calendario\"." }] }
```

- Corre con los permisos de **la persona que guarda**: si no puede crear eventos en el Calendario, la automatización tampoco.
- Al crear, la misma automatización no se repite para el mismo registro aunque la petición se reintente.

## Automatizaciones por eventos del sistema

Corren en segundo plano unos segundos después del cambio, **sin una persona**. Por eso solo ofrecen las acciones que no necesitan a alguien detrás: notificaciones, contactos, artículos de inventario, actualizar tareas. Si fallan se reintentan (hasta 8 veces, con espera creciente) y nunca crean duplicados por el mismo evento.

| Evento | Datos disponibles |
|---|---|
| Se creó / actualizó un artículo de inventario | `id`, `name` (y `assetTag` al crear) |
| Se creó un contacto | `id` |
| Se creó una tarea de proyecto | `id`, `projectId`, `title` |
| Se creó / actualizó / canceló un evento de calendario | `id`, `title`, `startAt`, `sourceModule`, `sourceEntityId` |
| Se subió un archivo a Archivos | `id`, `name`, `mimeType` |
| Se creó / actualizó un vehículo de la flota | `id`, `plate`, `status` |

## Autorización al publicar

La pestaña muestra qué servicios usará el módulo. Al **publicar**:

- Si puedes administrar módulos (`core.modules.manage`), publicar los autoriza.
- Si no, el diálogo avisa que quedan **pendientes** y un administrador los autoriza en **Módulos > detalle del módulo**. Mientras tanto la automatización responde `service_not_granted`.

Al quitar una automatización y volver a publicar, se retira la autorización del servicio que ya no se usa. Lo que ya creó en otros módulos se conserva.

## En el paquete

El Constructor genera `api/automations.js` (las automatizaciones y su lógica), `api/events.js` (si hay automatizaciones por eventos) y agrega `consumes` y `events.subscribes` al manifiesto. No los edites a mano: se reescriben al publicar. En [modo desarrollador](/documentacion/desarrolladores/flujo-zip) el módulo ya es código: usa los servicios directamente.

Límites: hasta 20 automatizaciones por módulo y una acción por automatización.
