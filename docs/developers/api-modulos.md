---
title: API de los módulos
summary: Endpoints REST que el Constructor genera para cada entidad, con parámetros, ejemplos de petición y respuesta por tipo de campo, errores, permisos y archivos.
order: 3
---
Cada entidad de un módulo tiene una API REST. La ruta base es `/<slug>/<entidad>s`, donde `<slug>` es la última parte de la clave del módulo: para `custom.visitas` y la entidad `visita`, la base es `/visitas/visitas`. La `GUIA_DESARROLLO_RUNLY.md` de tu ZIP trae la tabla exacta de tu módulo.

## Autenticación y empresa

Todas las llamadas requieren dos encabezados:

| Encabezado | Valor |
|---|---|
| `Authorization` | `Bearer <token>` de la sesión del usuario |
| `X-Runly-Company-Id` | `id` de la empresa activa |

En React usa `buildApiHeaders(token, companyId)` de `@runly/ui`, que arma los dos. Los datos siempre se filtran por la empresa activa: nunca verás ni modificarás registros de otra empresa.

Si el usuario pertenece a una sola empresa, el encabezado de empresa es opcional; con varias es obligatorio (sin él la API responde `400` con `{ "error": "company_required" }`). Envíalo siempre.

## Endpoints por entidad

| Método y ruta | Qué hace | Permiso |
|---|---|---|
| `GET /<base>` | Lista paginada | `<slug>.<entidad>.read` |
| `GET /<base>/:id` | Un registro | `<slug>.<entidad>.read` |
| `POST /<base>` | Crear | `<slug>.<entidad>.create` |
| `PATCH /<base>/:id` | Editar (solo los campos enviados) | `<slug>.<entidad>.update` |
| `PATCH /<base>/:id/enabled` | Desactivar: `{ "enabled": false }` | `<slug>.<entidad>.delete` |

Los registros no se borran: se desactivan (`enabled: false`). Un registro desactivado deja de aparecer en las listas y `GET /<base>/:id` responde `404` para él. Hoy la API no permite consultar ni reactivar registros desactivados.

## Ejemplo usado en esta página

Módulo `custom.visitas`, entidad `visita`, base `/visitas/visitas`:

| Campo | Tipo | Requerido |
|---|---|---|
| `nombre` | `text` | Sí |
| `estado` | `select` con valores `PROGRAMADA`, `REALIZADA`, `CANCELADA` | Sí |
| `fecha` | `date` | |
| `hora_llegada` | `datetime` | |
| `personas` | `number` | |
| `monto` | `decimal` | |
| `pagada` | `boolean` | |
| `etiquetas` | `multiselect` | |
| `cliente` | `relation` con Contactos | |
| `sucursal` | `relation` con la entidad `sucursal` del mismo módulo | |
| `foto` | `file` (imagen) | |
| `extra` | `json` | |

## Listar

```http
GET /visitas/visitas?page=1&pageSize=20&search=ana&estado=PROGRAMADA&sucursal=0192f0c4-…
```

| Parámetro | Qué hace |
|---|---|
| `page` | Página, desde 1 (por defecto 1) |
| `pageSize` | Registros por página, de 1 a 100 (por defecto 20) |
| `search` | Busca texto parcial, sin distinguir mayúsculas, en el **primer** campo `text`, `email` o `phone` de la entidad. Si la entidad no tiene ninguno, se ignora |
| `<campo select>` | Valor exacto de la opción: `?estado=PROGRAMADA` |
| `<campo relation del mismo módulo>` | `id` del registro relacionado: `?sucursal=<uuid>`. Un valor que no es UUID se ignora |

Otros parámetros se ignoran. No se puede filtrar por `multiselect`, fechas, números ni relaciones con módulos del sistema, y el orden es fijo: más recientes primero (`created_at` descendente). Si necesitas otro filtro u orden, pide páginas de hasta 100 y filtra en tu pantalla.

Respuesta `200`:

```json
{
  "data": [
    {
      "id": "0192f0c4-7b1e-7c2a-9d3e-5f6a7b8c9d0e",
      "company_id": "0192a1b2-…",
      "enabled": true,
      "created_at": "2026-09-29T15:30:00.000Z",
      "updated_at": "2026-09-29T15:30:00.000Z",
      "nombre": "Visita a Ana",
      "estado": "PROGRAMADA",
      "fecha": "2026-10-02T00:00:00.000Z",
      "hora_llegada": "2026-10-02T16:00:00.000Z",
      "personas": 3,
      "monto": "1250.5",
      "pagada": false,
      "etiquetas": ["VIP", "NUEVO"],
      "cliente": "0192c3d4-…",
      "cliente__label": "Ana López",
      "cliente__url": "/app/m/runly.contacts/contacts/0192c3d4-…",
      "sucursal": "0192e5f6-…",
      "sucursal__label": "Centro",
      "foto": "0192f7a8-…",
      "extra": { "origen": "web" }
    }
  ],
  "pagination": { "page": 1, "pageSize": 20, "total": 42 }
}
```

`total` es el número de registros que cumplen los filtros; el número de páginas es `Math.ceil(total / pageSize)`.

## Obtener un registro

```http
GET /visitas/visitas/0192f0c4-7b1e-7c2a-9d3e-5f6a7b8c9d0e
```

Responde `200` con `{ "data": { … } }`, con la misma forma que cada elemento de la lista. Un `id` que no existe, es de otra empresa, está desactivado o no es un UUID responde `404` (`{ "error": "Visita no encontrado." }`).

## Crear

```http
POST /visitas/visitas
Content-Type: application/json
```

```json
{
  "nombre": "Visita a Ana",
  "estado": "PROGRAMADA",
  "fecha": "2026-10-02",
  "hora_llegada": "2026-10-02T10:00:00-06:00",
  "personas": 3,
  "monto": 1250.5,
  "pagada": false,
  "etiquetas": ["VIP", "NUEVO"],
  "cliente": "0192c3d4-…",
  "sucursal": "0192e5f6-…",
  "foto": "0192f7a8-…",
  "extra": { "origen": "web" }
}
```

Responde `201` con `{ "data": { … } }`, el registro creado. `id`, `company_id`, `enabled`, `created_at` y `updated_at` los pone Runly: no los envíes. Los campos que no pertenecen a la entidad se descartan sin error.

## Editar

```http
PATCH /visitas/visitas/0192f0c4-7b1e-7c2a-9d3e-5f6a7b8c9d0e
Content-Type: application/json

{ "estado": "REALIZADA", "pagada": true }
```

Solo cambian los campos enviados; los demás conservan su valor. Responde `200` con el registro completo actualizado. Un cuerpo sin ningún campo de la entidad responde `400` (`No hay campos validos para actualizar.`).

Al editar no se vuelve a exigir *requerido*: valida tú en la pantalla que no envíes vacío un campo obligatorio.

## Desactivar

```http
PATCH /visitas/visitas/0192f0c4-7b1e-7c2a-9d3e-5f6a7b8c9d0e/enabled
Content-Type: application/json

{ "enabled": false }
```

Responde `200` con el registro. Si otras entidades del módulo apuntan a este registro, se aplica la regla de cada relación (ver *Relaciones*): con **Bloquear** responde `409` (`No se puede desactivar: 3 Pedidos lo usan.`), con **Vaciar** o **En cascada** se desactiva y ajusta los registros que lo usan.

## Historial de cambios

Cada alta, edición, desactivación y reactivación queda registrada automáticamente: la API guarda quién lo hizo, cuándo y, en las ediciones, qué campos cambiaron (valor anterior y nuevo). No tienes que escribir nada para que funcione.

```http
GET /activity/entity/visitas.visita/0192f0c4-7b1e-7c2a-9d3e-5f6a7b8c9d0e?limit=25
```

El tipo de entidad es `<módulo>.<entidad>` (aquí `visitas.visita`). Responde `{ data, nextCursor }`: cada entrada trae `summary`, `createdAt`, `category` (`created`, `updated`, `status`...), `actor` (con `avatarUrl`) y, en ediciones, `payload.changes` (`[{ field, oldValue, newValue }]`). Para la página siguiente pasa `before=<nextCursor>`; filtra con `category=updated` o `actorId=<id>`. Requiere el permiso `activity.read`.

