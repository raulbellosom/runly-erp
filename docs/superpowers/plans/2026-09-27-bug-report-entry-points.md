# Persistent Bug Report Entry Points Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two new, always-reachable "Reportar un problema" triggers (a desktop footer icon and a mobile user-menu item) that open the existing bug-report dialog without requiring an actual error.

**Architecture:** Both triggers call the existing `requestBugReport()` bus (`packages/ui/src/lib/bugReportBus.js`) directly — the same function `ErrorState`/`ApiErrorScreen` already call — so the existing `BugReportHost.jsx` listener, screenshot capture, dialog, rate limiting and email pipeline are reused completely unmodified. No backend, SDK, or database changes. The only new logic is: where the trigger lives in the UI, and building a slightly richer `context` string (`"{activeModuleKey} · {pathname}"`) than the bare-pathname fallback `ErrorState` uses.

**Tech Stack:** React (apps/desktop, packages/ui), Tailwind, `@radix-ui/react-tooltip` (via `packages/ui/src/components/Tooltip.jsx`), `lucide-react` (`Bug` icon).

**Spec:** `docs/superpowers/specs/2026-09-27-bug-report-entry-points-design.md`

---

## File Structure

| File | Change |
|---|---|
| `packages/ui/src/components/BrandFooter.jsx` | Modify — add the desktop trigger (icon + tooltip) and a new `activeModuleKey` prop |
| `apps/desktop/src/app/RunlyApp.jsx` | Modify — pass the already-computed `activeModule?.key ?? moduleKeyFromPath` into `<BrandFooter>` |
| `apps/desktop/src/components/UserMenu.jsx` | Modify — add the mobile trigger (`<lg` only) using the existing `activeModuleKey` prop |

No new files. No test files — per the spec's Verification Plan (§26), `BrandFooter`/`UserMenu` are presentational shell components with no existing test harness, and the crash-triggered "Reportar bug" button in `ErrorState` is untested at this same layer today. Verification is lint + build + a manual breakpoint check (Task 4).

---

### Task 1: Desktop trigger in `BrandFooter.jsx`

**Files:**
- Modify: `packages/ui/src/components/BrandFooter.jsx`

- [ ] **Step 1: Replace the file's full contents**

