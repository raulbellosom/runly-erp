# Phase 2 — ERP Initialization State

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `GET /instance/status` endpoint and a frontend route guard that redirects fresh (uninitialized) instances to `/setup` and initialized instances to `/login`.

**Architecture:** The API reads the `InstanceConfig` key `initialized` from PostgreSQL via Prisma and returns `{ initialized: boolean }`. The frontend adds React Router v6 with an `InitGuard` component at `/` that fetches status via TanStack Query and redirects accordingly. Stub screens for `/setup` and `/login` are created as placeholders — Phase 3 and Phase 4 will replace them with real implementations.

**Tech Stack:** Hono, Prisma 6, React 19, React Router v6, TanStack Query v5

**Prerequisite:** Phase 1 must be complete (SSH tunnel open, `pnpm db:migrate` and `pnpm db:seed` run) before the API verification steps will work.

---

## File map

| File | Change |
|---|---|
| `apps/api/src/index.js` | Add `GET /instance/status` route after the `/health` route |
| `packages/sdk/src/index.js` | Add `instance.status()` method to the returned client object |
| `apps/desktop/package.json` | Add `react-router-dom` dependency |
| `apps/desktop/src/main.jsx` | Add `BrowserRouter`, `InitGuard`, `SetupPlaceholder`, `LoginPlaceholder`; move `Dashboard` to `/app` |

---

### Task 1: Add GET /instance/status to the API

**Files:**
- Modify: `apps/api/src/index.js` (add after line 28, after the `/health` handler)

- [ ] **Step 1: Add the route**

Open `apps/api/src/index.js`. After the `/health` handler block (ends at line 28), insert:

```js
app.get('/instance/status', async (c) => {
  const record = await prisma.instanceConfig.findUnique({ where: { key: 'initialized' } })
  return c.json({ initialized: record?.value === 'true' })
})
```

`prisma.instanceConfig` maps to the `InstanceConfig` model in `prisma/schema.prisma`. The `initialized` key stores the string `"true"` when the instance has been set up. If the key doesn't exist yet, the endpoint returns `{ initialized: false }`.

- [ ] **Step 2: Start the API and verify**

Open an SSH tunnel in a separate terminal (required for DB connection):
```bash
ssh -L 54322:db.internal.example:5432 deploy@192.0.2.10
```

Then start the API:
```bash
pnpm dev:api
```

In a third terminal, test the endpoint:
```bash
curl http://localhost:4010/instance/status
```

Expected output (no `initialized` key in DB yet):
```json
{"initialized":false}
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/index.js
git commit -m "feat: add GET /instance/status endpoint"
```

---

### Task 2: Add instance.status() to the SDK

**Files:**
- Modify: `packages/sdk/src/index.js`

- [ ] **Step 1: Add the instance domain to the returned client**

Open `packages/sdk/src/index.js`. Replace the entire `return { ... }` block (lines 14–29) with:

```js
  return {
    health: () => request('/health'),
    instance: {
      status: () => request('/instance/status')
    },
    modules: {
      list: () => request('/modules'),
      install: (manifest) => request('/modules/install', { method: 'POST', body: JSON.stringify({ manifest }) }),
      uninstall: (key) => request(`/modules/${encodeURIComponent(key)}`, { method: 'DELETE' })
    },
    blueprints: {
      list: () => request('/blueprints')
    },
    contacts: {
      list: () => request('/contacts'),
      create: (data) => request('/contacts', { method: 'POST', body: JSON.stringify(data) })
    }
  }
```

- [ ] **Step 2: Verify no syntax errors**

```bash
node --input-type=module --eval "import('./packages/sdk/src/index.js')"
```

Expected: no output (module imports cleanly with no errors).

- [ ] **Step 3: Commit**

```bash
git add packages/sdk/src/index.js
git commit -m "feat: add instance.status() to Atlas SDK"
```

---

### Task 3: Install react-router-dom

**Files:**
- Modify: `apps/desktop/package.json`

- [ ] **Step 1: Add the dependency**

