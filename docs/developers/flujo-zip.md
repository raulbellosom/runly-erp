---
title: Flujo con ZIP y modos de edición
summary: El ciclo completo de un módulo con código — descargar el ZIP, editarlo, revisarlo, subirlo, instalarlo y publicarlo de nuevo — y los tres modos de edición del Constructor.
order: 1
---
Un módulo de Runly es una carpeta con archivos JavaScript. El **Constructor de módulos** genera esa carpeta a partir de lo que diseñas visualmente; cuando necesitas algo que el Constructor no hace, descargas la carpeta como ZIP, la editas y la subes de vuelta.

## El ciclo completo, paso a paso

```
Constructor ──► Descargar ZIP ──► Editar ──► Revisar ──► Subir ──► Instalar ──► Usar
   (visual)        (con guía)     (código)   (no aplica)  (aplica)  (1a. vez)
```

1. **Diseña en el Constructor** (Módulos > Constructor de módulos): entidades, campos, relaciones, pantallas. No hace falta publicar antes de descargar.
2. **Descarga el ZIP**: en el editor, botón `</>` (**Modo desarrollador**) > **Descargar ZIP con guía**. El ZIP trae `GUIA_DESARROLLO_RUNLY.md` (tablas, API, permisos y campos de *tu* módulo) y `AGENTS.md` (instrucciones para asistentes de IA).
3. **Edita el código** con tu editor o un asistente de IA (ver *Trabajar con IA*). Aumenta la versión en `module.manifest.js` (`1.1.0` → `1.1.1`).
4. **Vuelve a comprimir la carpeta** de modo que `module.manifest.js` quede en la raíz del ZIP (o dentro de una sola carpeta).
5. **Revisa**: en el editor, **Subir actualización** (o Módulos > Subir módulo) y elige el ZIP. Esto **solo revisa**: valida la estructura, compara las tablas, compila tus pantallas y muestra una vista previa. **Todavía no se sube nada.**
6. **Sube**: botón **Subir módulo** (módulo nuevo) o **Aplicar actualización** (módulo instalado). Runly copia los archivos, aplica los cambios de tablas seguros, compila `components/` y recarga la API del módulo sin reiniciar el servidor.
7. **Instala (solo la primera vez)**: un módulo subido que nunca se instaló aparece en el **Catálogo de módulos** con el botón **Instalar**. Instalar crea las tablas, los permisos y el menú.
8. **Usa y asigna permisos**: abre el módulo desde el catálogo o el menú. Si otros usuarios lo necesitan, asigna sus permisos en Identidad > Roles.

Las siguientes veces repites 3 → 6: al aplicar una actualización de un módulo instalado, el cambio queda activo de inmediato.

### Lo que suele confundir

| Ves esto | Significa |
|---|---|
| La vista previa muestra *No se pudo cargar* y la API responde **404** | El módulo aún no está instalado: su API no existe todavía. Sube e instala; después la vista previa y la pantalla cargarán datos. |
| La vista previa no refleja tus cambios en `api/` | La vista previa usa la API **instalada**; los cambios de `api/` se ven al aplicar. |
| El botón **Publicar** del Constructor está deshabilitado | El proyecto está en **modo desarrollador**: el código es tuyo y el Constructor no lo publica para no sobrescribirlo. Subir el ZIP ocupa el lugar de Publicar. |
| El módulo no aparece en el catálogo | La subida no se aplicó (solo se revisó). Repite el paso 6 y espera el aviso *Módulo … actualizado*. |
| *La versión no aumentó* | Cambia `version` en `module.manifest.js`. Se puede aplicar igual, pero conviene versionar cada cambio. |

## Estructura del paquete

