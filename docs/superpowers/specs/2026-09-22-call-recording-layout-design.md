# Layout de grabación con foco en screen-share — Design

Date: 2026-09-22
Status: Approved
Module: `runly.chat` (`apps/api/src/routes/calls/call-recording-service.js`)

## 1. Feature title

Dar foco a la pantalla compartida en el composite grabado por LiveKit Egress.

## 2. Status

Approved

## 3. Context

`docs/superpowers/specs/2026-09-13-atlas-calls-recording-design.md` implementó
grabación de llamadas vía `room composite egress` de LiveKit, con salida HLS a
Supabase Storage. Ese spec dejó explícitamente como no-goal "personalización
de layout/calidad de la composición más allá de lo que LiveKit Egress ofrece
por defecto". En la implementación actual
(`apps/api/src/routes/calls/call-recording-service.js:133`):

```js
info = await egressClient().startRoomCompositeEgress(call.livekitRoomName, { segments: output });
```

No se pasa ningún `opts.layout` — el tercer argumento de
`startRoomCompositeEgress` (definido en `RoomCompositeOptions` de
`livekit-server-sdk@2.18.0`) queda `undefined`.

Se investigó el código fuente de la plantilla de composición por defecto que
usa el binario de LiveKit Egress
(`github.com/livekit/egress`, `template-default/src/Room.tsx`):

```ts
let effectiveLayout = layout;
if (hasScreenShare && layout.startsWith('grid')) {
  effectiveLayout = layout.replace('grid', 'speaker');
}
```

Es decir: la propia plantilla de LiveKit **ya sabe** subir de `grid` a
`speaker` automáticamente en cuanto detecta un track de screen-share — pero
solo si el string de `layout` recibido empieza con `"grid"`. Si `layout` llega
vacío/`undefined` (que es exactamente lo que pasa hoy, porque el binario de
Egress no garantiza que un `layout` ausente se normalice a `"grid"` antes de
llegar a la plantilla), ese `if` nunca se cumple: no hay upgrade a `speaker`,
y el composite cae al `else` final — un `GridLayout` plano donde cámaras y
pantalla compartida son celdas del mismo tamaño. Esto explica exactamente el
síntoma reportado: "grabas pantalla compartida y se ve como si fuera una
cámara más, muy pequeña".

El layout `speaker` (`template-default/src/SpeakerLayout.tsx`), por su parte,
ya ordena los tracks con `useVisualStableUpdate` (prioriza screen-share sobre
cámaras) y renderiza el primero en un `FocusLayout` grande con el resto en un
`CarouselLayout` — es decir, la composición "pantalla grande + franja de
cámaras" que se pide ya existe en LiveKit, simplemente no se está activando
porque nunca se le pasa un valor a `layout`.

## 4. Problem

Las grabaciones de llamadas con screen-share activo componen la pantalla
compartida como una celda más de un grid uniforme, en vez de darle el
protagonismo visual que tuvo en vivo — la grabación pierde legibilidad
justamente en el caso de uso más común de grabar (presentaciones, demos,
entrevistas con pantalla compartida).

## 5. Goals

1. Cuando la llamada grabada tiene screen-share activo, el composite grabado
   muestra la pantalla compartida como tile principal grande, con el resto de
   cámaras en una franja/carrusel — igual que ahora se ve en vivo tras el
   spec de spotlight (`2026-09-22-call-spotlight-pin-overhaul-design.md`).
2. Cuando la llamada grabada no tiene screen-share, el composite sigue siendo
   un grid de cámaras (sin cambios respecto al comportamiento actual).
3. El fix se apoya en las plantillas ya incluidas en LiveKit Egress — no se
   despliega ni mantiene ninguna plantilla web custom.

## 6. Non-goals

1. No se implementa una plantilla de composición propia (`customBaseUrl`) —
   se usa exclusivamente el catálogo de layouts que ya trae LiveKit Egress
   (`grid`, `speaker`, `single-speaker`, cada uno con variante `-light`).
2. No se cambia el layout de una grabación ya en curso (`updateLayout`) —
   el layout se fija una sola vez al iniciar (`startRoomCompositeEgress`),
   consistente con que hoy tampoco hay UI para cambiarlo a mitad de
   grabación.
3. No se toca nada del flujo en vivo (eso vive en el spec de spotlight,
   spec separado).
4. No se cambia calidad, resolución, ni ningún otro `EncodingOptions` de la
   grabación — solo el campo `layout`.

## 7. User stories

- Como usuario que revisa una grabación pasada de una llamada donde alguien
  compartió pantalla, quiero ver la pantalla compartida en grande y legible,
  con los rostros de los demás en una franja, en vez de un grid donde todo
  se ve igual de pequeño.

## 8. UX requirements