```bash
pnpm --filter @atlas/desktop add react-router-dom
```

Expected: pnpm output showing `+ react-router-dom <version>` and a lockfile update.

- [ ] **Step 2: Verify package.json**

Open `apps/desktop/package.json`. The `dependencies` section must now contain a `react-router-dom` entry with a version string.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/package.json pnpm-lock.yaml
git commit -m "feat: add react-router-dom to desktop app"
```

---

### Task 4: Restructure main.jsx — router, InitGuard, stub screens

**Files:**
- Modify: `apps/desktop/src/main.jsx`

This task rewires the entire app entry point. The existing `Dashboard` component is preserved and moved to the `/app` route. Three new components are added: `InitGuard`, `SetupPlaceholder`, and `LoginPlaceholder`.

- [ ] **Step 1: Replace the full content of main.jsx**

Replace `apps/desktop/src/main.jsx` with:

```jsx
import { useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { createAtlasClient } from '@atlas/sdk'
import { AppShell, Card, CardContent, CardHeader, CardTitle, Button, Badge, Skeleton, Toaster, TooltipProvider } from '@atlas/ui'
import './styles.css'

const apiUrl = import.meta.env.VITE_ATLAS_API_URL || 'http://localhost:4010'
const atlas = createAtlasClient({ baseUrl: apiUrl })
const queryClient = new QueryClient()

function SetupPlaceholder() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 text-center p-8">
      <p className="text-xs font-medium uppercase tracking-[0.25em] text-[hsl(var(--muted-foreground))]">Atlas ERP</p>
      <h1 className="text-2xl font-semibold">Configuración inicial</h1>
      <p className="max-w-sm text-sm text-[hsl(var(--muted-foreground))]">
        Esta instancia aún no ha sido configurada. El asistente de configuración estará disponible próximamente.
      </p>
    </div>
  )
}

function LoginPlaceholder() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 text-center p-8">
      <p className="text-xs font-medium uppercase tracking-[0.25em] text-[hsl(var(--muted-foreground))]">Atlas ERP</p>
      <h1 className="text-2xl font-semibold">Iniciar sesión</h1>
      <p className="max-w-sm text-sm text-[hsl(var(--muted-foreground))]">
        Autenticación disponible próximamente.
      </p>
    </div>
  )
}

function InitGuard() {
  const navigate = useNavigate()
  const { data, isError } = useQuery({
    queryKey: ['instance-status'],
    queryFn: atlas.instance.status,
    retry: 1
  })

  useEffect(() => {
    if (!data) return
    navigate(data.initialized ? '/login' : '/setup', { replace: true })
  }, [data, navigate])

  if (isError) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-red-500">
        No se pudo conectar con el servidor. Verifica que la API esté corriendo.
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-[hsl(var(--muted-foreground))]">
      Cargando...
    </div>
  )
}

