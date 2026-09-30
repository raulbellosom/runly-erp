---
title: Trabajar con IA
summary: Cómo usar Claude, Cursor, Copilot u otro asistente para extender un módulo de Runly — AGENTS.md, llms.txt, qué pedirle y qué revisar antes de subir.
order: 7
---
Los módulos de Runly están pensados para que un asistente de IA pueda trabajar en ellos con poca explicación. Todo lo que necesita está en el ZIP y en esta documentación.

## Qué darle al asistente

| Recurso | Qué contiene | Cómo usarlo |
|---|---|---|
| `AGENTS.md` (en el ZIP) | Reglas del módulo: qué archivos puede tocar, cómo se registran pantallas, prohibiciones (SQL, UUID, diálogos nativos). | Déjalo en la raíz de la carpeta: Claude Code, Cursor, Codex y Copilot lo leen solos. |
| `GUIA_DESARROLLO_RUNLY.md` (en el ZIP) | Diccionario de datos de **tu** módulo: tablas, columnas, endpoints, permisos, relaciones y librerías con versión. | Menciónalo en tu petición: *"lee GUIA_DESARROLLO_RUNLY.md antes de empezar"*. |
| `docs/` (en el ZIP) | Esta misma documentación de desarrolladores en Markdown, tal como estaba al descargar el ZIP. | El asistente la lee sin internet; es la referencia principal si no puede abrir runly.mx. |
| [`/llms.txt`](https://runly.mx/llms.txt) | Índice de esta documentación y de la ayuda de cada módulo, en formato para IA. | Pega la URL si el asistente puede navegar. |
| [`/llms-full.txt`](https://runly.mx/llms-full.txt) | Toda la documentación para desarrolladores en un solo archivo de texto. | Adjúntalo o pega la URL cuando el asistente no tenga acceso al ZIP. |
| Cada página en Markdown | Agrega `.md` a la URL de cualquier página (`/documentacion/desarrolladores/pantallas-react.md`). | Para darle solo el tema que necesita. |

## Una buena petición

```
Estoy extendiendo el módulo de Runly custom.encuestas (carpeta actual).
Lee AGENTS.md, GUIA_DESARROLLO_RUNLY.md y docs/ antes de empezar.

Quiero una pantalla "Resultados" que muestre, por encuesta, una gráfica de
barras con el conteo de respuestas por opción.

- Hazla como vista CUSTOM con un componente React en components/.
- Usa @runly/ui (PageHeader, Card, SelectField, EmptyState, ErrorState) y recharts.
- Los datos salen de la API del módulo; si falta un endpoint, agrégalo en api/.
- Aumenta la versión del manifiesto.
```

Funciona mejor si dices **qué** quieres ver (no cómo programarlo), **de dónde salen los datos** y **qué componentes** prefieres.

## Qué revisar antes de subir

- [ ] `module.manifest.js`: la clave no cambió y la versión aumentó.
- [ ] Cada pantalla nueva tiene su componente registrado en `components/index.js`, su vista `views/<nombre>.custom.js` y su entrada en `views` (y en `navigation` si va en el menú).
- [ ] `schema.component` coincide con la clave de `registry.register`, y `schema.path` es la URL completa `/app/m/<clave>/...`.
- [ ] No hay `import React from 'react'`, `React.useState`, `window.confirm`, `<select>` ni colores fijos (`bg-white`).
- [ ] Los `fetch` usan `buildApiHeaders(token, companyId)` y `apiBaseUrl`.
- [ ] En `api/`, el SQL usa `prisma.$queryRaw` con plantillas, filtra por empresa y no genera UUID en JavaScript.
- [ ] En `models/` solo se agregan campos o tablas (nada se quita ni cambia de tipo).

Después súbelo con **Subir actualización**: la revisión de Runly detecta errores de compilación y cambios de tablas peligrosos antes de aplicar nada.

## Errores típicos de un asistente

| Síntoma | Causa | Corrección |
|---|---|---|
| *Cannot read properties of null (reading 'useState')* | `import React from 'react'` o `React.useState`. | Import nombrado: `import { useState } from 'react'`. |
| *Componente no registrado* | Clave distinta entre `registry.register` y `schema.component`. | Usa exactamente `<clave del módulo>:<Componente>`. |
| La subida se bloquea por cambios de tablas | El asistente quitó o renombró un campo en `models/`. | Deshaz ese cambio; agrega un campo nuevo en su lugar. |
| Error `company_required` | `fetch` sin encabezado de empresa. | `headers: buildApiHeaders(token, companyId)`. |
| La pantalla usa TypeScript | Los bundles de módulos solo aceptan `.js`/`.jsx`. | Pide que lo convierta a JavaScript. |
