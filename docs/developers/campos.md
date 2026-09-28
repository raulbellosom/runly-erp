---
title: Campos
summary: Tipos de campo de los módulos de Runly, su columna en la base de datos, su valor en la API y sus opciones.
order: 5
---
| Tipo | Columna | Valor en la API (JSON) | Notas |
|---|---|---|---|
| `text` | `VARCHAR(255)` | texto | El primer campo de texto es el que busca `?search=` |
| `textarea` | `TEXT` | texto | |
| `number` | `INTEGER` | número entero | |
| `decimal` | `NUMERIC(18,4)` | número | Se muestra como importe |
| `boolean` | `BOOLEAN` | `true` / `false` | |
| `select` | `VARCHAR(64)` | el **valor** de la opción | Cada opción tiene etiqueta visible y valor guardado; filtrable con `?campo=VALOR` |
| `multiselect` | `TEXT[]` | arreglo de valores | |
| `date` | `DATE` | `"AAAA-MM-DD"` | |
| `datetime` | `TIMESTAMPTZ` | fecha ISO 8601 | |
| `email` | `VARCHAR(255)` | texto (correo válido) | |
| `phone` | `VARCHAR(64)` | texto | |
| `relation` | `UUID` | `id` del registro relacionado | Más `<campo>__label` (y `<campo>__url` si es de otro módulo). Ver *Relaciones* |
| `file` | `UUID` | `id` del archivo | Opciones `accept` (`image`, `document`, `any`), `camera` (solo imágenes) y `maxSizeMB` (1 a 10). Ver *API de los módulos > Archivos* |
| `json` | `JSONB` | objeto | |
| `markdown` / `richtext` | `TEXT` | texto | |
| `color` | `VARCHAR(32)` | `"#RRGGBB"` | |

Todos los registros tienen además `id` (UUID v7), `company_id`, `enabled`, `created_at` y `updated_at`.

## Requerido y condiciones

- `required`: la API responde 400 si falta el valor al crear.
- Si el campo está dentro de una pestaña, sección o campo con **condición de visibilidad** (por ejemplo "mostrar si Tipo = Empresa"), solo se exige mientras la condición se cumple; la API aplica la misma regla. Las condiciones solo pueden depender de campos `select` o `boolean`.

## Cambios en campos publicados

Agregar campos es seguro. Quitar un campo con datos, cambiar su tipo o agregar un campo obligatorio a una tabla con registros son cambios destructivos: la publicación o la subida los bloquea para proteger los datos.