function Dashboard({ isDark, onThemeToggle }) {
  const modules = useQuery({ queryKey: ['modules'], queryFn: atlas.modules.list })
  const blueprints = useQuery({ queryKey: ['blueprints'], queryFn: atlas.blueprints.list })

  const navigation = [
    { label: 'Dashboard', path: '/app', icon: 'LayoutDashboard' },
    { label: 'Módulos', path: '/app/modules', icon: 'Puzzle' },
    { label: 'Contactos', path: '/app/contacts', icon: 'Contact' },
    { label: 'Finanzas', path: '/app/finance', icon: 'Wallet' },
    { label: 'Configuración', path: '/app/settings', icon: 'Settings' }
  ]

  return (
    <AppShell navigation={navigation} currentPath="/app" isDark={isDark} onThemeToggle={onThemeToggle}>
      <div className="p-6 space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.25em] text-[hsl(var(--muted-foreground))]">Atlas ERP</p>
            <h1 className="text-2xl font-semibold mt-1">Centro de mando</h1>
            <p className="mt-1.5 max-w-2xl text-sm text-[hsl(var(--muted-foreground))]">
              Base inicial para un ERP modular con mapas, blueprints, módulos core e instalación de módulos versionados.
            </p>
          </div>
          <Button onClick={() => modules.refetch()} variant="glass" size="sm">
            Actualizar
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                Módulos instalados
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {modules.isLoading
                ? <Skeleton className="h-8 w-16" />
                : <p className="text-3xl font-semibold">{modules.data?.data?.length ?? '-'}</p>
              }
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                Blueprints activos
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {blueprints.isLoading
                ? <Skeleton className="h-8 w-16" />
                : <p className="text-3xl font-semibold">{blueprints.data?.data?.length ?? '-'}</p>
              }
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                Estado API
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <Badge variant={modules.isError ? 'destructive' : 'success'}>
                {modules.isError ? 'Sin conexión' : 'Conectada'}
              </Badge>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Módulos</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {modules.isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
              </div>
            ) : (
              <div className="divide-y divide-[hsl(var(--border))]">
                {(modules.data?.data ?? []).map((module) => (
                  <div key={module.key} className="flex items-center justify-between py-3">
                    <div>
                      <p className="text-sm font-medium">{module.name}</p>
                      <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
                        {module.key} · v{module.version}
                      </p>
                    </div>
                    <Badge variant={module.core ? 'glass' : 'secondary'}>
                      {module.core ? 'Core' : module.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}

function App() {
  const [isDark, setIsDark] = useState(false)

  function handleThemeToggle() {
    setIsDark((d) => {
      document.documentElement.classList.toggle('dark', !d)
      return !d
    })
  }

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<InitGuard />} />
            <Route path="/setup" element={<SetupPlaceholder />} />
            <Route path="/login" element={<LoginPlaceholder />} />
            <Route path="/app" element={<Dashboard isDark={isDark} onThemeToggle={handleThemeToggle} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <Toaster />
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  )
}

createRoot(document.getElementById('root')).render(<App />)
```

- [ ] **Step 2: Start the full dev stack and verify**

SSH tunnel must be open. Then:

```bash
pnpm dev
```

Open `http://localhost:5173` in a browser.

**Test A — fresh instance (not initialized):**
Expected flow:
1. Browser lands on `/` — shows "Cargando..." briefly
2. `GET /instance/status` returns `{"initialized":false}`
3. Browser redirects to `http://localhost:5173/setup`
4. Page shows: "Configuración inicial" heading

**Test B — initialized instance:**
1. Open Prisma Studio (SSH tunnel required): `pnpm db:studio`
2. Go to the `InstanceConfig` table
3. Add row: `key = "initialized"`, `value = "true"` (leave other fields as defaults)
4. Hard-refresh `http://localhost:5173`
5. Browser redirects to `http://localhost:5173/login`
6. Page shows: "Iniciar sesión" heading
7. Clean up: delete the row in Prisma Studio (Phase 3 sets this for real)

**Test C — API not running:**
1. Stop the API (Ctrl+C on the `pnpm dev:api` process)
2. Hard-refresh `http://localhost:5173`
3. After 2 retry attempts, page shows: "No se pudo conectar con el servidor."

**Test D — dashboard still accessible:**
1. Navigate directly to `http://localhost:5173/app`
2. Dashboard loads normally (modules/blueprints list from API)

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/main.jsx
git commit -m "feat: add InitGuard, SetupPlaceholder, LoginPlaceholder (Phase 2)"
```

---

## Phase 2 complete

All four tasks done. Verification checklist:

- [ ] `GET /instance/status` returns `{"initialized":false}` when no record exists
- [ ] `GET /instance/status` returns `{"initialized":true}` when `InstanceConfig` key `initialized` = `"true"`
- [ ] `http://localhost:5173` redirects to `/setup` when not initialized
- [ ] `http://localhost:5173` redirects to `/login` when initialized
- [ ] API down shows error message in browser
- [ ] `/app` route still shows the Dashboard directly

Next: **Phase 3 — Onboarding setup wizard** (builds out the `/setup` route with the real 4-step configuration flow).