The current file (for reference, this is what you're replacing):

```jsx
import { cn } from "../lib/utils.js";

export function BrandFooter({ className, editionName = "Jaguar", tip }) {
  return (
    <footer className={cn("shrink-0 h-12 border-t border-[hsl(var(--border))] px-4 flex items-center justify-between gap-4 bg-[hsl(var(--background))]", className)}>
      <span className="text-[11px] text-[hsl(var(--muted-foreground))] leading-none shrink-0">
        Runly ERP {editionName} <span className="font-medium">v0.1</span>
      </span>
      {tip && (
        <span
          className="hidden md:block flex-1 min-w-0 truncate text-center text-[11px] text-[hsl(var(--muted-foreground))]"
          title={tip}
        >
          {tip}
        </span>
      )}
      <a
        href="https://your-brand-site.example.com" // placeholder — keep this file's real, existing href unchanged
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

Replace it with:

```jsx
import { Bug } from "lucide-react";
import { cn } from "../lib/utils.js";
import { requestBugReport } from "../lib/bugReportBus.js";
import { Tooltip, TooltipTrigger, TooltipContent } from "./Tooltip.jsx";

export function BrandFooter({ className, editionName = "Jaguar", tip, activeModuleKey }) {
  function handleReportBug() {
    requestBugReport({
      context: activeModuleKey
        ? `${activeModuleKey} · ${window.location.pathname}`
        : window.location.pathname,
    });
  }

  return (
    <footer className={cn("shrink-0 h-12 border-t border-[hsl(var(--border))] px-4 flex items-center justify-between gap-4 bg-[hsl(var(--background))]", className)}>
      <span className="text-[11px] text-[hsl(var(--muted-foreground))] leading-none shrink-0">
        Runly ERP {editionName} <span className="font-medium">v0.1</span>
      </span>
      {tip && (
        <span
          className="hidden md:block flex-1 min-w-0 truncate text-center text-[11px] text-[hsl(var(--muted-foreground))]"
          title={tip}
        >
          {tip}
        </span>
      )}
      <div className="flex items-center gap-3 shrink-0">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={handleReportBug}
              className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors duration-150"
              aria-label="Reportar un problema"
            >
              <Bug size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            Reportar un problema
          </TooltipContent>
        </Tooltip>
        <a
          href="https://your-brand-site.example.com" // placeholder — keep this file's real, existing href unchanged
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-[hsl(var(--muted-foreground))] leading-none hover:text-[hsl(var(--foreground))] transition-colors duration-150"
        >
          Hecho con amor por Racoon Devs
        </a>
      </div>
    </footer>
  );
}
```

Note what changed: the version + tip + credit link were three separate flex children of the footer before; now the tooltip button and the credit link are wrapped together in one `div className="flex items-center gap-3 shrink-0"` so they sit in the same right-hand cluster (each item's own `shrink-0`/`hover` classes were preserved, just moved onto the wrapper where redundant).

- [ ] **Step 2: Lint the file**

Run: `pnpm exec eslint packages/ui/src/components/BrandFooter.jsx`
Expected: no output (clean).

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/BrandFooter.jsx
git commit -m "feat(ui): add a bug-report icon+tooltip to BrandFooter"
```

---

### Task 2: Wire `activeModuleKey` into `BrandFooter` from `RunlyApp.jsx`

**Files:**
- Modify: `apps/desktop/src/app/RunlyApp.jsx:289`

- [ ] **Step 1: Update the `<BrandFooter>` call**

Find this exact line (context: it's the only `<BrandFooter` call in the file, right after the main scrollable content area, inside the same component that already computes `activeModule` and `moduleKeyFromPath` — see lines 133–143 of this same file for where those come from and how they're already passed to `<TopbarWithNetworkStatus activeModuleKey={activeModule?.key ?? moduleKeyFromPath} ...>` a bit further up):

```jsx
              <BrandFooter className="hidden lg:flex" editionName={RUNLY_EDITION_NAME} tip={helpTip} />
```

Replace with:

```jsx
              <BrandFooter
                className="hidden lg:flex"
                editionName={RUNLY_EDITION_NAME}
                tip={helpTip}
                activeModuleKey={activeModule?.key ?? moduleKeyFromPath}
              />
```

- [ ] **Step 2: Lint the file**

Run: `pnpm exec eslint apps/desktop/src/app/RunlyApp.jsx`
Expected: no output (clean).

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/app/RunlyApp.jsx
git commit -m "feat(ui): pass activeModuleKey into BrandFooter for bug-report context"
```

---

### Task 3: Mobile trigger in `UserMenu.jsx`

**Files:**
- Modify: `apps/desktop/src/components/UserMenu.jsx`

- [ ] **Step 1: Add the two new imports**

Find (top of file):

```jsx
import { ChevronDown, User, Settings, LogOut, Monitor, Download, X, Smartphone, Share, Sun, Moon, Activity, MessageSquare, Building2 } from "lucide-react";
```

Replace with (added `Bug` to the lucide-react import list):

```jsx
import { ChevronDown, User, Settings, LogOut, Monitor, Download, X, Smartphone, Share, Sun, Moon, Activity, MessageSquare, Building2, Bug } from "lucide-react";
```

Find:

```jsx
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@runly/ui";
```

Replace with (added `requestBugReport`):

```jsx
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  Avatar,
  AvatarFallback,
  AvatarImage,
  requestBugReport,
} from "@runly/ui";
```

- [ ] **Step 2: Add the `handleReportBug` function**

Find (inside the `UserMenu` component body, right after `handleDismissReminder`):

```jsx
  function handleDismissReminder(e) {
    e.stopPropagation();
    dismissDesktopReminder();
    setShowReminder(false);
  }
```

Add immediately after it:

```jsx

  function handleReportBug() {
    requestBugReport({
      context: activeModuleKey
        ? `${activeModuleKey} · ${window.location.pathname}`
        : window.location.pathname,
    });
  }
```

(`activeModuleKey` is already a destructured prop of `UserMenu` — see the function signature a few lines above, `export function UserMenu({ activeModuleKey = null, ... })`. No signature change needed.)

- [ ] **Step 3: Add the menu item**

Find the end of the component's dropdown content — the "Mostrar chat flotante" block immediately followed by the final logout separator+item:

```jsx
        {chatHubHidden && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={showChatHub} className="gap-2 cursor-pointer">
              <MessageSquare size={14} />
              Mostrar chat flotante
            </DropdownMenuItem>
          </>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => logout()}
          className="gap-2 cursor-pointer text-red-500 focus:text-red-500 focus:bg-red-500/10"
        >
          <LogOut size={14} />
          Cerrar sesión
        </DropdownMenuItem>