La ficha de detalle generada ya incluye la sección *Historial de cambios*. En una pantalla propia usa el componente `AuditTrail` (ver *Componentes*).

## Valores por tipo de campo

Lo que envías al crear o editar y lo que la API devuelve no siempre tiene la misma forma:

| Tipo | Envías | Recibes | Para vaciarlo al editar |
|---|---|---|---|
| `text`, `textarea`, `markdown`, `richtext`, `phone`, `color` | texto | texto | `""` |
| `email` | texto con formato de correo | texto | no se puede vaciar con `""` (no es un correo válido) |
| `number` | número entero (`3`); `"3"` o `3.5` dan `400` | número | no se puede |
| `decimal` | número (`1250.5`); un texto da `400` | **texto** (`"1250.5"`): conviértelo con `Number(valor)` | no se puede |
| `boolean` | `true` / `false` | `true` / `false` (si no lo envías al crear, se guarda `false`) | `false` |
| `select` | el **valor** de una opción (`"PROGRAMADA"`); otro valor da `400` | el valor | `null` (solo si no es requerido) |
| `multiselect` | arreglo de textos (`["VIP"]`); no se validan contra las opciones | arreglo | `[]` |
| `date` | `"AAAA-MM-DD"`; otro formato da `400` | **fecha y hora ISO a medianoche UTC** (`"2026-10-02T00:00:00.000Z"`): usa los primeros 10 caracteres, `valor.slice(0, 10)` | no se puede |
| `datetime` | fecha ISO 8601 con zona (`"2026-10-02T10:00:00-06:00"`) | ISO en UTC (`"2026-10-02T16:00:00.000Z"`) | no se puede |
| `relation` | `id` (UUID) del registro relacionado | el `id` más `<campo>__label` (y `<campo>__url` si es de un módulo del sistema) | `null` |
| `file` | `id` (UUID) de un archivo ya subido (ver *Archivos*) | el `id` del archivo | `null` |
| `json` | objeto (`{ "clave": valor }`); arreglos o textos dan `400` | objeto | no se puede |

Notas:

- **Requerido al crear**: los campos de texto, fecha, relación, archivo y `multiselect` requeridos no aceptan vacío (`""` o `[]`). En `select`, `boolean`, `number` y `decimal`, requerido significa que la clave debe venir en el cuerpo.
- **Condiciones de visibilidad**: un campo requerido dentro de una pestaña, sección o campo con condición solo se exige mientras la condición se cumple (`400`: `El campo Motivo es requerido.`).
- **Relaciones**: al crear o editar, Runly comprueba que el registro relacionado exista, esté activo, sea de la misma empresa y (en módulos del sistema) que el usuario pueda verlo. Si no, responde `400` (`El registro seleccionado en "Cliente" no existe, está inactivo o no tienes acceso.`).
- **Fechas en pantalla**: para mostrar un `date` usa `valor.slice(0, 10)`; `new Date(valor)` lo interpreta en UTC y en México puede mostrar el día anterior.

## Errores

Las respuestas de error son JSON con `error`:

```json
{ "error": "Datos invalidos en fecha: Debe ser una fecha ISO valida (YYYY-MM-DD)." }
```

| Código | Cuándo | Ejemplo de `error` |
|---|---|---|
| 400 | El cuerpo no pasa la validación. El mensaje dice el primer campo inválido; el texto después de los dos puntos viene del validador y puede estar en inglés | `Datos invalidos en monto: Invalid input: expected number, received string` |
| 400 | Campo requerido visible sin valor | `El campo Motivo es requerido.` |
| 400 | Relación con un registro inexistente, inactivo o no visible | `El registro seleccionado en "Cliente" no existe o está inactivo.` |
| 400 | `PATCH` sin ningún campo de la entidad | `No hay campos validos para actualizar.` |
| 400 | Usuario con varias empresas y sin `X-Runly-Company-Id` | `company_required` (con `message: "Selecciona una empresa activa."`) |
| 401 | Sin token, o token inválido o expirado | `No autorizado. Token invalido o expirado.` |
| 403 | Falta el permiso de la entidad | mensaje con el permiso requerido |
| 403 | El usuario no pertenece a la empresa enviada | `company_not_member` |
| 404 | El registro no existe en la empresa activa, está desactivado o el `id` no es UUID | `Visita no encontrado.` |
| 409 | Valor duplicado en un campo único | `Ya existe un registro con esos datos.` |
| 409 | No se puede desactivar porque otros registros lo usan | `No se puede desactivar: 3 Pedidos lo usan.` |
| 413 | Archivo mayor al máximo del campo | `El archivo supera el limite de 5 MB.` |
| 500 | Error inesperado | `No se pudo crear el registro.` |
| 503 | Las tablas del módulo aún no existen (módulo subido sin instalar) | `Las tablas del modulo no estan disponibles aun.` |