```
module.manifest.js        Declaración: clave, versión, vistas, menú (navigation), permisos, dependencias
models/                   Tablas del módulo (defineModel). Las crea y migra Runly
views/                    Vistas declarativas (defineView): tabla, formulario, detalle, CUSTOM…
api/index.js              Router Hono del módulo; monta <entidad>-routes.js
api/<entidad>-*.js        routes (endpoints), service (SQL), relations, visibility, files
validators/               Esquemas Zod de cada entidad (crear y editar)
components/               (tuyo) Pantallas React: index.js registra, *.jsx implementa
.module-definition.json   Definición del Constructor. No lo borres: con él Runly distingue tus cambios
GUIA_DESARROLLO_RUNLY.md  Guía personalizada de tu módulo (se ignora al subir)
AGENTS.md                 Instrucciones para asistentes de IA (se ignora al subir)
docs/                     Esta documentación en Markdown, para leerla sin internet (se ignora al subir)
```

### Reglas que no se deben romper

- **La clave del módulo no cambia** (`custom.encuestas`). Es la identidad del módulo, de sus tablas y permisos.
- **Tablas**: los cambios se hacen en `models/` con `defineModel`. Runly solo aplica cambios **aditivos** (tablas y columnas nuevas); quitar columnas, cambiar tipos o agregar un campo obligatorio a una tabla con registros **bloquea** la subida para no perder datos.
- **SQL**: en `api/` usa `prisma.$queryRaw` con plantillas etiquetadas (`` prisma.$queryRaw`SELECT … WHERE id = ${id}::uuid` ``), nunca concatenes texto. Los `id` los genera la base (`uuidv7()`); usa `INSERT … RETURNING *`.
- **Empresa**: toda consulta filtra por `company_id` de la empresa activa.
- **Borrado**: no se borran registros; se desactivan con `enabled = false`.
- **Servicios**: las funciones que usan `prisma` van dentro de `create<Algo>Service({ prisma })`.

## Los tres modos de edición

| Modo | Qué significa | Cómo se llega |
|---|---|---|
| **Visual** | Todo se edita en el Constructor y se publica desde ahí. | Por defecto. |
| **Mixto** | Sigues en modo visual y el Constructor guarda tus pantallas React y las incluye en cada publicación. | Subir un ZIP que **solo agrega** archivos en `components/`, vistas `views/<nombre>.custom.js` y sus entradas en `views` y `navigation` del manifiesto. |
| **Desarrollador** | El módulo se trabaja como código; el Constructor ya no lo edita ni lo publica. Las actualizaciones se hacen subiendo ZIPs. | Subir un ZIP que cambia otros archivos (`api/`, `models/`, archivos generados, permisos…) o convertirlo desde **Modo desarrollador**. |

Para saber qué cambiaste, Runly regenera el paquete a partir de `.module-definition.json` y lo compara con tu ZIP: los archivos generados deben quedar idénticos (se ignoran diferencias de fin de línea), y solo se aceptan como extensiones del modo mixto los archivos y entradas descritos arriba. Límite de extensiones: 1.5 MB de texto.

## Qué revisa Runly antes de aplicar

- **Bloquea** si el paquete no es válido (falta el manifiesto, la clave no coincide, un archivo no se puede leer), si la estructura instalada fue modificada fuera de Runly, o si un cambio de tablas perdería datos.
- Lista los **cambios de estructura** seguros (tablas o columnas nuevas).
- **Avisa** si no aumentaste la versión, si faltan dependencias para instalar o si tus componentes no compilan (con el error de esbuild, archivo y línea).
- Indica si el proyecto del Constructor **sigue en modo visual/mixto** (guardará tus pantallas) o **pasará a modo desarrollador** (y por qué archivos).
- Muestra una **vista previa** de tus vistas `CUSTOM`, con datos reales si el módulo está instalado.

## Volver al modo visual

En el editor: **Modo desarrollador > Volver al modo visual**. Si lo único hecho con código son pantallas React, vuelve y las conserva. Si hay otros cambios, Runly lista qué se perdería en la siguiente publicación y ofrece **Descargar respaldo** del paquete instalado antes de confirmar.