```

Insert a new block between them (breakpoint matches `BrandFooter`'s `hidden lg:flex` exactly, so the two triggers never overlap and no width is left without either):

```jsx
        {chatHubHidden && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={showChatHub} className="gap-2 cursor-pointer">
              <MessageSquare size={14} />
              Mostrar chat flotante
            </DropdownMenuItem>
          </>
        )}

        <div className="lg:hidden">
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleReportBug} className="gap-2 cursor-pointer">
            <Bug size={14} />
            Reportar un problema
          </DropdownMenuItem>
        </div>

        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => logout()}
          className="gap-2 cursor-pointer text-red-500 focus:text-red-500 focus:bg-red-500/10"
        >
          <LogOut size={14} />
          Cerrar sesión
        </DropdownMenuItem>
```

- [ ] **Step 4: Lint the file**

Run: `pnpm exec eslint apps/desktop/src/components/UserMenu.jsx`
Expected: no output (clean).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/components/UserMenu.jsx
git commit -m "feat(ui): add a mobile 'Reportar un problema' item to UserMenu"
```

---

### Task 4: Build and manual verification

**Files:** none (verification only)

- [ ] **Step 1: Build the desktop web bundle**

Run: `pnpm --filter @runly/desktop run build:web`
Expected: `✓ built in <N>s` with no errors (pre-existing "chunks larger than 500 kB" warnings are expected and unrelated).

- [ ] **Step 2: Start the dev server**

Run: `pnpm dev:frontend` (and `pnpm dev:api` in another terminal if not already running)

- [ ] **Step 3: Manual check — desktop breakpoint**

In a browser at `lg` width or wider (≥1024px):
1. Confirm a small `Bug` icon is visible in the bottom footer, immediately left of "Hecho con amor por Racoon Devs".
2. Hover it — confirm a tooltip reading "Reportar un problema" appears.
3. Click it — confirm the existing bug-report dialog opens, with a screenshot captured and no red error-message box shown (since no `errorMessage` was passed).
4. Cancel the dialog — confirm it closes cleanly with no console errors.

- [ ] **Step 4: Manual check — mobile breakpoint**

Resize the browser (or use device emulation) to below `lg` width (<1024px):
1. Confirm the footer icon from Step 3 is gone (the whole footer is hidden below `lg`, unchanged from before this plan).
2. Open the user avatar dropdown (top right). Confirm a "Reportar un problema" item is present, styled like the other items (e.g. "Chat", "Actividad").
3. Click it — confirm the same dialog opens identically to Step 3.3.

- [ ] **Step 5: Manual check — context string**

While on a module screen (e.g. navigate to any module route such as `/app/m/runly.core/module-builder`), trigger the dialog from either entry point and submit a report with a short test description. Confirm (via the configured `RUNLY_SUPPORT_EMAIL` inbox, or by checking API logs if SMTP isn't configured in this dev environment and the dialog shows the "not available" error) that the flow completes without a client-side error either way.

- [ ] **Step 6: Resize across the breakpoint live**

With the dropdown closed, slowly resize the browser window across 1024px width. Confirm exactly one of the two triggers (footer icon or menu item) is visible at every width — never both, never neither.

---

## Self-Review Notes

- **Spec coverage:** Goals 1–5 (§5) are each covered — Task 1 (desktop trigger), Task 3 (mobile trigger), Task 2 (context detection), and the "reuse existing pipeline unmodified" goal is structural (no backend/SDK file appears anywhere in this plan). Edge cases §23 items 1–5 are all exercised by Task 4's manual checks or are unconditionally true by construction (CSS-only breakpoint switch, existing bus/dialog code paths untouched). Acceptance criteria §25 items 1–7 map 1:1 onto Task 4's steps 3–6.
- **Placeholder scan:** none — every step shows the exact before/after code.
- **Type/name consistency:** `activeModuleKey` is the exact prop name already used by `UserMenu` (existing) and now also by `BrandFooter` (new, added in Task 1, wired in Task 2) and by `Topbar`'s existing `activeModuleKey={activeModule?.key ?? moduleKeyFromPath}` call — all three now share the identical source expression from `RunlyApp.jsx`. `requestBugReport` is imported the same way (`from "@runly/ui"`) in `UserMenu.jsx` as it already is by `ErrorState.jsx` (`from '../lib/bugReportBus.js'`, re-exported by `@runly/ui`'s `index.js`) — no naming drift.
