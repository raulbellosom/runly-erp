# Instrucciones para asistentes de IA — custom.encuestas

Este paquete es un módulo de Runly generado por el Constructor de módulos. Antes de cambiar nada, lee `GUIA_DESARROLLO_RUNLY.md` (personalizada para este módulo) y la documentación actual:

- Índice para IA: https://runly.mx/llms.txt
- Documentación de desarrolladores: https://runly.mx/documentacion/desarrolladores (cada página también en Markdown agregando `.md`)

## Reglas

1. Para mantener el módulo editable en el Constructor, **solo agrega**: archivos en `components/` (.js, .jsx, .css, .json, .svg), vistas `views/<nombre>.custom.js` de tipo CUSTOM y sus entradas en `views` y `navigation` de `module.manifest.js`. Cambiar cualquier otro archivo pasa el módulo a modo desarrollador.
2. No edites ni borres `.module-definition.json`, `models/`, ni los archivos generados de `api/`, `views/` y `validators/` salvo que la persona pida explícitamente trabajar en modo desarrollador.
3. Componentes en `.jsx` (sin TypeScript), runtime JSX automático, hooks con import nombrado (`import { useState } from 'react'`, nunca `React.useState`). Sin APIs de Node en el navegador.
4. Registra cada componente en `components/index.js` con la clave `custom.encuestas:<Componente>`; la vista CUSTOM usa esa clave en `schema.component` y la URL completa `/app/m/custom.encuestas/...` en `schema.path`.
5. Llama a la API con `fetch(apiBaseUrl + '/encuestas/...', { headers: buildApiHeaders(token, companyId) })` usando las props del componente (`token`, `companyId`, `apiBaseUrl`). Datos de otros módulos: `/relation-targets/<tipo>/search` y `/resolve`.
6. UI con `@runly/ui` (PageHeader, SelectField, TextField, DataTable, Dialog, Sheet, ConfirmDialog, EmptyState, ErrorState, Skeleton…), nunca `window.confirm/alert/prompt` ni controles nativos si existe el componente. Textos en español, sin emojis. Tailwind con tokens del tema (`hsl(var(--card))`, `var(--brand-primary)`).
7. Solo usa las librerías listadas en la guía (sección *Librerías disponibles*) con esas versiones.
8. Sube la versión en `module.manifest.js` antes de entregar. La persona sube el ZIP en Runly con "Subir actualización": Runly lo valida y muestra una vista previa antes de aplicar.


## Estado de esta versión

La versión 1.1.0 está intencionalmente en modo desarrollador: además de componentes y vistas, modifica modelos y API para integrar encuestas con Identity/RR. HH. e Inventario. No reviertas esos cambios a CRUD generado sin revisar `README_ENCUESTAS.md` y la sección 9 de `GUIA_DESARROLLO_RUNLY.md`.
