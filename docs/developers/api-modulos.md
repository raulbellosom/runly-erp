---
title: API de los módulos
summary: Endpoints REST que el Constructor genera para cada entidad, con parámetros, formatos de respuesta, errores, permisos y archivos.
order: 3
---
Cada entidad de un módulo tiene una API REST. La ruta base es `/<slug>/<entidad>s`, donde `<slug>` es la última parte de la clave del módulo: para `custom.visitas` y la entidad `visita`, la base es `/visitas/visitas`. La `GUIA_DESARROLLO_RUNLY.md` de tu ZIP trae la tabla exacta de tu módulo.

Todas las llamadas requieren `Authorization: Bearer <token>` y `X-Runly-Company-Id: <empresa>`; en React usa `buildApiHeaders(token, companyId)` de `@runly/ui`. Los datos siempre se filtran por la empresa activa.

## Endpoints por entidad

| Método y ruta | Qué hace | Permiso |
|---|---|---|
| `GET /<base>` | Lista paginada | `<slug>.<entidad>.read` |
| `GET /<base>/:id` | Un registro | `<slug>.<entidad>.read` |
| `POST /<base>` | Crear | `<slug>.<entidad>.create` |
| `PATCH /<base>/:id` | Editar (solo los campos enviados) | `<slug>.<entidad>.update` |
| `PATCH /<base>/:id/enabled` | Activar o desactivar: `{ "enabled": false }` | `<slug>.<entidad>.delete` |

Los registros no se borran: se desactivan (`enabled: false`) y dejan de aparecer en listas.

### Listas

Parámetros: `page` (desde 1), `pageSize` (20 por defecto, máximo 100), `search` (busca en el primer campo de texto), un parámetro por cada campo de selección (`?estado=ABIERTO`) y por cada relación a otra entidad del mismo módulo (`?cliente=<uuid>`). Orden: más recientes primero.

```json
{ "data": [ { "id": "…", "nombre": "…", "cliente": "…", "cliente__label": "Ana López" } ],
  "pagination": { "page": 1, "pageSize": 20, "total": 42 } }
```

### Un registro, crear y editar

Responden `{ "data": { … } }` (crear responde `201`). Cada registro trae `id`, `created_at`, `updated_at`, `enabled` y sus campos (ver *Campos*). Los campos de relación incluyen además:

- `<campo>__label`: el nombre del registro relacionado (entidades del módulo y de otros módulos).
- `<campo>__url`: la ruta de su ficha (solo relaciones con módulos del sistema).

## Errores

Todas las respuestas de error son `{ "error": "mensaje en español" }`.

| Código | Cuándo |
|---|---|
| 400 | Datos inválidos (Zod), un campo requerido visible sin valor, un registro relacionado que no existe, está inactivo o no es visible |
| 403 | Falta el permiso de la entidad |
| 404 | El registro no existe en la empresa activa |
| 409 | Registro duplicado; o no se puede desactivar porque otros lo usan (*No se puede desactivar: 3 Pedidos lo usan.*) |
| 503 | Las tablas del módulo aún no están listas (módulo recién subido sin instalar) |

## Archivos

Solo en entidades con campos de archivo o sección de documentos.

| Método y ruta | Qué hace | Permiso |
|---|---|---|
| `POST /<base>/files` (multipart: `file`, opcional `field` y `entityId`) | Sube un archivo. Con `field`, aplica el tipo y tamaño máximo de ese campo (413 si excede). Responde `{ data: { id, originalName, … } }` | crear o editar |
| `GET /<base>/:id/files` | Documentos adjuntos del registro (sin los archivos de campos) | ver |
| `DELETE /<base>/:id/files/:fileId` | Quita un documento del registro | editar |
| `GET /<base>/files/:fileId/signed-url` | Enlace temporal: `{ data: { signedUrl, expiresIn } }` | ver |

Un campo de archivo guarda el `id` del archivo subido: sube primero con `field=<campo>` y envía ese `id` al crear o editar el registro.

## Relaciones con otros módulos

Para buscar y resolver registros de Flotilla, Inventario, Contactos, etc. desde tus pantallas usa `/relation-targets` (ver *Relaciones*).
