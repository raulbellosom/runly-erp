# Atlas Storefront SDK — Plan A: Backend API

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the public `/public/storefront/` API surface the SDK needs: storefront auth (register/login/me/logout/refresh), file uploads to a public bucket, and realtime config endpoint.

**Architecture:** A new Hono router factory (`createStorefrontRouter`) is mounted at `/public/storefront` in `index.js`. All business logic lives in service files, keeping routes thin. A `storefrontAuthMiddleware` validates storefront JWTs and enforces role-based access, separate from the existing admin `authMiddleware`.

**Tech Stack:** Hono, Prisma, Supabase Auth (admin + anon clients), Supabase Storage, Node.js built-in test runner.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `apps/api/src/routes/storefront/storefront-router.js` | Hono router factory, mounts sub-routers |
| Create | `apps/api/src/routes/storefront/storefront-middleware.js` | `storefrontAuthMiddleware` |
| Create | `apps/api/src/routes/storefront/storefront-auth-routes.js` | Thin auth route handlers |
| Create | `apps/api/src/routes/storefront/storefront-files-routes.js` | Thin files route handlers |
| Create | `apps/api/src/routes/storefront/storefront-config-routes.js` | Realtime config + tenant config |
| Create | `apps/api/src/services/storefront-auth-service.js` | register, login, me, refresh, logout logic |
| Create | `apps/api/src/services/storefront-files-service.js` | upload, getUrl, delete logic |
| Create | `apps/api/src/services/__tests__/storefront-auth-service.test.js` | Unit tests for pure logic |
| Create | `apps/api/src/services/__tests__/storefront-files-service.test.js` | Unit tests for pure logic |
| Modify | `apps/api/src/index.js` | Add `supabaseAnon`, import and mount storefront router |
| Modify | `prisma/seed.js` | Seed `storefront_client`/`storefront_vendor` roles + registrable_roles config |

---

### Task 1: Seed storefront roles and registrable_roles config

**Files:**
- Modify: `prisma/seed.js`

- [ ] **Step 1: Add storefront roles and config to seed.js**

Open `prisma/seed.js`. Find the section that seeds roles (look for `prisma.role.upsert`). Add after the existing role seeding:

```js
// Storefront roles
for (const roleData of [
  { key: 'storefront_client', name: 'Cliente (Storefront)', description: 'Usuario final registrado desde una app externa', system: true },
  { key: 'storefront_vendor', name: 'Vendedor (Storefront)', description: 'Proveedor registrado desde una app externa', system: true },
]) {
  await prisma.role.upsert({
    where: { key: roleData.key },
    update: { name: roleData.name, description: roleData.description },
    create: roleData,
  })
}

// Storefront registrable roles config
await prisma.instanceConfig.upsert({
  where: { key: 'storefront.registrable_roles' },
  update: {},
  create: {
    key: 'storefront.registrable_roles',
    value: JSON.stringify(['storefront_client', 'storefront_vendor']),
  },
})
```

- [ ] **Step 2: Run seed and verify**

```bash
node prisma/seed.js
```

Expected output includes `Atlas modules seeded (13)` with no errors. Then verify with:

```bash
node --input-type=module <<'EOF'
import { config as loadEnv } from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
loadEnv({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '.env') })
import pkg from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
const { PrismaClient } = pkg
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
const roles = await prisma.role.findMany({ where: { key: { in: ['storefront_client', 'storefront_vendor'] } } })
const config = await prisma.instanceConfig.findUnique({ where: { key: 'storefront.registrable_roles' } })
console.log('Roles:', roles.map(r => r.key))
console.log('Config:', config?.value)
await prisma.$disconnect()
EOF
```

Expected:
```
Roles: [ 'storefront_client', 'storefront_vendor' ]
Config: ["storefront_client","storefront_vendor"]
```

- [ ] **Step 3: Commit**

```bash
git add prisma/seed.js
git commit -m "feat(storefront): seed storefront_client, storefront_vendor roles and registrable_roles config"
```

---

### Task 2: Create atlas-storefront public Supabase bucket

**Files:** No code — infrastructure step.

