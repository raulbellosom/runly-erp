# Phase 3 â€” Setup Wizard Implementation Plan

> Superseded in storage policy by Phase 7.1 (2026-05-04): canonical bucket is `atlas-files` for branding and files.


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `SetupPlaceholder` stub with a real 4-step onboarding wizard that creates the admin account, company, and branding config in a single atomic API call, then redirects to `/login`.

**Architecture:** A `POST /setup/initialize` endpoint handles the full initialization: creates a Supabase Auth user, runs a Prisma transaction for Company/UserProfile/Membership/BrandingConfig, writes InstanceConfig keys, and optionally uploads a logo to Supabase Storage. The frontend is a `SetupWizard` component with a left sidebar and 4 step components; all form state is accumulated in the wizard and submitted at step 4 via a single `useMutation`.

**Tech Stack:** Hono, Prisma 6, @supabase/supabase-js, React 19, React Router v7, TanStack Query v5, @atlas/ui

**Prerequisite:** SSH tunnel must be open (`ssh -L 54322:db.internal.example:5432 deploy@192.0.2.10`) before running any Prisma command.

---

## File map

| File | Change |
|---|---|
| `prisma/schema.prisma` | Add `BrandingConfig` model; add back-relation to `Company` |
| `packages/validators/src/index.js` | Add `setupInitializeSchema` |
| `packages/sdk/src/index.js` | Fix `request` for FormData; add `setup.initialize()` |
| `apps/api/package.json` | Add `@supabase/supabase-js` dependency |
| `apps/api/src/index.js` | Add `POST /setup/initialize` route |
| `apps/desktop/src/setup/SetupWizard.jsx` | Create â€” wizard shell, sidebar, step routing |
| `apps/desktop/src/setup/StepAdmin.jsx` | Create â€” step 1 form |
| `apps/desktop/src/setup/StepCompany.jsx` | Create â€” step 2 form |
| `apps/desktop/src/setup/StepBranding.jsx` | Create â€” step 3 form |
| `apps/desktop/src/setup/StepReview.jsx` | Create â€” step 4 summary + submit |
| `apps/desktop/src/main.jsx` | Replace `SetupPlaceholder` import/component with `SetupWizard` |

---

### Task 1: Add BrandingConfig to Prisma schema and migrate

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add BrandingConfig model and Company back-relation**

Open `prisma/schema.prisma`. After the `Company` model (line 98), insert the back-relation field. Also add the new model at the end of the file before the closing.

Replace the `Company` model:
```prisma
model Company {
  id             String          @id @default(uuid(7))
  name           String
  slug           String          @unique
  enabled        Boolean         @default(true)
  createdAt      DateTime        @default(now())
  updatedAt      DateTime        @updatedAt

  memberships    Membership[]
  brandingConfig BrandingConfig?
}
```

Then append the `BrandingConfig` model at the end of `prisma/schema.prisma` (after `InstanceConfig`):
```prisma
model BrandingConfig {
  id           String   @id @default(uuid(7))
  companyId    String   @unique
  primaryColor String
  logoFileId   String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  company      Company  @relation(fields: [companyId], references: [id], onDelete: Cascade)
}
```

- [ ] **Step 2: Run migration (SSH tunnel must be open)**

```bash
npx prisma migrate dev --name add_branding_config
```

Expected output: `âœ” Generated Prisma Client` and a new file in `prisma/migrations/`.

- [ ] **Step 3: Regenerate Prisma client**

```bash
pnpm db:generate
```