No hay UI nueva — el cambio es enteramente de configuración del pedido a
LiveKit Egress. El reproductor HLS existente (`ChatRecordingsGallery.jsx`)
no cambia; simplemente reproduce un archivo cuyo contenido visual ya viene
compuesto con el layout correcto.

## 9. Routes/screens

Sin cambios — ningún endpoint ni pantalla nueva.

## 10. Data model

N/A — no se modifica `CallRecording` ni ningún otro modelo.

## 11. Prisma impact

N/A

## 12. API contract

Sin cambios de forma en `POST /calls/:callId/recording/start` — el cambio es
interno a `call-recording-service.js`, invisible para el cliente SDK.

## 13. SDK contract

N/A

## 14. Validator contract

N/A

## 15. Module manifest impact

N/A

## 16. Navigation impact

N/A

## 17. Blueprint impact

N/A

## 18. RBAC/permissions

N/A — sin cambios sobre `chat.calls.record`.

## 19. Multi-company behavior

N/A — sin cambios de scoping.

## 20. Files/storage impact

N/A — mismo bucket, mismo prefijo, mismo formato HLS. Solo cambia el
contenido visual de los frames compuestos.

## 21. Export/import requirements

N/A

## 22. Audit log requirements

N/A — sin cambios en `chat.call_recording.start`/`.stop`.

## 23. Edge cases

1. Llamada grabada donde nadie comparte pantalla en ningún momento: el
   composite se mantiene en `GridLayout` puro durante toda la grabación —
   sin cambio de comportamiento.
2. Llamada donde el screen-share empieza después de iniciar la grabación:
   la propia plantilla de LiveKit reacciona en vivo (`useTracks` +
   `hasScreenShare` en `Room.tsx` del lado de Egress) — el upgrade de grid a
   speaker ocurre dentro del proceso de composición sin que la API de Runly
   tenga que reiniciar ni reconfigurar el egress.
3. Screen-share termina a mitad de la grabación: la misma reacción de la
   plantilla vuelve a `GridLayout` automáticamente (el `if` se re-evalúa en
   cada render de la página de composición).
4. Llamada solo de audio (nadie enciende cámara ni comparte pantalla): sigue
   cubierto por el `GridLayout`/avatar-por-defecto de LiveKit, sin relación
   con este cambio (ver spec de grabación original, edge case 7).

## 24. Risks

1. Riesgo: el comportamiento de auto-upgrade grid→speaker vive en el código
   de la plantilla de LiveKit Egress (fuera de este repo) y podría cambiar en
   una versión futura del binario de Egress. Mitigación: el valor pasado es
   el nombre de layout público y documentado (`grid-dark`), no un detalle de
   implementación — si LiveKit cambia esa lógica interna, seguimos pidiendo
   un layout válido y soportado; en el peor caso se degrada a un grid plano
   (el comportamiento de hoy), nunca rompe la grabación.
2. Riesgo: `grid-dark` asume tema oscuro. El propio call UI en vivo es oscuro
   (`bg-slate-950` en `CallRoomLayout.jsx`), así que es consistente con la
   identidad visual ya usada en la llamada.

## 25. Acceptance criteria

1. Given una llamada grabada donde alguien comparte pantalla durante toda la
   sesión, when se reproduce la grabación resultante, then la pantalla
   compartida aparece como tile grande con las cámaras de los demás en una
   franja.
2. Given una llamada grabada sin ningún screen-share, when se reproduce la
   grabación, then el composite es el grid de cámaras de siempre (sin
   regresión).
3. Given `startRecording`, then la llamada a `startRoomCompositeEgress`
   incluye `{ layout: "grid-dark" }` como tercer argumento.

## 26. Verification plan

- `node --test apps/api/src/routes/calls/__tests__/call-recording-service.test.js` —
  se extiende la aserción existente sobre `egress.started[0]` para verificar
  `opts.layout === "grid-dark"`.
- `pnpm build` — sin errores.
- Manual (requiere Egress desplegado en staging, ya documentado como
  dependencia manual en el spec de grabación original): grabar una llamada
  con screen-share activo y confirmar visualmente el layout `speaker` en el
  HLS resultante; grabar una llamada sin screen-share y confirmar que sigue
  siendo grid.

## 27. Rollback plan

- Cambio de una sola línea (agregar `opts.layout`) sin migración ni estado
  persistido — revertir el commit restaura el comportamiento anterior
  (grid plano siempre) sin ningún paso adicional.

## 28. Future enhancements

1. Plantilla de composición custom (`customBaseUrl`) si en algún momento se
   necesita branding propio en la grabación (logo, marca de agua) — fuera de
   alcance hoy, ya que este fix resuelve el problema reportado sin ella.
2. Permitir elegir el layout de grabación desde la UI (hoy es un valor fijo).
