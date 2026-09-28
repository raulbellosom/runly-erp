---
title: Flujo con ZIP y modos de edición
summary: Cómo descargar un módulo del Constructor, extenderlo con código y subirlo de vuelta sin perder el trabajo visual.
order: 1
---
## Estructura del paquete

```
module.manifest.js        Declaración: vistas, menú (navigation), permisos, dependencias
models/                   Tablas del módulo (las gestiona Runly; no editar sin saber de migraciones)
views/                    Vistas declarativas: tabla, formulario, detalle, página, tableros…
api/                      API del módulo (Hono): <entidad>-routes.js, -service.js, -relations.js…
validators/               Validaciones Zod de cada entidad
components/               (tuyo) Pantallas React
.module-definition.json   Definición del Constructor. No lo borres: con él Runly distingue tus cambios
GUIA_DESARROLLO_RUNLY.md  Guía personalizada de tu módulo
AGENTS.md                 Instrucciones para asistentes de IA
```

## Los tres modos

| Modo | Qué significa | Cómo se llega |
|---|---|---|
| **Visual** | Todo se edita en el Constructor y se publica desde ahí. | Por defecto. |
| **Mixto** | Sigues en modo visual y el Constructor guarda tus pantallas React y las incluye en cada publicación. | Subir un ZIP que **solo agrega** archivos en `components/`, vistas `views/<nombre>.custom.js` y sus entradas en `views` y `navigation` del manifiesto. |
| **Desarrollador** | El módulo se trabaja como código; el Constructor ya no lo edita ni lo publica para no sobrescribirlo. | Subir un ZIP que cambia otros archivos (`api/`, `models/`, archivos generados, permisos…) o convertirlo a mano. |

Para saber qué cambiaste, Runly regenera el paquete a partir de `.module-definition.json` y lo compara con tu ZIP: los archivos generados deben quedar idénticos (se ignoran diferencias de fin de línea), y solo se aceptan como "extensiones" los archivos y entradas descritos arriba. Límite de extensiones: 1.5 MB de texto.

## Subir una actualización

Desde el editor (**Subir actualización**) o en **Módulos > Subir módulo**. Antes de aplicar, Runly **revisa** el paquete sin instalar nada:

- **Bloquea** si el paquete no es válido, si la estructura instalada fue modificada fuera de Runly, o si un cambio de tablas perdería datos (quitar columnas, cambiar tipos, un campo obligatorio nuevo en una tabla con registros).
- Lista los **cambios de estructura** seguros (tablas o columnas nuevas).
- **Avisa** si no aumentaste la versión en `module.manifest.js`, si faltan dependencias para instalar o si tus componentes no compilan (con el error de esbuild).
- Indica si el proyecto del Constructor **sigue en modo visual** (guardará tus pantallas) o **pasará a modo desarrollador** (y por qué archivos).
- Muestra una **vista previa** de tus vistas `CUSTOM` con datos reales. Los datos vienen de la API instalada: los cambios en `api/` se ven hasta aplicar.

Al aplicar, Runly aplica los cambios de tablas seguros, compila `components/` con esbuild y recarga el módulo sin reconstruir la aplicación. Si el módulo no estaba instalado, después hay que darle **Instalar** en el catálogo de Módulos.

## Volver al modo visual

En el editor: **Modo desarrollador > Volver al modo visual**. Si lo único hecho con código son pantallas React, vuelve y las conserva. Si hay otros cambios, Runly lista qué se perdería en la siguiente publicación y ofrece **Descargar respaldo** del paquete instalado antes de confirmar.