Expected: no errors. `BrandingConfig` is now accessible as `prisma.brandingConfig`.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add BrandingConfig model and migration"
```

---

### Task 2: Add setupInitializeSchema to validators

**Files:**
- Modify: `packages/validators/src/index.js`

- [ ] **Step 1: Add the schema**

Open `packages/validators/src/index.js`. Append at the end:

```js
export const setupInitializeSchema = z.object({
  adminDisplayName: z.string().min(2),
  adminEmail: z.string().email(),
  adminPassword: z.string().min(8),
  companyName: z.string().min(2),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/)
})
```

- [ ] **Step 2: Verify no syntax errors**

```bash
node --input-type=module --eval "import('./packages/validators/src/index.js').then(m => console.log(Object.keys(m)))"
```

Expected output (order may vary):
```
[ 'moduleInstallSchema', 'contactCreateSchema', 'setupInitializeSchema' ]
```

- [ ] **Step 3: Commit**

```bash
git add packages/validators/src/index.js
git commit -m "feat: add setupInitializeSchema to validators"
```

---

### Task 3: Update SDK â€” FormData support and setup.initialize()

**Files:**
- Modify: `packages/sdk/src/index.js`

The `request` function currently sets `Content-Type: application/json` unconditionally. This breaks multipart FormData uploads (the browser must set the boundary). Fix it, then add the `setup` domain.

- [ ] **Step 1: Replace the full file content**

Replace `packages/sdk/src/index.js` with:

```js
export function createAtlasClient({ baseUrl }) {
  async function request(path, options = {}) {
    const isFormData = options.body instanceof FormData
    const response = await fetch(`${baseUrl}${path}`, {
      headers: isFormData
        ? (options.headers ?? {})
        : { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
      ...options
    })
    if (!response.ok) {
      const text = await response.text()
      throw new Error(text || `Atlas API error ${response.status}`)
    }
    return response.json()
  }

  return {
    health: () => request('/health'),
    instance: {
      status: () => request('/instance/status')
    },
    setup: {
      initialize: (formData) => request('/setup/initialize', { method: 'POST', body: formData })
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
}
```

- [ ] **Step 2: Verify no syntax errors**

```bash
node --input-type=module --eval "import('./packages/sdk/src/index.js')"
```

Expected: no output (clean import).

- [ ] **Step 3: Commit**

```bash
git add packages/sdk/src/index.js
git commit -m "feat: add setup.initialize() to SDK and fix FormData Content-Type"
```

---

### Task 4: Install @supabase/supabase-js in the API

**Files:**
- Modify: `apps/api/package.json`

- [ ] **Step 1: Install the package**

```bash
pnpm --filter @atlas/api add @supabase/supabase-js
```

Expected: pnpm output showing `+ @supabase/supabase-js <version>`.

- [ ] **Step 2: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml
git commit -m "feat: add @supabase/supabase-js to API"
```

---

### Task 5: Add POST /setup/initialize to the API

**Files:**
- Modify: `apps/api/src/index.js`

This task adds the initialization endpoint. It uses Hono's `c.req.parseBody()` for multipart, Supabase Admin SDK for auth user creation and logo upload, and a Prisma transaction for all data.

- [ ] **Step 1: Add imports and Supabase admin client**

Open `apps/api/src/index.js`. Replace the import block and top-level constants (lines 1â€“11) with:

```js
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import pkg from '@prisma/client'
const { PrismaClient } = pkg
import { createClient } from '@supabase/supabase-js'
import { moduleInstallSchema, contactCreateSchema, setupInitializeSchema } from '@atlas/validators'
import { formatLogTimestamp, getConfiguredTimeZone } from '@atlas/core'

const prisma = new PrismaClient()
const app = new Hono()
const port = Number(process.env.ATLAS_API_PORT ?? 4010)

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

function toSlug(name) {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-+|-+$/g, '')
}

async function ensureBuckets() {
  await supabaseAdmin.storage.createBucket('atlas-branding', { public: false }).catch(() => {})
}
ensureBuckets()
```

- [ ] **Step 2: Add the POST /setup/initialize route**

After the `GET /instance/status` handler (after line 37 in the current file â€” the closing `})`), insert:

```js
app.post('/setup/initialize', async (c) => {
  try {
    const existing = await prisma.instanceConfig.findUnique({ where: { key: 'initialized' } })
    if (existing?.value === 'true') {
      return c.json({ error: 'Already initialized' }, 409)
    }

    const body = await c.req.parseBody()
    const fields = setupInitializeSchema.parse({
      adminDisplayName: body.adminDisplayName,
      adminEmail: body.adminEmail,
      adminPassword: body.adminPassword,
      companyName: body.companyName,
      primaryColor: body.primaryColor
    })

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: fields.adminEmail,
      password: fields.adminPassword,
      email_confirm: true
    })
    if (authError) return c.json({ error: authError.message }, 400)
    const authUserId = authData.user.id

    let logoFileAssetId = null
    const logoFile = body.logo
    if (logoFile && logoFile instanceof File && logoFile.size > 0) {
      if (logoFile.size > 2 * 1024 * 1024) {
        await supabaseAdmin.auth.admin.deleteUser(authUserId)
        return c.json({ error: 'Logo must be under 2 MB' }, 400)
      }
      const slug = toSlug(fields.companyName)
      const ext = logoFile.name.split('.').pop() || 'png'
      const objectKey = `logos/${slug}.${ext}`
      const arrayBuffer = await logoFile.arrayBuffer()
      const { error: storageError } = await supabaseAdmin.storage
        .from('atlas-branding')
        .upload(objectKey, arrayBuffer, { contentType: logoFile.type, upsert: true })
      if (storageError) {
        await supabaseAdmin.auth.admin.deleteUser(authUserId)
        return c.json({ error: 'Logo upload failed' }, 500)
      }
      const fileAsset = await prisma.fileAsset.create({
        data: {
          bucket: 'atlas-branding',
          objectKey,
          originalName: logoFile.name,
          mimeType: logoFile.type,
          sizeBytes: logoFile.size,
          moduleKey: 'atlas.branding',
          entityType: 'BrandingConfig'
        }
      })
      logoFileAssetId = fileAsset.id
    }

    try {
      const slug = toSlug(fields.companyName)
      const adminRole = await prisma.role.findFirst({ where: { key: 'atlas.admin' } })
      const now = new Date().toISOString()

      await prisma.$transaction(async (tx) => {
        const company = await tx.company.create({
          data: { name: fields.companyName, slug }
        })
        const userProfile = await tx.userProfile.create({
          data: { authUserId, displayName: fields.adminDisplayName, email: fields.adminEmail }
        })
        await tx.membership.create({
          data: { companyId: company.id, userId: userProfile.id, roleId: adminRole?.id ?? null }
        })
        await tx.brandingConfig.create({
          data: { companyId: company.id, primaryColor: fields.primaryColor, logoFileId: logoFileAssetId }
        })
        await tx.instanceConfig.upsert({
          where: { key: 'initialized' }, update: { value: 'true' }, create: { key: 'initialized', value: 'true' }
        })
        await tx.instanceConfig.upsert({
          where: { key: 'company_id' }, update: { value: company.id }, create: { key: 'company_id', value: company.id }
        })
        await tx.instanceConfig.upsert({
          where: { key: 'completed_at' }, update: { value: now }, create: { key: 'completed_at', value: now }
        })
      })

      return c.json({ ok: true })
    } catch (txError) {
      await supabaseAdmin.auth.admin.deleteUser(authUserId)
      throw txError
    }
  } catch (err) {
    if (err?.name === 'ZodError') return c.json({ error: err.errors[0]?.message ?? 'Validation error' }, 400)
    return c.json({ error: 'Initialization failed' }, 500)
  }
})
```

- [ ] **Step 3: Start the API and verify the endpoint exists**

SSH tunnel must be open. Start the API:
```bash
pnpm dev:api
```

Test with a missing-field request (should return 400, not 404):
```bash
curl -s -X POST http://localhost:4010/setup/initialize | head -c 200
```

Expected: JSON error response (validation error or similar), NOT `{"message":"Not Found"}`.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/index.js
git commit -m "feat: add POST /setup/initialize endpoint"
```

---

### Task 6: Create SetupWizard shell and update main.jsx

**Files:**
- Create: `apps/desktop/src/setup/SetupWizard.jsx`
- Modify: `apps/desktop/src/main.jsx`

- [ ] **Step 1: Create apps/desktop/src/setup/SetupWizard.jsx**

```jsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createAtlasClient } from '@atlas/sdk'
import { StepAdmin } from './StepAdmin'
import { StepCompany } from './StepCompany'
import { StepBranding } from './StepBranding'
import { StepReview } from './StepReview'

const apiUrl = import.meta.env.VITE_ATLAS_API_URL || 'http://localhost:4010'
const atlas = createAtlasClient({ baseUrl: apiUrl })

const STEPS = [
  { label: 'Cuenta admin', subtitle: 'Nombre, email, contraseÃ±a' },
  { label: 'Empresa', subtitle: 'Nombre de la empresa' },
  { label: 'Marca', subtitle: 'Logo y color principal' },
  { label: 'Revisar', subtitle: 'Confirmar e inicializar' }
]

export function SetupWizard() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [step, setStep] = useState(0)
  const [formData, setFormData] = useState({
    adminDisplayName: '',
    adminEmail: '',
    adminPassword: '',
    adminConfirmPassword: '',
    companyName: '',
    primaryColor: '#6366f1',
    logo: null
  })

  function handleChange(patch) {
    setFormData(prev => ({ ...prev, ...patch }))
  }

  const mutation = useMutation({
    mutationFn: () => {
      const fd = new FormData()
      fd.append('adminDisplayName', formData.adminDisplayName)
      fd.append('adminEmail', formData.adminEmail)
      fd.append('adminPassword', formData.adminPassword)
      fd.append('companyName', formData.companyName)
      fd.append('primaryColor', formData.primaryColor)
      if (formData.logo) fd.append('logo', formData.logo)
      return atlas.setup.initialize(fd)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instance-status'] })
      navigate('/login', { replace: true })
    }
  })

  const stepProps = {
    data: formData,
    onChange: handleChange,
    onNext: () => setStep(s => s + 1),
    onBack: () => setStep(s => s - 1)
  }

  return (
    <div className="flex min-h-screen bg-[hsl(var(--background))]">
      <div className="w-56 bg-[hsl(var(--card))] border-r border-[hsl(var(--border))] p-6 flex flex-col shrink-0">
        <div className="mb-8">
          <p className="text-xs font-medium uppercase tracking-[0.15em] text-[hsl(var(--muted-foreground))]">Atlas ERP</p>
          <p className="text-sm font-semibold mt-1">ConfiguraciÃ³n inicial</p>
        </div>
        <div className="flex flex-col">
          {STEPS.map((s, i) => (
            <div key={i}>
              <div className={`flex items-start gap-2.5 ${i !== step ? 'opacity-40' : ''}`}>
                <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 text-[11px] font-semibold ${
                  i < step
                    ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
                    : i === step
                    ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
                    : 'border-2 border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]'
                }`}>
                  {i < step ? 'âœ“' : i + 1}
                </div>
                <div>
                  <p className="text-xs font-medium">{s.label}</p>
                  <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-0.5">{s.subtitle}</p>
                </div>
              </div>
              {i < STEPS.length - 1 && (
                <div className="w-px h-4 bg-[hsl(var(--border))] ml-2.5 my-1" />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 p-10" style={{ maxWidth: '480px' }}>
        {step === 0 && <StepAdmin {...stepProps} />}
        {step === 1 && <StepCompany {...stepProps} />}
        {step === 2 && <StepBranding {...stepProps} />}
        {step === 3 && (
          <StepReview
            data={formData}
            onBack={() => setStep(2)}
            onSubmit={() => mutation.mutate()}
            isPending={mutation.isPending}
            error={mutation.error?.message}
          />
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Update main.jsx â€” replace SetupPlaceholder with SetupWizard**

Open `apps/desktop/src/main.jsx`. Remove the `SetupPlaceholder` function entirely (lines 13â€“23). Add an import for `SetupWizard` near the top, after the existing imports:

```js
import { SetupWizard } from './setup/SetupWizard'
```

Then change the `/setup` route from:
```jsx
<Route path="/setup" element={<SetupPlaceholder />} />
```
to:
```jsx
<Route path="/setup" element={<SetupWizard />} />
```

- [ ] **Step 3: Start dev servers and verify the wizard shell renders**

SSH tunnel must be open. Then:
```bash
pnpm dev
```

Open `http://localhost:5173`. The InitGuard redirects to `/setup`. Expected: the wizard renders with the left sidebar showing 4 steps. Step 1 is highlighted. The right panel is empty (StepAdmin doesn't exist yet â€” if you see a blank right panel or a "StepAdmin is not defined" error in the browser console, that's expected until Task 7).

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/setup/SetupWizard.jsx apps/desktop/src/main.jsx
git commit -m "feat: add SetupWizard shell and wire to /setup route"
```

---

### Task 7: Create StepAdmin

**Files:**
- Create: `apps/desktop/src/setup/StepAdmin.jsx`

- [ ] **Step 1: Create the file**

```jsx
import { useState } from 'react'
import { Button, Input, Label } from '@atlas/ui'

export function StepAdmin({ data, onChange, onNext }) {
  const [errors, setErrors] = useState({})

  function validate() {
    const e = {}
    if (!data.adminDisplayName || data.adminDisplayName.length < 2)
      e.adminDisplayName = 'MÃ­nimo 2 caracteres'
    if (!data.adminEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.adminEmail))
      e.adminEmail = 'Correo invÃ¡lido'
    if (!data.adminPassword || data.adminPassword.length < 8)
      e.adminPassword = 'MÃ­nimo 8 caracteres'
    if (data.adminPassword !== data.adminConfirmPassword)
      e.adminConfirmPassword = 'Las contraseÃ±as no coinciden'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  return (
    <div className="flex flex-col h-full justify-between">
      <div>
        <h2 className="text-lg font-semibold">Cuenta de administrador</h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1 mb-6">
          Esta serÃ¡ la cuenta principal del sistema.
        </p>
        <div className="space-y-4">
          <div>
            <Label htmlFor="displayName">Nombre completo</Label>
            <Input
              id="displayName"
              value={data.adminDisplayName}
              onChange={e => onChange({ adminDisplayName: e.target.value })}
              placeholder="MarÃ­a GarcÃ­a"
            />
            {errors.adminDisplayName && (
              <p className="text-xs text-red-500 mt-1">{errors.adminDisplayName}</p>
            )}
          </div>
          <div>
            <Label htmlFor="email">Correo electrÃ³nico</Label>
            <Input
              id="email"
              type="email"
              value={data.adminEmail}
              onChange={e => onChange({ adminEmail: e.target.value })}
              placeholder="admin@empresa.com"
            />
            {errors.adminEmail && (
              <p className="text-xs text-red-500 mt-1">{errors.adminEmail}</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="password">ContraseÃ±a</Label>
              <Input
                id="password"
                type="password"
                value={data.adminPassword}
                onChange={e => onChange({ adminPassword: e.target.value })}
              />
              {errors.adminPassword && (
                <p className="text-xs text-red-500 mt-1">{errors.adminPassword}</p>
              )}
            </div>
            <div>
              <Label htmlFor="confirmPassword">Confirmar</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={data.adminConfirmPassword}
                onChange={e => onChange({ adminConfirmPassword: e.target.value })}
              />
              {errors.adminConfirmPassword && (
                <p className="text-xs text-red-500 mt-1">{errors.adminConfirmPassword}</p>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="flex justify-end pt-4 mt-4 border-t border-[hsl(var(--border))]">
        <Button onClick={() => { if (validate()) onNext() }}>Siguiente â†’</Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify in browser**

Reload `http://localhost:5173` (or navigate to `/setup`). Expected: Step 1 form renders with display name, email, password, confirm password fields. Clicking "Siguiente" without filling in valid data shows inline error messages. Filling all fields correctly advances to step 2 (blank until Task 8).

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/setup/StepAdmin.jsx
git commit -m "feat: add StepAdmin (setup wizard step 1)"
```

---

### Task 8: Create StepCompany

**Files:**
- Create: `apps/desktop/src/setup/StepCompany.jsx`

- [ ] **Step 1: Create the file**

```jsx
import { useState } from 'react'
import { Button, Input, Label } from '@atlas/ui'

export function StepCompany({ data, onChange, onNext, onBack }) {
  const [errors, setErrors] = useState({})

  const slug = data.companyName
    ? data.companyName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-+|-+$/g, '')
    : ''

  function validate() {
    const e = {}
    if (!data.companyName || data.companyName.length < 2)
      e.companyName = 'MÃ­nimo 2 caracteres'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  return (
    <div className="flex flex-col h-full justify-between">
      <div>
        <h2 className="text-lg font-semibold">Empresa</h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1 mb-6">
          InformaciÃ³n de la organizaciÃ³n.
        </p>
        <div className="space-y-4">
          <div>
            <Label htmlFor="companyName">Nombre de la empresa</Label>
            <Input
              id="companyName"
              value={data.companyName}
              onChange={e => onChange({ companyName: e.target.value })}
              placeholder="Acme S.A. de C.V."
            />
            {errors.companyName && (
              <p className="text-xs text-red-500 mt-1">{errors.companyName}</p>
            )}
            {slug && (
              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                Identificador: {slug}
              </p>
            )}
          </div>
        </div>
      </div>
      <div className="flex justify-between pt-4 mt-4 border-t border-[hsl(var(--border))]">
        <Button variant="outline" onClick={onBack}>â† AtrÃ¡s</Button>
        <Button onClick={() => { if (validate()) onNext() }}>Siguiente â†’</Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify in browser**

Navigate to `/setup`, complete step 1, advance to step 2. Expected: company name field renders. Typing a name shows the auto-generated slug below the input. "AtrÃ¡s" goes back to step 1 without losing data. "Siguiente" advances to step 3 (blank until Task 9).

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/setup/StepCompany.jsx
git commit -m "feat: add StepCompany (setup wizard step 2)"
```

---

### Task 9: Create StepBranding

**Files:**
- Create: `apps/desktop/src/setup/StepBranding.jsx`

- [ ] **Step 1: Create the file**

```jsx
import { useState } from 'react'
import { Button, Label } from '@atlas/ui'

export function StepBranding({ data, onChange, onNext, onBack }) {
  const [logoError, setLogoError] = useState('')

  function handleLogoChange(e) {
    const file = e.target.files[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) {
      setLogoError('El archivo no puede superar 2 MB')
      return
    }
    setLogoError('')
    onChange({ logo: file })
  }

  return (
    <div className="flex flex-col h-full justify-between">
      <div>
        <h2 className="text-lg font-semibold">Marca</h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1 mb-6">
          PersonalizaciÃ³n visual de la instancia.
        </p>
        <div className="space-y-4">
          <div>
            <Label htmlFor="primaryColor">Color principal</Label>
            <div className="flex items-center gap-3 mt-1">
              <input
                id="primaryColor"
                type="color"
                value={data.primaryColor}
                onChange={e => onChange({ primaryColor: e.target.value })}
                className="w-10 h-10 rounded cursor-pointer border border-[hsl(var(--border))]"
              />
              <span className="text-sm font-mono text-[hsl(var(--muted-foreground))]">
                {data.primaryColor}
              </span>
            </div>
          </div>
          <div>
            <Label htmlFor="logo">
              Logotipo{' '}
              <span className="text-[hsl(var(--muted-foreground))] font-normal">(opcional)</span>
            </Label>
            <input
              id="logo"
              type="file"
              accept="image/*"
              onChange={handleLogoChange}
              className="mt-1 block text-sm text-[hsl(var(--muted-foreground))] file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:bg-[hsl(var(--muted))] file:text-[hsl(var(--foreground))] hover:file:bg-[hsl(var(--accent))]"
            />
            {logoError && <p className="text-xs text-red-500 mt-1">{logoError}</p>}
            {data.logo && (
              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">{data.logo.name}</p>
            )}
          </div>
        </div>
      </div>
      <div className="flex justify-between pt-4 mt-4 border-t border-[hsl(var(--border))]">
        <Button variant="outline" onClick={onBack}>â† AtrÃ¡s</Button>
        <Button onClick={onNext}>Siguiente â†’</Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify in browser**

Navigate through steps 1â€“2, reach step 3. Expected: color picker renders with `#6366f1` as default. Picking a new color updates the hex label live. File input accepts images only; selecting a file over 2 MB shows the error. "Siguiente" advances to step 4 (blank until Task 10).

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/setup/StepBranding.jsx
git commit -m "feat: add StepBranding (setup wizard step 3)"
```

---

### Task 10: Create StepReview and complete end-to-end flow

**Files:**
- Create: `apps/desktop/src/setup/StepReview.jsx`

- [ ] **Step 1: Create the file**

```jsx
import { Button } from '@atlas/ui'

export function StepReview({ data, onBack, onSubmit, isPending, error }) {
  const alreadyInitialized = error && (error.includes('Already initialized') || error.includes('already initialized'))

  return (
    <div className="flex flex-col h-full justify-between">
      <div>
        <h2 className="text-lg font-semibold">Revisar y confirmar</h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1 mb-6">
          Verifica los datos antes de inicializar.
        </p>
        <div className="space-y-0 text-sm divide-y divide-[hsl(var(--border))]">
          <div className="grid grid-cols-2 gap-2 py-2.5">
            <span className="text-[hsl(var(--muted-foreground))]">Administrador</span>
            <span>{data.adminDisplayName}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 py-2.5">
            <span className="text-[hsl(var(--muted-foreground))]">Correo</span>
            <span>{data.adminEmail}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 py-2.5">
            <span className="text-[hsl(var(--muted-foreground))]">Empresa</span>
            <span>{data.companyName}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 py-2.5">
            <span className="text-[hsl(var(--muted-foreground))]">Color principal</span>
            <span className="flex items-center gap-2">
              <span
                className="inline-block w-4 h-4 rounded border border-[hsl(var(--border))]"
                style={{ background: data.primaryColor }}
              />
              <span className="font-mono">{data.primaryColor}</span>
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 py-2.5">
            <span className="text-[hsl(var(--muted-foreground))]">Logotipo</span>
            <span>{data.logo ? data.logo.name : 'Sin logotipo'}</span>
          </div>
        </div>

        {error && (
          <div className="mt-4 p-3 rounded bg-red-500/10 text-red-500 text-sm">
            {alreadyInitialized
              ? 'Esta instancia ya fue configurada.'
              : `Error al inicializar: ${error}`}
          </div>
        )}
      </div>

      <div className="flex justify-between pt-4 mt-4 border-t border-[hsl(var(--border))]">
        <Button variant="outline" onClick={onBack} disabled={isPending}>
          â† AtrÃ¡s
        </Button>
        <Button onClick={onSubmit} disabled={isPending}>
          {isPending ? 'Inicializando...' : 'Inicializar'}
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Full end-to-end test â€” happy path**

SSH tunnel must be open. Start both servers:
```bash
pnpm dev
```

Open `http://localhost:5173`. Complete all 4 steps with valid data:
- Step 1: any display name (â‰¥2 chars), valid email, password â‰¥8 chars
- Step 2: any company name (â‰¥2 chars)
- Step 3: pick any color (default is fine), logo is optional
- Step 4: click "Inicializar"

Expected:
1. Button shows "Inicializando..." briefly
2. Browser navigates to `/login`
3. The `LoginPlaceholder` renders ("Iniciar sesiÃ³n")
4. Refreshing `/` no longer redirects to `/setup` â€” it goes to `/login` (initialized = true)

- [ ] **Step 3: Verify in the database**

```bash
pnpm db:studio
```

Open `http://localhost:5555`. Check:
- `InstanceConfig` table: rows for `initialized = "true"`, `company_id`, `completed_at`
- `Company` table: one row with the name and slug you entered
- `UserProfile` table: one row with your email and display name
- `Membership` table: one row linking company + user
- `BrandingConfig` table: one row with your primaryColor

- [ ] **Step 4: Test â€” already initialized guard**

With the instance now initialized, try submitting the wizard again via curl:
```bash
curl -s -X POST http://localhost:4010/setup/initialize \
  -F "adminDisplayName=Test" \
  -F "adminEmail=test2@test.com" \
  -F "adminPassword=password123" \
  -F "companyName=Test Co" \
  -F "primaryColor=#ff0000"
```

Expected:
```json
{"error":"Already initialized"}
```
HTTP status 409.

- [ ] **Step 5: Clean up test data before Phase 4**

In Prisma Studio (`pnpm db:studio`):
1. Delete rows from `BrandingConfig`
2. Delete rows from `Membership`
3. Delete rows from `UserProfile`
4. Delete rows from `Company`
5. Delete all `InstanceConfig` rows (`initialized`, `company_id`, `completed_at`)

Also delete the Supabase Auth user via Supabase Studio at `https://studio.supabase.example.com` â†’ Authentication â†’ Users.

This resets the instance for Phase 4 testing.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/setup/StepReview.jsx
git commit -m "feat: add StepReview and complete Phase 3 setup wizard"
```

---

## Phase 3 complete

Verification checklist:
- [ ] `BrandingConfig` table exists in DB with correct columns
- [ ] `POST /setup/initialize` returns 409 when already initialized
- [ ] `POST /setup/initialize` creates Company, UserProfile, Membership, BrandingConfig in one transaction
- [ ] Wizard steps 1â€“3 validate their fields before advancing
- [ ] Step 4 shows a readable summary of all entered data
- [ ] Clicking "Inicializar" on step 4 submits, navigates to `/login` on success
- [ ] `/` redirects to `/login` after setup completes (InitGuard reads new InstanceConfig state)
- [ ] Logo upload is optional â€” wizard completes without one

Next: **Phase 4 â€” Auth integration** (real login screen, Supabase Auth signInWithPassword, JWT middleware).


