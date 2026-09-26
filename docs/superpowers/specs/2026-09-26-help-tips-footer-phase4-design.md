# Tip contextual en el BrandFooter (Fase 4 del sistema de ayuda de módulos)

Date: 2026-09-26
Status: Approved (continuación autorizada por el usuario del roadmap de
docs/superpowers/specs/2026-09-26-module-help-system-design.md §28, fase 4;
ubicación confirmada por el usuario: fusionar con el `BrandFooter` existente)
Author: Claude (agente)
Spec file: docs/superpowers/specs/2026-09-26-help-tips-footer-phase4-design.md
Plan file: (combinado en este mismo documento)

## Contexto y alcance

Las Fases 1-3 dieron banco de contenido + panel/página + widget IA/fallback +
tool de MirAI. Esta última fase retoma la idea original del usuario ("usar
la barra inferior para que aparecieran consejos... sobre la pestaña en la
que está el usuario") pero de forma acotada: el único elemento de "barra
inferior" que existe hoy en el shell autenticado es `BrandFooter`
(`packages/ui/src/components/BrandFooter.jsx`), una franja delgada (h-12)
renderizada una sola vez, desde `apps/desktop/src/app/RunlyApp.jsx`, visible
en desktop (`lg:flex`) en toda pantalla excepto `runly.chat` en pantalla
completa. Confirmado por grep: `BrandFooter` no se usa en ningún otro lugar
del repo (no en login, no en páginas públicas) — fusionar el tip ahí no
afecta ninguna otra pantalla.

**Decisión de alcance (YAGNI) respecto al roadmap original:** el roadmap
hablaba de "carrusel" (rotación automática entre varios mensajes) más
"espacio para avisos del dueño de Runly". Esta fase implementa la mitad
simple y ya útil: **un tip contextual que cambia cuando el usuario navega**
(no un ticker que se auto-avanza cada N segundos entre varios mensajes
mientras el usuario sigue en la misma pantalla). Los avisos del dueño de
Runly siguen fuera de alcance (ya lo estaban desde la Fase 1, sin mecanismo
de distribución). Justificación: el valor real pedido — "que se vea algo
útil sobre la pestaña en la que estoy" — ya se cubre completo así, sin la
complejidad de temporizadores/pausa-al-hover/cola de mensajes que un ticker
real necesitaría. Se anota como mejora futura si se quiere el ticker
completo más adelante.

## Diseño

**Fuente del contenido**: reutiliza `GET /help/resolve` (Fase 1) — el mismo
endpoint que ya consume `HelpButton.jsx`. El "tip" es `view.summary` si hay
vista documentada para la ruta actual, si no `overview.summary` del módulo,
si no hay ninguno el footer se ve exactamente igual que hoy (sin la franja
de tip). **Cero cambios de esquema o de API** — `summary` ya existe en el
schema `HELP` desde la Fase 1.

**Compartir la consulta con `HelpButton`**: ambos usan la misma
`queryKey: ["help", "resolve", apiPath]` vía TanStack Query, así que cuando
las dos partes están montadas (footer siempre; el sheet de `HelpButton`
solo mientras está abierto) no se duplica la petición de red — React Query
deduplica por `queryKey`. Se extrae `toApiPath` (ya definida de forma
idéntica en `HelpButton.jsx`) a un helper compartido para no duplicar la
lógica de recorte del prefijo `/app`.

**Archivos:**
- Create: `apps/desktop/src/lib/apiPath.js` — extrae `toApiPath` (hoy vive
  inline en `HelpButton.jsx`).
- Create: `apps/desktop/src/lib/help-tip.js` — función pura
  `pickTipText(resolved)` → `string | null` (testable sin React).
- Create: `apps/desktop/src/app/useHelpTip.js` — hook:
  ```js
  import { useLocation } from "react-router-dom";
  import { useQuery } from "@tanstack/react-query";
  import { runly } from "../lib/runly";
  import { useAuth } from "../auth/AuthProvider";
  import { toApiPath } from "../lib/apiPath.js";
  import { pickTipText } from "../lib/help-tip.js";

  export function useHelpTip() {
    const { session } = useAuth();
    const token = session?.access_token;
    const location = useLocation();
    const apiPath = toApiPath(location.pathname);
    const { data } = useQuery({
      queryKey: ["help", "resolve", apiPath],
      queryFn: () => runly.help.resolveHelp(apiPath, token).then((r) => r.data),
      enabled: Boolean(token),
      staleTime: 60_000,
    });
    return pickTipText(data);
  }
  ```
  Nota: a diferencia de `HelpButton`, aquí `enabled` NO depende de `open`
  (el footer siempre está montado en desktop) — por eso se agrega
  `staleTime: 60_000` para no re-pedir en cada render/foco; es la misma
  llamada de red que ya hace `HelpButton` cuando el usuario abre el panel,
  simplemente ahora también se dispara pasivamente por el footer.
- Modify: `apps/desktop/src/components/HelpButton.jsx` — usa el
  `toApiPath` compartido en vez de la copia local (elimina la duplicación,
  sin cambiar comportamiento).
- Modify: `packages/ui/src/components/BrandFooter.jsx` — nuevo prop `tip`:
  ```jsx
  export function BrandFooter({ className, editionName = "Jaguar", tip }) {
    return (
      <footer className={cn("shrink-0 h-12 border-t border-[hsl(var(--border))] px-4 flex items-center justify-between gap-4 bg-[hsl(var(--background))]", className)}>
        <span className="text-[11px] text-[hsl(var(--muted-foreground))] leading-none shrink-0">
          Runly ERP {editionName} <span className="font-medium">v0.1</span>
        </span>
        {tip && (
          <span className="hidden md:block flex-1 min-w-0 truncate text-center text-[11px] text-[hsl(var(--muted-foreground))]" title={tip}>
            {tip}
          </span>
        )}
        <a
          href="https://racoondevs.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-[hsl(var(--muted-foreground))] leading-none hover:text-[hsl(var(--foreground))] transition-colors duration-150 shrink-0"
        >
          Hecho con amor por Racoon Devs
        </a>
      </footer>
    );
  }
  ```
  (`shrink-0` agregado a los dos elementos originales para que no se
  compriman cuando el `tip` central reclama espacio; `hidden md:block` oculta
  el tip en pantallas angostas donde ya es apretado mostrar los tres
  elementos — el footer completo ya es `hidden` bajo `lg` desde `RunlyApp.jsx`,
  así que en la práctica esto sólo decide si el tip se ve entre `md` y `lg`
  vs. solo en `lg`+; se deja así por simplicidad, no es una pantalla real
  alcanzable hoy dado el `hidden lg:flex` externo, pero es una guarda barata
  por si ese externo cambia).
- Modify: `apps/desktop/src/app/RunlyApp.jsx` — donde ya renderiza
  `<BrandFooter className="hidden lg:flex" editionName={RUNLY_EDITION_NAME} />`,
  agregar `tip={helpTip}` con `const helpTip = useHelpTip();` declarado junto
  a los demás hooks del componente. Un solo cambio de dos líneas en un
  archivo que ya se leyó con cuidado para no romper su layout (no se toca
  ninguna clase de flex/altura existente).

## Riesgos

1. Riesgo: el tip se ve cortado en pantallas medianas. Mitigación: `truncate`
   + `title` (tooltip nativo con el texto completo) + `hidden md:block`.
2. Riesgo: request adicional de red pasivo en cada pantalla. Mitigación: es
   la misma llamada que ya existe para `HelpButton` (dedupe por queryKey) y
   trae `staleTime: 60_000`; el payload es un JSON pequeño (título + resumen
   + contenido de a lo más 2 artículos).
3. Riesgo: romper el layout cuidadosamente ajustado de `RunlyApp.jsx`.
   Mitigación: el único cambio ahí es agregar una prop a un componente que
   ya se renderiza igual (mismas clases, mismo lugar en el árbol) — no se
   toca ninguna clase de altura/flex.

## Non-goals (explícitos)

1. No hay auto-avance/temporizador entre varios mensajes (ver "Decisión de
   alcance" arriba).
2. No hay mecanismo de avisos del dueño de Runly (sigue fuera de alcance
   desde la Fase 1).
3. No hay versión para pantallas angostas/móvil — el `BrandFooter` mismo ya
   es `hidden` bajo `lg` en `RunlyApp.jsx`; esta fase no cambia eso.

## Plan de implementación

1. Escribir `apps/desktop/src/lib/__tests__/help-tip.test.js` con casos:
   vista con summary → la usa; sin vista pero con overview → usa el del
   overview; sin ninguno → `null`; `resolved` es `null`/`undefined` → `null`.
2. Correr, confirmar que falla (`pickTipText` no existe).
3. Crear `apps/desktop/src/lib/help-tip.js` con `pickTipText`.
4. Correr, confirmar que pasa.
5. Crear `apps/desktop/src/lib/apiPath.js` con `toApiPath` (mover la función
   ya existente en `HelpButton.jsx`, sin cambiar su comportamiento).
6. Actualizar `HelpButton.jsx` para importar `toApiPath` desde ahí en vez de
   definirla localmente.
7. Crear `apps/desktop/src/app/useHelpTip.js`.
8. Actualizar `BrandFooter.jsx` con el prop `tip` opcional.
9. Actualizar `RunlyApp.jsx`: importar y llamar `useHelpTip()`, pasar
   `tip={helpTip}` a `<BrandFooter>`.
10. `pnpm --filter @runly/desktop build:web` — confirmar build limpio.
11. `pnpm lint`.
12. `pnpm build` completo.
13. Commit.

## Acceptance criteria

1. Given una ruta cuya vista tiene `summary` documentado, when el footer se
   renderiza, then muestra ese `summary` centrado, truncado si es largo.
2. Given una ruta sin vista documentada pero cuyo módulo sí tiene overview,
   when el footer se renderiza, then muestra el `summary` del overview.
3. Given una ruta sin ningún contenido de ayuda, when el footer se
   renderiza, then se ve exactamente igual que antes de esta fase (sin
   franja de tip, sin espacio vacío raro).
4. `pickTipText(undefined)` y `pickTipText(null)` devuelven `null` sin
   lanzar.

## Verification plan

- `node --test apps/desktop/src/lib/__tests__/help-tip.test.js`
- `pnpm --filter @runly/desktop build:web`
- `pnpm lint`, `pnpm build`

**Verificado: 2026-09-26** (implementación completa)

1. Verificado — `help-tip.test.js` ("prefers the view summary when a view
   is resolved").
2. Verificado — `help-tip.test.js` ("falls back to the overview summary
   when there is no view").
3. Verificado — `help-tip.test.js` ("returns null when neither view nor
   overview exist"); revisión de código de `BrandFooter.jsx` confirma que
   `tip` falsy no renderiza el `<span>` central (footer idéntico al de
   antes de esta fase).
4. Verificado — `help-tip.test.js` ("returns null for undefined input",
   "returns null for null input").

`help-tip.test.js`: 5/5 pass. `pnpm --filter @runly/desktop build:web` y
`pnpm build` (monorepo completo, incluyendo el instalador nativo Tauri)
verdes. `pnpm lint` sin errores. No se verificó visualmente en navegador
(mismo caveat de entorno que las fases 1-2): el diseño se validó por tipos
de datos + build, no por captura de pantalla en vivo.
