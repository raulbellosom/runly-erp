# Runly Canvas — hotspots como pines de mapa

## 1. Feature title

Hotspots con tamaño fijo en pantalla (estilo Google Maps) o a escala del plano.

## 2. Status

Complete — Verified: 2026-10-02 (node --test desktop canvas+pos 95/95, eslint de archivos tocados, build:web). Smoke manual pendiente.

## 3. Context

Los hotspots se dibujan como un círculo de 36 × 36 unidades de mundo: escalan
con el zoom (diminutos al alejar, enormes al acercar) y no se pueden
redimensionar (`canResize` excluye `hotspot`). La etiqueta ya usa tamaño de
pantalla (12 px). Los mapas (Fase 5) y planos grandes vuelven esto más
visible.

## 4. Problem

1. Los pines no se leen al alejar ni dejan ver el plano al acercar.
2. No hay forma de cambiar su tamaño.
3. Etiquetas encimadas cuando hay muchos pines juntos.

## 5. Goals

1. Modo **"Fijo en pantalla"** (por defecto): pin en forma de gota con la punta
   en el punto marcado y tamaño constante en píxeles: Pequeño 24, Mediano 32,
   Grande 44 px de alto.
2. Modo **"Crece con el plano"**: el pin se dibuja dentro de su caja de mundo,
   escala con el zoom y se puede redimensionar (proporción cuadrada).
3. Etiquetas a tamaño de pantalla bajo el pin; se omiten las que se
   encimarían con otra ya dibujada (las de pines más arriba en el orden de
   pintado ganan).
4. Inspector del hotspot: "Tamaño del pin" (Pequeño/Mediano/Grande) y
   "Escala" (Fijo en pantalla / Crece con el plano).

## 6. Non-goals

1. Agrupar pines cercanos (clustering).
2. Hotspots de área (polígono interactivo).

## 7. User stories

1. Como usuario, quiero que los pines se vean igual al alejar un plano grande,
   como en un mapa.
2. Como usuario, quiero un pin grande que cubra una máquina del plano y crezca
   con él.

## 8. UX requirements

- Pin "gota": círculo con punta hacia abajo; color del hotspot, borde blanco,
  ícono blanco o punto central si no tiene ícono.
- Seleccionado en modo fijo: anillo del color primario alrededor del pin (sin
  asas). En modo plano: caja y 4 asas de esquina, redimensión proporcional.
- Etiqueta: píldora bajo la punta (modo fijo) o bajo la caja (modo plano),
  sólo si `zoom ≥ 0.25` en modo fijo y `≥ 0.5` en modo plano.
- Inspector: dos controles `Choice` en la sección del hotspot.

## 9. Routes/screens

`/app/m/runly.canvas/:boardId` y enlaces públicos (mismo renderer).

## 10. Data model

Sin tablas. `CanvasObject.style.pin = { size: 'sm' | 'md' | 'lg', scale: 'screen' | 'plan' }`
(ausente = `{ size: 'md', scale: 'screen' }`). El punto anclado es el centro
de la caja guardada (compatible con hotspots existentes).

## 11. Prisma impact

N/A.

## 12. API contract

N/A (`style` ya es JSON libre validado por tipo).

## 13–19

N/A (sin SDK, validadores, manifest, navegación, blueprints, permisos ni
cambios multiempresa).

## 20. Files/storage impact

N/A.

## 21. Export/import requirements

Exportaciones y miniaturas usan el mismo renderer; en modo fijo el pin tiene
el tamaño en píxeles de la imagen exportada.

## 22. Audit log requirements

N/A.

## 23. Edge cases

1. Hotspots existentes: se ven como pin fijo mediano anclado en su centro.
2. Hit-test en modo fijo: dentro del pin en píxeles de pantalla (no de la caja
   de mundo).
3. Selección por marco en modo fijo: cuenta el punto anclado.
4. Conectores a un hotspot en modo fijo: terminan en el punto anclado.
5. Cambiar de "plano" a "fijo" conserva el centro.

## 24. Risks

1. Hit-test dependiente del zoom → `hitObject` recibe `zoom` opcional; sin él
   se comporta como hoy.

## 25. Acceptance criteria

1. Dado un pin fijo mediano, cuando el zoom pasa de 0,25 a 4, entonces su
   alto en pantalla es 32 px en ambos.
2. Dado un clic a 10 px de pantalla sobre la punta de un pin fijo, entonces se
   selecciona; a 40 px, no.
3. Dado un pin en modo plano, cuando se arrastra una esquina, entonces ancho y
   alto cambian igual.
4. Dadas dos etiquetas que se encimarían, entonces sólo se dibuja una.

## 26. Verification plan

- `node --test apps/desktop/src/modules/runly.canvas/engine/*.test.js apps/desktop/src/modules/runly.canvas/lib/*.test.js`
- `npx eslint` de archivos tocados; `pnpm --filter ./apps/desktop build:web`.

## 27. Rollback plan

Revertir commits; `style.pin` queda como JSON inerte.

## 28. Future enhancements

1. Agrupar pines cercanos al alejar.
2. Hotspots de área.