- [ ] **Step 1: Create the bucket via Supabase Studio**

Go to https://studio.supabase.example.com → Storage → New bucket.

- Name: `atlas-storefront`
- Public: **ON**
- File size limit: 100 MB
- Allowed MIME types: `image/*,audio/*,video/*,application/pdf`

- [ ] **Step 2: Add bucket constant to index.js**

Open `apps/api/src/index.js`. Find the line:
```js
const STORAGE_BUCKET_NAME = "atlas-files";
```

Add below it:
```js
const STOREFRONT_BUCKET_NAME = "atlas-storefront";
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/index.js
git commit -m "feat(storefront): add STOREFRONT_BUCKET_NAME constant, create atlas-storefront bucket"
```

---

### Task 3: Add supabaseAnon client to index.js

**Files:**
- Modify: `apps/api/src/index.js`

The storefront login flow requires signing in as the user (not as service role). This needs the Supabase anon key client.

- [ ] **Step 1: Add supabaseAnon after supabaseAdmin**

Open `apps/api/src/index.js`. Find:
```js
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);
```

Add immediately after:
```js
const supabaseAnon = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
);
```

- [ ] **Step 2: Verify syntax**

```bash
node --check apps/api/src/index.js && echo "OK"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/index.js
git commit -m "feat(storefront): add supabaseAnon client for storefront user authentication"
```

---

### Task 4: Storefront auth service

**Files:**
- Create: `apps/api/src/services/storefront-auth-service.js`
- Create: `apps/api/src/services/__tests__/storefront-auth-service.test.js`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/services/__tests__/storefront-auth-service.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { validateRegistrableRole, buildStorefrontUserProfile } from '../storefront-auth-service.js'

describe('validateRegistrableRole', () => {
  it('returns true when role is in the allowed list', () => {
    const allowed = ['storefront_client', 'storefront_vendor']
    assert.equal(validateRegistrableRole('storefront_client', allowed), true)
    assert.equal(validateRegistrableRole('storefront_vendor', allowed), true)
  })

  it('returns false when role is not in the allowed list', () => {
    const allowed = ['storefront_client', 'storefront_vendor']
    assert.equal(validateRegistrableRole('admin', allowed), false)
    assert.equal(validateRegistrableRole('owner', allowed), false)
    assert.equal(validateRegistrableRole('', allowed), false)
  })

  it('returns false when allowed list is empty', () => {
    assert.equal(validateRegistrableRole('storefront_client', []), false)
  })
})

