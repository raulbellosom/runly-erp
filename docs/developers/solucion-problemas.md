---
title: Solución de problemas
summary: Errores frecuentes al subir, instalar y usar un módulo con código, con su causa y cómo resolverlos.
order: 8
---
## Al revisar o subir el ZIP

| Mensaje o síntoma | Causa | Qué hacer |
|---|---|---|
| *El archivo debe ser un ZIP* | Se eligió otro tipo de archivo. | Comprime la carpeta del módulo en `.zip`. |
| *Paquete no válido* / no encuentra el manifiesto | `module.manifest.js` no está en la raíz del ZIP ni en una sola carpeta. | Comprime el **contenido** de la carpeta del módulo. |
| `MANIFEST_KEY_MISMATCH` (la clave no coincide) | Se cambió `key` en el manifiesto o se subió el ZIP en otro módulo. | Restaura la clave original. |
| Bloqueo por cambio de tablas | Quitaste una columna, cambiaste un tipo o agregaste un campo obligatorio en una tabla con registros. | Solo cambios aditivos; un campo obligatorio nuevo, agrégalo primero como opcional. |
| *Los componentes no compilan* | Error de sintaxis o un import que no existe. | La revisión muestra archivo, línea y el error de esbuild. Revisa *Librerías disponibles*. |
| *La versión no aumentó* | `version` igual a la instalada. | Aumenta la versión (se puede aplicar igual). |
| *La estructura instalada fue modificada fuera de Runly* | Alguien editó las tablas directamente en la base. | Pide a un administrador que revise la tabla antes de actualizar. |

## En la vista previa

| Síntoma | Causa | Qué hacer |
|---|---|---|
| *No se pudo cargar* y un **404** a `/<slug>/...` | El módulo aún no está instalado: su API no existe. | Sube e instala; luego ábrelo desde el catálogo. |
| Los datos no reflejan cambios en `api/` | La vista previa usa la API instalada. | Aplica la actualización y prueba en la pantalla real. |
| Pantalla en blanco | El componente lanzó un error. | Abre la consola del navegador (F12) para ver el error. |

## Después de subir o instalar

| Síntoma | Causa | Qué hacer |
|---|---|---|
| El módulo no aparece en el Catálogo | Solo se revisó; no se dio clic en **Subir módulo**. | Repite la subida y espera el aviso *Módulo … actualizado*. |
| Aparece en el Catálogo pero no en el menú | No está instalado, o falta su entrada en `navigation`. | Dale **Instalar**; revisa `navigation` en el manifiesto. |
| **Publicar** está deshabilitado en el Constructor | El proyecto está en modo desarrollador. | Actualiza subiendo ZIPs, o usa **Volver al modo visual** (ver *Flujo con ZIP*). |
| **403** en la pantalla | El usuario no tiene el permiso `<slug>.<entidad>.read`. | Asígnalo en Identidad > Roles. |
| **503** *las tablas del módulo aún no están listas* | Módulo subido sin instalar, o instalación a medias. | Instala o reinstala el módulo desde el catálogo. |
| *company_required* | `fetch` sin `X-Runly-Company-Id`. | Usa `buildApiHeaders(token, companyId)`. |
| *Componente no registrado* | `schema.component` no coincide con `registry.register`, o falta el import en `components/index.js`. | Iguala las claves (`<clave del módulo>:<Componente>`). |
| *Cannot read properties of null (reading 'useState')* | `import React from 'react'` o `React.useState`. | Imports nombrados de `react`. |
| 409 *No se puede desactivar: N … lo usan* | Una relación con integridad *restringir* protege el registro. | Desactiva o reasigna primero los registros que lo usan. |

## Conexiones

| Mensaje o síntoma | Causa | Qué hacer |
|---|---|---|
| *connections[0].targetField is required* / *must be a relation field* | Falta `targetField` o no es un campo `relation` de `entity`. | Agrega el campo relation al modelo y ponlo en `targetField`. |
| *unknown target "…"* | `target` no es un tipo del catálogo. | Usa `inventory_item`, `contact`, `hr_employee` o `project`. |
| *onTargetDelete "setNull" needs an optional targetField* | `setNull` con el campo requerido. | Haz el campo opcional o usa `cascade`/`restrict`. |
| La sección no aparece en la ficha | La conexión sigue **pendiente**, el campo no está ofrecido para esa superficie, o el usuario no puede leer tu entidad. | Actívala en *Conexiones* del módulo del sistema; revisa `fields` y los permisos `<slug>.<entidad>.read`. |
| No aparece el menú *Conexiones* | Runly se actualizó y los permisos nuevos no se han sincronizado. | **Sincronizar módulos** una vez. |
| *La conexión … tiene N registro(s) que apuntan a … inexistentes* | Al actualizar, registros tuyos apuntan a ids que ya no existen. | Corrígelos o vacía ese campo y vuelve a subir. |
| 422 *Revisa los datos de las secciones conectadas* | Un valor no pasa los validadores de tu módulo. | El mensaje de cada campo aparece en la sección. |
| 409 *Otra persona modificó …* | Edición concurrente de la misma sección. | *Recargar* y repetir el cambio. |
| 409 *No se puede eliminar: tiene registros relacionados* | Conexión `related` con `onTargetDelete: 'restrict'`. | Elimina o reasigna primero esos registros. |

## Si nada de esto aplica

Usa **Reportar bug** desde la pantalla con el problema e incluye: la versión del módulo, qué hiciste y el mensaje exacto (o una captura de la consola del navegador).
