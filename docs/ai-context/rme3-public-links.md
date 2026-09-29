# Enlaces y páginas públicas (module public links)

Spec: `docs/superpowers/specs/2026-09-28-module-public-links-design.md`.

A module can let people without a Runly session open a record or submit a
form through a link the company creates and can revoke. **Runly owns the link
and its security** (random 256-bit token, expiry, revocation, max uses, rate
limit, 64 KB JSON body, honeypot). The module only declares what can be
exposed and implements the public handlers.

## Recipe

### 1. Declare the resource in `module.manifest.js`

```js
publicResources: [
  {
    key: 'encuesta.responder',          // unique in the module, /^[a-z][a-z0-9_.-]{1,63}$/
    entity: 'encuesta',                 // optional: the link must point at one record of this model
    mode: 'submit',                     // 'view' (read-only) | 'submit' (can send data)
    view: 'encuestas.responder-publica',// key of a public CUSTOM view of this module
    title: 'Responder encuesta',        // shown in the share panel and the public page
    managePermission: 'encuestas.encuestas.update', // who may create/list/revoke links; must be declared in `permissions`
  },
]
```

### 2. Add the public view

```js
export default defineView({
  key: 'encuestas.responder-publica',
  kind: 'CUSTOM',
  schema: {
    path: '/p/encuestas/responder',     // must start with /p/
    public: true,
    component: 'custom.encuestas:ResponderPublica',
    title: 'Responder encuesta',
  },
})
```

The link URL is `<schema.path>/<token>`, e.g. `/p/encuestas/responder/Xy...`.
The component receives `{ linkToken, apiBaseUrl, publicLink, moduleKey, navigate }`:

- `apiBaseUrl` is already `<api>/public/m/<moduleKey>/<token>`; call
  `fetch(`${apiBaseUrl}/encuesta`)`. No auth header.
- `publicLink = { resource: { key, title, mode }, recordId, expiresAt, company: { name, logoUrl } }`.
- Wrap the page in `PublicLinkFrame` (`@runly/ui`) for the company branding.
- Send the honeypot: render a visually hidden input bound to `_hp` and include
  it in every JSON body (`{ ...data, _hp }`). Real users leave it empty.

### 3. Implement `api/public.js`

Separate from `api/index.js`, so normal routes are never exposed.

```js
import { Hono } from 'hono'

export default function createPublicRouter({ prisma }) {
  const app = new Hono()

  app.get('/encuesta', async (c) => {
    const { companyId, recordId } = c.get('publicLink')
    const rows = await prisma.$queryRaw`
      SELECT id, titulo, descripcion FROM custom_encuestas_encuesta
       WHERE company_id = ${companyId}::uuid AND id = ${recordId}::uuid AND enabled = true`
    if (!rows.length) return c.json({ error: 'No encontrado.' }, 404)
    return c.json({ data: rows[0] })
  })

  app.post('/respuestas', async (c) => {
    const { companyId, recordId } = c.get('publicLink')
    const body = c.get('publicBody')             // already parsed, _hp removed
    // validate with the module's Zod schema, then INSERT ... RETURNING id
    return c.json({ ok: true }, 201)
  })

  return app
}
```

`c.get('publicLink') = { id, companyId, moduleKey, resource, recordId, mode }`.

### 4. Share it from a module screen

```jsx
<PublicLinksPanel apiBaseUrl={apiBaseUrl} token={token} companyId={companyId}
  moduleKey="custom.encuestas" resource="encuesta.responder" recordId={encuesta.id} />
```

The panel lists links (status, uses, expiry), creates them (`ShareLinkDialog`),
copies the URL, shows a QR and revokes with `ConfirmDialog`.

## Security rules for `api/public.js`

- Always scope by `publicLink.companyId`, never by anything in the request.
- When `publicLink.recordId` is set, read and write only data of that record.
- Branch on `publicLink.resource` if the module declares several resources.
- Return an explicit field list; never `SELECT *` to the client, never
  internal notes, user ids or file keys.
- Validate `publicBody` with Zod; it is anonymous input.
- A non-2xx answer to a write gives the use back; answer 2xx only on success.

## What the gateway answers

| Case | Status |
|---|---|
| Unknown token, module disabled, resource removed | 404 `Enlace no disponible` |
| Revoked / expired / out of uses | 410 with `reason`: `revocado` / `vencido` / `agotado` |
| Write on a `view` link | 405 |
| Body over 64 KB | 413 |
| Non-JSON write | 415 |
| Too many requests (per IP + token) | 429 with `Retry-After` |
| Honeypot filled | 200 `{ ok: true }`, module not called |

Uninstalling a module revokes its links; resetting it deletes the company's links.

## Common problems

- "Vista pública no encontrada": the view is missing `public: true` or its path
  does not start with `/p/`, or the module was not synced.
- Create returns 409: `publicResources[].view` does not match a public CUSTOM view key.
- Create returns 422 "Este enlace necesita un registro": the resource declares
  `entity`; pass `recordId`.
- Public routes answer 404 but `_context` works: `api/public.js` is missing or
  failed to load (see the API log `[route-loader] public routes ...`).