describe('buildStorefrontUserProfile', () => {
  it('maps a UserProfile row to the public shape', () => {
    const profile = {
      id: 'abc-123',
      displayName: 'Test User',
      firstName: 'Test',
      lastName: 'User',
      email: 'test@example.com',
      phone: null,
      bio: null,
      enabled: true,
    }
    const role = { key: 'storefront_client', name: 'Cliente' }
    const result = buildStorefrontUserProfile(profile, role)
    assert.deepEqual(result, {
      id: 'abc-123',
      displayName: 'Test User',
      firstName: 'Test',
      lastName: 'User',
      email: 'test@example.com',
      phone: null,
      bio: null,
      role: 'storefront_client',
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test apps/api/src/services/__tests__/storefront-auth-service.test.js
```

Expected: FAIL — `Cannot find module '../storefront-auth-service.js'`

- [ ] **Step 3: Create the service**

Create `apps/api/src/services/storefront-auth-service.js`:

```js
export function validateRegistrableRole(role, allowedRoles) {
  if (!role || !Array.isArray(allowedRoles) || allowedRoles.length === 0) return false
  return allowedRoles.includes(role)
}

export function buildStorefrontUserProfile(profile, role) {
  return {
    id: profile.id,
    displayName: profile.displayName,
    firstName: profile.firstName,
    lastName: profile.lastName,
    email: profile.email,
    phone: profile.phone ?? null,
    bio: profile.bio ?? null,
    role: role.key,
  }
}

export function createStorefrontAuthService({ prisma, supabaseAdmin, supabaseAnon }) {
  async function getRegistrableRoles() {
    const config = await prisma.instanceConfig.findUnique({
      where: { key: 'storefront.registrable_roles' },
    })
    if (!config) return ['storefront_client', 'storefront_vendor']
    try { return JSON.parse(config.value) } catch { return [] }
  }

  async function register({ email, password, name, role, companySlug }) {
    const allowedRoles = await getRegistrableRoles()
    if (!validateRegistrableRole(role, allowedRoles)) {
      throw Object.assign(new Error('Rol no permitido para registro'), { code: 'FORBIDDEN', status: 403 })
    }

    const company = await prisma.company.findUnique({ where: { slug: companySlug } })
    if (!company) {
      throw Object.assign(new Error('Empresa no encontrada'), { code: 'NOT_FOUND', status: 404 })
    }

    const dbRole = await prisma.role.findUnique({ where: { key: role } })
    if (!dbRole) {
      throw Object.assign(new Error('Rol no existe en el sistema'), { code: 'NOT_FOUND', status: 404 })
    }

    // Create Supabase Auth user
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (authError) {
      const isDuplicate = authError.message?.toLowerCase().includes('already')
      throw Object.assign(new Error(isDuplicate ? 'El correo ya está registrado' : authError.message), {
        code: isDuplicate ? 'VALIDATION_ERROR' : 'UNKNOWN',
        status: isDuplicate ? 422 : 500,
      })
    }

    const authUserId = authData.user.id
    try {
      const profile = await prisma.userProfile.create({
        data: {
          authUserId,
          displayName: name,
          firstName: name.split(' ')[0] ?? name,
          lastName: name.split(' ').slice(1).join(' ') || '',
          email,
        },
      })
      await prisma.membership.create({
        data: { userId: profile.id, companyId: company.id, roleId: dbRole.id },
      })
      return buildStorefrontUserProfile(profile, dbRole)
    } catch (err) {
      // Rollback Supabase user on DB failure
      await supabaseAdmin.auth.admin.deleteUser(authUserId).catch(() => {})
      throw Object.assign(new Error('Error al crear el perfil'), { code: 'UNKNOWN', status: 500 })
    }
  }

  async function login({ email, password, companySlug }) {
    const { data, error } = await supabaseAnon.auth.signInWithPassword({ email, password })
    if (error) {
      throw Object.assign(new Error('Credenciales incorrectas'), { code: 'UNAUTHORIZED', status: 401 })
    }

    const profile = await prisma.userProfile.findUnique({
      where: { email },
      include: {
        memberships: {
          where: { enabled: true },
          include: { role: true, company: { select: { slug: true } } },
        },
      },
    })
    if (!profile) {
      throw Object.assign(new Error('Perfil no encontrado'), { code: 'NOT_FOUND', status: 404 })
    }

    const allowedRoles = await getRegistrableRoles()
    const membership = profile.memberships.find(
      m => m.company.slug === companySlug && allowedRoles.includes(m.role?.key)
    )
    if (!membership) {
      throw Object.assign(new Error('Sin acceso a esta plataforma'), { code: 'FORBIDDEN', status: 403 })
    }

    return {
      user: buildStorefrontUserProfile(profile, membership.role),
      token: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: data.session.expires_at,
    }
  }

  async function me(authUserId, companySlug) {
    const profile = await prisma.userProfile.findUnique({
      where: { authUserId },
      include: {
        memberships: {
          where: { enabled: true },
          include: { role: true, company: { select: { slug: true } } },
        },
      },
    })
    if (!profile) {
      throw Object.assign(new Error('Perfil no encontrado'), { code: 'NOT_FOUND', status: 404 })
    }
    const allowedRoles = await getRegistrableRoles()
    const membership = profile.memberships.find(
      m => m.company.slug === companySlug && allowedRoles.includes(m.role?.key)
    )
    if (!membership) {
      throw Object.assign(new Error('Sin acceso'), { code: 'FORBIDDEN', status: 403 })
    }
    return buildStorefrontUserProfile(profile, membership.role)
  }

  async function refresh(refreshToken) {
    const { data, error } = await supabaseAnon.auth.refreshSession({ refresh_token: refreshToken })
    if (error) {
      throw Object.assign(new Error('Token de refresco inválido'), { code: 'UNAUTHORIZED', status: 401 })
    }
    return {
      token: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: data.session.expires_at,
    }
  }

  async function logout(token) {
    await supabaseAnon.auth.signOut()
    return { success: true }
  }

  return { register, login, me, refresh, logout }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test apps/api/src/services/__tests__/storefront-auth-service.test.js
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/storefront-auth-service.js apps/api/src/services/__tests__/storefront-auth-service.test.js
git commit -m "feat(storefront): add storefront auth service with register, login, me, refresh, logout"
```

---

### Task 5: Storefront auth middleware

**Files:**
- Create: `apps/api/src/routes/storefront/storefront-middleware.js`

- [ ] **Step 1: Create the middleware file**

Create `apps/api/src/routes/storefront/storefront-middleware.js`:

```js
export function createStorefrontMiddleware({ prisma, supabaseAdmin }) {
  async function getRegistrableRoles() {
    const config = await prisma.instanceConfig.findUnique({
      where: { key: 'storefront.registrable_roles' },
    })
    if (!config) return ['storefront_client', 'storefront_vendor']
    try { return JSON.parse(config.value) } catch { return [] }
  }

  async function storefrontAuthMiddleware(c, next) {
    const authHeader = c.req.header('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'No autorizado' }, 401)
    }
    const token = authHeader.replace('Bearer ', '')

    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
    if (error || !user) {
      return c.json({ error: 'Token inválido o expirado' }, 401)
    }

    const companySlug = c.req.header('X-Atlas-Company')
    if (!companySlug) {
      return c.json({ error: 'Cabecera X-Atlas-Company requerida' }, 400)
    }

    const profile = await prisma.userProfile.findUnique({
      where: { authUserId: user.id },
      include: {
        memberships: {
          where: { enabled: true },
          include: { role: true, company: { select: { id: true, slug: true } } },
        },
      },
    })
    if (!profile) {
      return c.json({ error: 'Perfil no encontrado' }, 401)
    }

    const allowedRoles = await getRegistrableRoles()
    const membership = profile.memberships.find(
      m => m.company.slug === companySlug && allowedRoles.includes(m.role?.key)
    )
    if (!membership) {
      return c.json({ error: 'Sin acceso a esta plataforma' }, 403)
    }

    c.set('storefrontUser', { profile, membership, role: membership.role, companySlug })
    await next()
  }

  return { storefrontAuthMiddleware }
}
```

- [ ] **Step 2: Verify syntax**

```bash
node --check apps/api/src/routes/storefront/storefront-middleware.js && echo "OK"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/storefront/storefront-middleware.js
git commit -m "feat(storefront): add storefrontAuthMiddleware with role and company validation"
```

---

### Task 6: Storefront files service

**Files:**
- Create: `apps/api/src/services/storefront-files-service.js`
- Create: `apps/api/src/services/__tests__/storefront-files-service.test.js`

- [ ] **Step 1: Write failing tests**

Create `apps/api/src/services/__tests__/storefront-files-service.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolveFileLimits, resolveBucket } from '../storefront-files-service.js'

describe('resolveFileLimits', () => {
  it('returns 5MB limit and image-only for storefront_client', () => {
    const limits = resolveFileLimits('storefront_client')
    assert.equal(limits.maxBytes, 5 * 1024 * 1024)
    assert.deepEqual(limits.allowedMime, ['image/'])
  })

  it('returns 100MB limit and broad types for storefront_vendor', () => {
    const limits = resolveFileLimits('storefront_vendor')
    assert.equal(limits.maxBytes, 100 * 1024 * 1024)
    assert.deepEqual(limits.allowedMime, ['image/', 'audio/', 'video/', 'application/pdf'])
  })

  it('defaults to client limits for unknown roles', () => {
    const limits = resolveFileLimits('unknown_role')
    assert.equal(limits.maxBytes, 5 * 1024 * 1024)
  })
})

describe('resolveBucket', () => {
  it('returns storefront bucket for PUBLIC visibility', () => {
    assert.equal(resolveBucket('PUBLIC'), 'atlas-storefront')
  })

  it('returns files bucket for PRIVATE visibility', () => {
    assert.equal(resolveBucket('PRIVATE'), 'atlas-files')
  })

  it('defaults to PUBLIC', () => {
    assert.equal(resolveBucket(undefined), 'atlas-storefront')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test apps/api/src/services/__tests__/storefront-files-service.test.js
```

Expected: FAIL — `Cannot find module`

- [ ] **Step 3: Create the service**

Create `apps/api/src/services/storefront-files-service.js`:

```js
const STOREFRONT_BUCKET = 'atlas-storefront'
const FILES_BUCKET = 'atlas-files'

export function resolveFileLimits(roleKey) {
  if (roleKey === 'storefront_vendor') {
    return {
      maxBytes: 100 * 1024 * 1024,
      allowedMime: ['image/', 'audio/', 'video/', 'application/pdf'],
    }
  }
  return {
    maxBytes: 5 * 1024 * 1024,
    allowedMime: ['image/'],
  }
}

export function resolveBucket(visibility) {
  return visibility === 'PRIVATE' ? FILES_BUCKET : STOREFRONT_BUCKET
}

export function createStorefrontFilesService({ prisma, supabaseAdmin }) {
  async function upload({ file, fileName, mimeType, sizeBytes, visibility, entityType, entityId, uploadedById, roleKey }) {
    const limits = resolveFileLimits(roleKey)

    if (sizeBytes > limits.maxBytes) {
      throw Object.assign(
        new Error(`Archivo demasiado grande. Maximo: ${limits.maxBytes / 1024 / 1024}MB`),
        { code: 'VALIDATION_ERROR', status: 422 }
      )
    }

    const mimeAllowed = limits.allowedMime.some(prefix => mimeType.startsWith(prefix))
    if (!mimeAllowed) {
      throw Object.assign(
        new Error(`Tipo de archivo no permitido: ${mimeType}`),
        { code: 'VALIDATION_ERROR', status: 422 }
      )
    }

    const bucket = resolveBucket(visibility)
    const objectKey = `storefront/${uploadedById}/${Date.now()}-${fileName}`

    const { error: uploadError } = await supabaseAdmin.storage
      .from(bucket)
      .upload(objectKey, file, { contentType: mimeType, upsert: false })

    if (uploadError) {
      throw Object.assign(
        new Error(`Error al subir archivo: ${uploadError.message}`),
        { code: 'UNKNOWN', status: 500 }
      )
    }

    let url = null
    if (bucket === STOREFRONT_BUCKET) {
      const { data } = supabaseAdmin.storage.from(bucket).getPublicUrl(objectKey)
      url = data.publicUrl
    }

    const asset = await prisma.fileAsset.create({
      data: {
        bucket,
        objectKey,
        originalName: fileName,
        mimeType,
        sizeBytes,
        visibility: visibility === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC',
        moduleKey: 'atlas.storefront',
        entityType: entityType ?? null,
        entityId: entityId ?? null,
        uploadedById: uploadedById ?? null,
      },
    })

    return { id: asset.id, url, originalName: asset.originalName, mimeType: asset.mimeType, sizeBytes: asset.sizeBytes }
  }

  async function getUrl(id, uploadedById) {
    const asset = await prisma.fileAsset.findUnique({ where: { id } })
    if (!asset || !asset.enabled) {
      throw Object.assign(new Error('Archivo no encontrado'), { code: 'NOT_FOUND', status: 404 })
    }

    if (asset.bucket === STOREFRONT_BUCKET) {
      const { data } = supabaseAdmin.storage.from(asset.bucket).getPublicUrl(asset.objectKey)
      return { url: data.publicUrl, type: 'public' }
    }

    const { data, error } = await supabaseAdmin.storage
      .from(asset.bucket)
      .createSignedUrl(asset.objectKey, 3600)
    if (error) throw Object.assign(new Error('Error al generar URL'), { code: 'UNKNOWN', status: 500 })

    return { signedUrl: data.signedUrl, expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(), type: 'signed' }
  }

  async function deleteFile(id, uploadedById) {
    const asset = await prisma.fileAsset.findUnique({ where: { id } })
    if (!asset || !asset.enabled) {
      throw Object.assign(new Error('Archivo no encontrado'), { code: 'NOT_FOUND', status: 404 })
    }
    if (asset.uploadedById !== uploadedById) {
      throw Object.assign(new Error('Sin permiso para eliminar este archivo'), { code: 'FORBIDDEN', status: 403 })
    }

    await supabaseAdmin.storage.from(asset.bucket).remove([asset.objectKey])
    await prisma.fileAsset.update({ where: { id }, data: { enabled: false } })
    return { success: true }
  }

  return { upload, getUrl, deleteFile }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test apps/api/src/services/__tests__/storefront-files-service.test.js
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/storefront-files-service.js apps/api/src/services/__tests__/storefront-files-service.test.js
git commit -m "feat(storefront): add storefront files service with role-based limits and dual-bucket support"
```

---

### Task 7: Storefront router and auth routes

**Files:**
- Create: `apps/api/src/routes/storefront/storefront-auth-routes.js`
- Create: `apps/api/src/routes/storefront/storefront-router.js`
- Modify: `apps/api/src/index.js`

- [ ] **Step 1: Create auth routes**

Create `apps/api/src/routes/storefront/storefront-auth-routes.js`:

```js
import { Hono } from 'hono'

export function createStorefrontAuthRoutes({ authService, storefrontAuthMiddleware }) {
  const app = new Hono()

  app.post('/register', async (c) => {
    const companySlug = c.req.header('X-Atlas-Company')
    if (!companySlug) return c.json({ error: 'Cabecera X-Atlas-Company requerida' }, 400)

    let body
    try { body = await c.req.json() } catch { return c.json({ error: 'Body JSON inválido' }, 400) }

    const { email, password, name, role = 'storefront_client' } = body
    if (!email || !password || !name) {
      return c.json({ error: 'email, password y name son requeridos' }, 422)
    }

    try {
      const user = await authService.register({ email, password, name, role, companySlug })
      return c.json({ data: user }, 201)
    } catch (err) {
      return c.json({ error: err.message }, err.status ?? 500)
    }
  })

  app.post('/login', async (c) => {
    const companySlug = c.req.header('X-Atlas-Company')
    if (!companySlug) return c.json({ error: 'Cabecera X-Atlas-Company requerida' }, 400)

    let body
    try { body = await c.req.json() } catch { return c.json({ error: 'Body JSON inválido' }, 400) }

    const { email, password } = body
    if (!email || !password) return c.json({ error: 'email y password son requeridos' }, 422)

    try {
      const result = await authService.login({ email, password, companySlug })
      return c.json({ data: result })
    } catch (err) {
      return c.json({ error: err.message }, err.status ?? 500)
    }
  })

  app.post('/refresh', async (c) => {
    let body
    try { body = await c.req.json() } catch { return c.json({ error: 'Body JSON inválido' }, 400) }

    const { refreshToken } = body
    if (!refreshToken) return c.json({ error: 'refreshToken requerido' }, 422)

    try {
      const result = await authService.refresh(refreshToken)
      return c.json({ data: result })
    } catch (err) {
      return c.json({ error: err.message }, err.status ?? 500)
    }
  })

  app.get('/me', storefrontAuthMiddleware, async (c) => {
    const { profile, role, companySlug } = c.get('storefrontUser')
    try {
      const user = await authService.me(profile.authUserId, companySlug)
      return c.json({ data: user })
    } catch (err) {
      return c.json({ error: err.message }, err.status ?? 500)
    }
  })

  app.post('/logout', storefrontAuthMiddleware, async (c) => {
    const authHeader = c.req.header('Authorization')
    const token = authHeader?.replace('Bearer ', '') ?? ''
    try {
      await authService.logout(token)
      return c.json({ data: { success: true } })
    } catch (err) {
      return c.json({ error: err.message }, err.status ?? 500)
    }
  })

  return app
}
```

- [ ] **Step 2: Create files routes**

Create `apps/api/src/routes/storefront/storefront-files-routes.js`:

```js
import { Hono } from 'hono'

export function createStorefrontFilesRoutes({ filesService, storefrontAuthMiddleware }) {
  const app = new Hono()

  app.post('/upload', storefrontAuthMiddleware, async (c) => {
    const { profile, role } = c.get('storefrontUser')

    const formData = await c.req.formData()
    const file = formData.get('file')
    if (!file || typeof file.arrayBuffer !== 'function') {
      return c.json({ error: 'Campo "file" requerido' }, 422)
    }

    const visibility = formData.get('visibility') ?? 'PUBLIC'
    const entityType = formData.get('entityType') ?? null
    const entityId = formData.get('entityId') ?? null
    const buffer = await file.arrayBuffer()

    try {
      const asset = await filesService.upload({
        file: Buffer.from(buffer),
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: buffer.byteLength,
        visibility,
        entityType,
        entityId,
        uploadedById: profile.id,
        roleKey: role.key,
      })
      return c.json({ data: asset }, 201)
    } catch (err) {
      return c.json({ error: err.message }, err.status ?? 500)
    }
  })

  app.get('/:id/url', async (c) => {
    const { id } = c.req.param()
    try {
      const result = await filesService.getUrl(id, null)
      return c.json({ data: result })
    } catch (err) {
      return c.json({ error: err.message }, err.status ?? 500)
    }
  })

  app.delete('/:id', storefrontAuthMiddleware, async (c) => {
    const { id } = c.req.param()
    const { profile } = c.get('storefrontUser')
    try {
      const result = await filesService.deleteFile(id, profile.id)
      return c.json({ data: result })
    } catch (err) {
      return c.json({ error: err.message }, err.status ?? 500)
    }
  })

  return app
}
```

- [ ] **Step 3: Create config routes**

Create `apps/api/src/routes/storefront/storefront-config-routes.js`:

```js
import { Hono } from 'hono'

export function createStorefrontConfigRoutes({ prisma }) {
  const app = new Hono()

  app.get('/realtime-config', async (c) => {
    const companySlug = c.req.header('X-Atlas-Company')
    if (!companySlug) return c.json({ error: 'Cabecera X-Atlas-Company requerida' }, 400)

    const company = await prisma.company.findUnique({ where: { slug: companySlug } })
    if (!company) return c.json({ error: 'Empresa no encontrada' }, 404)

    return c.json({
      data: {
        supabaseUrl: process.env.SUPABASE_URL,
        supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
        companyId: company.id,
      },
    })
  })

  app.get('/config', async (c) => {
    const companySlug = c.req.header('X-Atlas-Company')
    if (!companySlug) return c.json({ error: 'Cabecera X-Atlas-Company requerida' }, 400)

    const company = await prisma.company.findUnique({
      where: { slug: companySlug },
      include: { brandingConfig: true },
    })
    if (!company) return c.json({ error: 'Empresa no encontrada' }, 404)

    return c.json({
      data: {
        name: company.name,
        slug: company.slug,
        primaryColor: company.brandingConfig?.primaryColor ?? null,
        logoFileId: company.brandingConfig?.logoFileId ?? null,
      },
    })
  })

  return app
}
```

- [ ] **Step 4: Create the main storefront router**

Create `apps/api/src/routes/storefront/storefront-router.js`:

```js
import { Hono } from 'hono'
import { createStorefrontMiddleware } from './storefront-middleware.js'
import { createStorefrontAuthRoutes } from './storefront-auth-routes.js'
import { createStorefrontFilesRoutes } from './storefront-files-routes.js'
import { createStorefrontConfigRoutes } from './storefront-config-routes.js'
import { createStorefrontAuthService } from '../../services/storefront-auth-service.js'
import { createStorefrontFilesService } from '../../services/storefront-files-service.js'

export function createStorefrontRouter({ prisma, supabaseAdmin, supabaseAnon }) {
  const app = new Hono()

  const { storefrontAuthMiddleware } = createStorefrontMiddleware({ prisma, supabaseAdmin })
  const authService = createStorefrontAuthService({ prisma, supabaseAdmin, supabaseAnon })
  const filesService = createStorefrontFilesService({ prisma, supabaseAdmin })

  app.route('/auth', createStorefrontAuthRoutes({ authService, storefrontAuthMiddleware }))
  app.route('/files', createStorefrontFilesRoutes({ filesService, storefrontAuthMiddleware }))
  app.route('/', createStorefrontConfigRoutes({ prisma }))

  return app
}
```

- [ ] **Step 5: Mount router in index.js**

Open `apps/api/src/index.js`. Find the import section near the top and add:

```js
import { createStorefrontRouter } from "./routes/storefront/storefront-router.js";
```

Then find the block where public routers are mounted (around line 2911–2927):
```js
app.route("/public/website", publicWebsiteRouter);
// ...
app.route("/public/website", publicCheckoutRouter);
```

Add after this block:
```js
const storefrontRouter = createStorefrontRouter({ prisma, supabaseAdmin, supabaseAnon });
app.route("/public/storefront", storefrontRouter);
```

- [ ] **Step 6: Verify syntax**

```bash
node --check apps/api/src/index.js && echo "OK"
node --check apps/api/src/routes/storefront/storefront-router.js && echo "OK"
```

Expected: both `OK`

- [ ] **Step 7: Smoke test with the API running**

Start the API in one terminal:
```bash
pnpm dev:api
```

In another terminal, test the config endpoint (no auth required):
```bash
curl -s -H "X-Atlas-Company: <your-company-slug>" http://localhost:4010/public/storefront/config | jq .
```

Expected: `{ data: { name: "...", slug: "...", primaryColor: null, logoFileId: null } }`

Test register:
```bash
curl -s -X POST http://localhost:4010/public/storefront/auth/register \
  -H "Content-Type: application/json" \
  -H "X-Atlas-Company: <your-company-slug>" \
  -d '{"email":"test@storefront.com","password":"password123","name":"Test User","role":"storefront_client"}' | jq .
```

Expected: `{ data: { id: "...", displayName: "Test User", email: "test@storefront.com", role: "storefront_client" } }`

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/routes/storefront/ apps/api/src/index.js
git commit -m "feat(storefront): mount storefront router with auth, files, and config routes"
```

---

### Task 8: Verify full auth flow integration

- [ ] **Step 1: Test login with the user created in Task 7**

With API running:
```bash
curl -s -X POST http://localhost:4010/public/storefront/auth/login \
  -H "Content-Type: application/json" \
  -H "X-Atlas-Company: <your-company-slug>" \
  -d '{"email":"test@storefront.com","password":"password123"}' | jq .
```

Expected: `{ data: { user: { ... }, token: "eyJ...", refreshToken: "...", expiresAt: ... } }`

Save the token:
```bash
TOKEN=<paste the token value>
```

- [ ] **Step 2: Test /me endpoint**

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
     -H "X-Atlas-Company: <your-company-slug>" \
     http://localhost:4010/public/storefront/auth/me | jq .
```

Expected: `{ data: { id: "...", email: "test@storefront.com", role: "storefront_client" } }`

- [ ] **Step 3: Test realtime-config endpoint**

```bash
curl -s -H "X-Atlas-Company: <your-company-slug>" \
     http://localhost:4010/public/storefront/realtime-config | jq .
```

Expected: `{ data: { supabaseUrl: "https://...", supabaseAnonKey: "eyJ...", companyId: "uuid..." } }`

- [ ] **Step 4: Test role guard (attempt to register as admin)**

```bash
curl -s -X POST http://localhost:4010/public/storefront/auth/register \
  -H "Content-Type: application/json" \
  -H "X-Atlas-Company: <your-company-slug>" \
  -d '{"email":"hacker@example.com","password":"password123","name":"Hacker","role":"admin"}' | jq .
```

Expected: `{ "error": "Rol no permitido para registro" }` with HTTP 403.

- [ ] **Step 5: Final commit**

```bash
git add .
git commit -m "feat(storefront): Plan A complete — storefront API with auth, files, config, and realtime endpoints"
```