Muestra `error` al usuario (por ejemplo con `toast.error`) y no dependas del texto exacto: usa el código HTTP para decidir.

## Archivos

Solo en entidades con campos de archivo o sección de documentos.

| Método y ruta | Qué hace | Permiso |
|---|---|---|
| `POST /<base>/files` (multipart: `file`, opcional `field` y `entityId`) | Sube un archivo. Con `field`, aplica el tipo y el tamaño máximo de ese campo. Responde `{ data: { id, originalName, … } }` | crear o editar |
| `GET /<base>/:id/files` | Documentos adjuntos del registro (sin los archivos de campos) | ver |
| `DELETE /<base>/:id/files/:fileId` | Quita un documento del registro | editar |
| `GET /<base>/files/:fileId/signed-url` | Enlace temporal: `{ data: { signedUrl, expiresIn } }` | ver |

Un campo de archivo guarda el `id` del archivo subido. Primero súbelo con `field=<campo>` y después envía ese `id` al crear o editar el registro:

```js
const form = new FormData()
form.append('file', archivo)
form.append('field', 'foto')
const subida = await fetch(`${apiBaseUrl}/visitas/visitas/files`, {
  method: 'POST',
  headers: buildApiHeaders(token, companyId), // sin Content-Type: el navegador lo pone con el boundary
  body: form,
})
const { data: archivoSubido } = await subida.json()

await fetch(`${apiBaseUrl}/visitas/visitas/${id}`, {
  method: 'PATCH',
  headers: buildApiHeaders(token, companyId, { 'Content-Type': 'application/json' }),
  body: JSON.stringify({ foto: archivoSubido.id }),
})
```

Para mostrar un archivo pide su enlace temporal con `GET /<base>/files/:fileId/signed-url` y usa `signedUrl`; caduca a los `expiresIn` segundos.

Errores de subida: `400` sin archivo (`Selecciona un archivo valido.`), con `field` desconocido o con un archivo que no es imagen en un campo de imagen (`Selecciona una imagen.`); `413` si excede el tamaño; `501` si la instancia no tiene almacenamiento de archivos configurado.

## Ejemplo completo en React

```jsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { buildApiHeaders } from '@runly/ui'
import { toast } from 'sonner'

async function api(apiBaseUrl, token, companyId, path, options = {}) {
  const res = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: buildApiHeaders(token, companyId, options.body ? { 'Content-Type': 'application/json' } : {}),
  })
  const payload = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(payload?.message ?? payload?.error ?? 'Error inesperado.')
  return payload
}

export function useVisitasProgramadas({ token, companyId, apiBaseUrl }) {
  return useQuery({
    queryKey: ['custom.visitas', 'visitas', 'PROGRAMADA'],
    queryFn: () => api(apiBaseUrl, token, companyId, '/visitas/visitas?estado=PROGRAMADA&pageSize=100'),
    enabled: Boolean(token),
  })
}

export function useMarcarRealizada({ token, companyId, apiBaseUrl }) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id) => api(apiBaseUrl, token, companyId, `/visitas/visitas/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ estado: 'REALIZADA' }),
    }),
    onSuccess: () => {
      toast.success('Visita actualizada')
      queryClient.invalidateQueries({ queryKey: ['custom.visitas'] })
    },
    onError: (error) => toast.error(error.message),
  })
}
```

## Relaciones con otros módulos

Para buscar y resolver registros de Flotilla, Inventario, Contactos, etc. desde tus pantallas usa `/relation-targets` (ver *Relaciones*).
