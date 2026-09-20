# Office documents with Collabora CODE

Runly remains the owner of FileAsset, permissions, company, Storage objects and revisions. CODE renders and edits DOCX/XLSX/PPTX through Runly's WOPI host. It never receives Supabase credentials or direct Storage URLs. PDF/media previews and downloads keep their existing behavior. Office is online-only.

CODE is the free **Development Edition**, intended for testing and small teams, without a supported production release/SLA. It is not a promise of Microsoft Office fidelity: test your fonts, formulas, charts and layouts. Legacy DOC/XLS/PPT, macro-enabled files, PDFs and password-protected documents are not editable in this MVP. The official image is pinned to `collabora/code:26.04.2.4.1` (verified pull digest `sha256:1f864ce3f0c49e867787b6dd303bd6ba989542d3023f6809df558eafd04c1b97`). Preserve Collabora's branding, notices and applicable MPL 2.0/source-distribution obligations. See [CODE](https://www.collaboraonline.com/code/), [license terms](https://www.collaboraonline.com/terms/collabora-online-mplv2/) and [Mozilla's MPL FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/).

## Install

Apply the normal Runly migrations and regenerate Prisma before running updated API code (`pnpm db:generate`; deployment runs `pnpm db:migrate`). The migration adds recovery revisions, leases and a database guard for lifecycle mutations. Do not apply a second RME3 table sync for these core tables.

For the local installer, put `RUNLY_OFFICE_ENABLED=true` in `infra/installer/.env.local` or the process environment, then run `node infra/installer/setup-local.mjs`. It defaults to browser `http://localhost:9980`, browser host `http://localhost:5173`, internal CODE `http://collabora:9980` and WOPI `http://api:4010`.

For external Supabase, edit `.env.external`, then run `node setup-external.mjs` from the installer directory. Both scripts enable `--profile office`, preserve the signing secret and networking settings across reruns, and stop the Office service when disabled. All four bootstrap scripts include the configuration helper. CODE failure does not prevent the API from starting. CODE's native healthcheck is retained; the current image is distroless, so don't replace it with a shell/curl command.

For manual Compose after configuration: `docker compose --profile local --profile office up -d` (replace local with external; on Linux include `-f docker-compose.yml -f docker-compose.linux.yml`). Existing enabled LiveKit profiles still need to be included. Use the setup scripts for normal operation, since they also generate networking interpolation values. Publishing `9980` is restricted to host loopback; terminate TLS on the host or use a proxy on the same Docker network.

## Development with pnpm dev on Docker Desktop

When API/Vite run directly on Windows/macOS and only CODE runs in Docker, configure the repository-root `.env` as follows. These values differ from the VPS installer's `.env.external`:

```dotenv
RUNLY_OFFICE_ENABLED=true
COLLABORA_INTERNAL_URL=http://127.0.0.1:9980
COLLABORA_PUBLIC_URL=http://localhost:9980
RUNLY_WOPI_URL=http://host.docker.internal:4010
RUNLY_OFFICE_HOST_ORIGIN=http://localhost:5173
RUNLY_OFFICE_ADDITIONAL_ORIGINS=http://tauri.localhost,https://tauri.localhost,tauri://localhost
RUNLY_WOPI_SECRET=
RUNLY_WOPI_TOKEN_SECONDS=28800
```

Generate a **separate development secret** with `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"` and place it in `RUNLY_WOPI_SECRET`; `pnpm dev` does not generate it automatically. Keep URLs as plain text, without Markdown link notation. Preserve the existing non-Office settings.

From the repository root, start/restart the API and frontend normally. `pnpm dev` and `pnpm dev:tauri` start the optional development editor first when `RUNLY_OFFICE_ENABLED=true` and the internal CODE URL points to localhost:

```bash
pnpm dev
```

The helper `scripts/start-office-dev.mjs` reads the root `.env`, derives CODE's WOPI host/frame origins and targets only `collabora-dev` within the `runlyerp` Compose project. It reuses the existing service when unchanged and does not start a second Runly API or an installer Supabase stack. If Docker is unavailable, it warns and lets API/web/worker start. Disabled Office or a non-loopback CODE URL does not start a local editor. The database used by your development API must already have the Office migration and the Prisma client must be generated; pointing the editor at localhost does not change which database/Storage the API uses.

Docker Desktop displays the development editor alongside the other services under `runlyerp`. The old separate `atlas-office-dev` project was replaced by this shared grouping. The VPS installer also uses `runlyerp`, with service `collabora` under profile `office`. In both cases CODE is a separate container. The development Compose file is a partial view of the Runly project: never use `down` or `--remove-orphans` with it, since other Runly services share the project. Use service-targeted commands only.

The host API reaches CODE through published port 9980. CODE reaches the host API through `host.docker.internal:4010`; the helper derives the allowed WOPI host from `RUNLY_WOPI_URL`. Open Runly at `http://localhost:5173` to match the configured browser origin. No Nginx or certificate is needed for localhost. If the API's listening port or frontend origin changes, update the corresponding root `.env` values and rerun the helper; it derives the CODE settings. The development CODE port itself remains fixed at 9980. Native Linux Docker Engine needs an explicit `host.docker.internal:host-gateway` extra-host entry and an API listening on an interface reachable from Docker; this example targets Docker Desktop.

To start only the editor, run `node scripts/start-office-dev.mjs`. Check startup with `docker compose -p runlyerp -f infra/docker/office-dev.compose.yml ps collabora-dev` and `curl http://127.0.0.1:9980/hosting/discovery`. Discovery confirms CODE availability; editing and saving additionally require the running Runly API, authentication and database migration. Stop only the development editor with `docker compose -p runlyerp -f infra/docker/office-dev.compose.yml stop collabora-dev`. Disabling Office in `.env` skips auto-start; it does not stop an already running container.

If API and CODE instead both run through the local **installer**, keep `COLLABORA_INTERNAL_URL=http://collabora:9980` and `RUNLY_WOPI_URL=http://api:4010` in the installer's `.env.local`; only its public browser URLs use localhost. Use that installer flow instead of starting the standalone development editor on the same port.

## First deployment on an existing VPS

See the [Spanish VPS example](office-vps-example.md) for illustrative port mappings and Nginx certificate setup. Replace all example domains and paths with your private deployment configuration.

Office is disabled by default. An ordinary update does not enable it automatically. Once configured, `npm run runly:external` creates/starts the optional editor along with Runly. DNS and the Office HTTPS reverse proxy are configured separately; the installer does not provision either.

1. Publish the repository changes, including the installer files, to the branch used by your bootstrap (the supplied bootstrap uses `main`). From your release checkout, publish the updated Runly images with `pnpm docker:release`. This integration requires the new API, web and database migration; starting CODE alongside older Runly images is insufficient. Publishing images and updating installer files are separate steps.
2. On the VPS, enter the **existing installer directory** containing `.env.external` and `custom-modules/`. Back up your deployment configuration before refreshing the installer. Download and run the updated bootstrap:

   ```bash
   curl -fsSLo bootstrap-external.sh https://raw.githubusercontent.com/raulbellosom/runly-erp/main/infra/installer/bootstrap-external.sh
   bash ./bootstrap-external.sh
   ```

   The bootstrap refreshes Compose, setup scripts and their shared libraries. It preserves an existing `.env.external` and does not delete `custom-modules/`. It overwrites distributed installer files, so retain/reapply any local changes to those files. `npm run runly:external` itself downloads images and the Dev Kit; it **does not update its own installer scripts or Compose files**.
3. Point a dedicated Office subdomain to the VPS and configure HTTPS/WebSockets using the reverse proxy example below. If a proxy already owns ports 80/443, integrate Office into that proxy. Host proxies use `http://127.0.0.1:9980`; a container proxy on the Runly Docker network can use `http://collabora:9980` (its own localhost is not the VPS).
4. Edit the following entries in `.env.external`, replacing both example domains with your real domains. Keep the existing database/authentication settings:

   ```dotenv
   RUNLY_OFFICE_ENABLED=true
   COLLABORA_PUBLIC_URL=https://office.tudominio.com
   RUNLY_OFFICE_HOST_ORIGIN=https://erp.tudominio.com
   COLLABORA_INTERNAL_URL=http://collabora:9980
   RUNLY_WOPI_URL=http://api:4010
   ```

   Leave `RUNLY_WOPI_SECRET` empty on first activation so the installer generates and saves it. Preserve it on subsequent deployments. The ERP origin must match the actual URL used in the browser.

   For manual configuration without the installer, run this complete command in your terminal (Bash or PowerShell):

   ```bash
   node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
   ```

   Copy its output into `RUNLY_WOPI_SECRET=` in the server environment file. The JavaScript expression alone is not a shell command. Generate the key once and preserve it; replacing an existing key invalidates active Office tokens. Additional origins are plain comma-separated text, without Markdown brackets or parentheses:

   ```dotenv
   RUNLY_OFFICE_ADDITIONAL_ORIGINS=http://tauri.localhost,https://tauri.localhost,tauri://localhost
   ```
5. Run the full update from that installer directory:

   ```bash
   npm run runly:external
   ```

   The installer applies migrations, starts Runly and starts CODE with the `office` profile. Docker downloads the pinned CODE image if it is missing. Do not use `runly:external:quick`, `--skip-migrate` or `--up-only` for the first deployment of this feature.
6. Check the container and both discovery paths, then open a document in Runly and verify a save/reopen:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.linux.yml --profile office ps collabora
   curl -fsS http://127.0.0.1:9980/hosting/discovery -o /dev/null
   curl -fsS https://office.tudominio.com/hosting/discovery -o /dev/null
   ```

   Startup can take time. Successful discovery alone does not verify browser embedding, WebSocket connectivity or saving; perform the document acceptance check too.

## Updates and container lifecycle

For later image updates, run `npm run runly:external` in the same installer directory. When a release also changes the installer or Compose, refresh the bootstrap first as above. Keep the same Compose project name (`runlyerp` by default); changing `COMPOSE_PROJECT_NAME` or using a different `-p` creates a different project and can cause duplicate services or port/name conflicts.

- One shared `collabora` service handles documents and users. Runly does not create a Docker container for each document, save, user or update. CODE manages its own document processes inside the service.
- The installer starts CODE separately with `up -d collabora`, without forcing recreation. If its image and Compose configuration are unchanged, a running container is reused; a stopped one is started. Changes to its image/configuration replace the existing container. This follows [Docker Compose's update behavior](https://docs.docker.com/reference/cli/docker/compose/up/).
- Runly API, worker, web and enabled embedded Calls services retain the installer's existing forced-recreation behavior. They are replaced within the same project, rather than accumulating copies. This also reloads generated bind-mounted Calls configuration. Keeping CODE running does **not** make the whole deployment interruption-free: an API restart temporarily interrupts WOPI requests. Save and close documents before deploying, especially when changing CODE or database code.
- Migration and seed commands use temporary `docker run --rm` containers, removed when each command exits. Docker images/cache are separate from containers; old images can still occupy disk. The current installer runs `docker image prune -f` after pulls and before startup, so an image still used by the old container at that point may remain until a later cleanup.
- CODE's version is pinned in Compose. Runly updates do not automatically advance it to a new CODE release. Review and update the pinned version deliberately, then refresh the installer on the VPS.
- Setting `RUNLY_OFFICE_ENABLED=false` and rerunning setup stops the existing editor and disables new Office sessions. It does not delete documents. Re-enabling reuses the service where possible. Do not run `runly:stop:external` or `--reset` as a routine update step.

## Variables and networking

`RUNLY_OFFICE_HOST_ORIGIN` is the origin of the **Runly frontend as opened in the user's browser**. It normally matches `RUNLY_APP_URL`, which Runly uses for application links and other integrations. Office currently requires its own explicit value; it does not inherit `RUNLY_APP_URL`. An origin includes scheme, hostname and any non-default port, but no `/app` path. For local development both can be `http://localhost:5173`; for a VPS use the actual HTTPS Runly domain, even when Nginx forwards it to port 5173 internally. `erp.example.com` is only a placeholder, not a required additional domain.

`COLLABORA_PUBLIC_URL` belongs to the separate Office domain. `ATLAS_API_URL` belongs to the public API (possibly an `/api` path on the Runly domain) and is used by the installer's web image at runtime. `VITE_ATLAS_API_URL` is used by the development/build setup; it does not replace the installer's `ATLAS_API_URL`. `CORS_ORIGIN` must continue allowing the actual Runly frontend origin.

The repository-root `.env` and the VPS installer's `.env.external` are different files/flows. Root `.env` values such as localhost are valid for local development and do not establish the VPS's actual domain or port mapping. Configure Office in `.env.external` when deploying with `npm run runly:external`; the installer generates its sibling `.env` for Compose interpolation.

| Variable | Purpose | Installer default |
|---|---|---|
| `RUNLY_OFFICE_ENABLED` | Enable sessions and optional CODE service | `false` |
| `COLLABORA_INTERNAL_URL` | API fetches `/hosting/discovery` here | `http://collabora:9980` |
| `COLLABORA_PUBLIC_URL` | Browser iframe/WebSocket origin | `http://localhost:9980` |
| `RUNLY_WOPI_URL` | CODE calls Runly WOPI here; stable for all users | `http://api:4010` |
| `RUNLY_OFFICE_HOST_ORIGIN` | Primary browser host origin for postMessage/frame ancestors | `http://localhost:5173` |
| `RUNLY_OFFICE_ADDITIONAL_ORIGINS` | Comma-separated exact HTTPS/native embedding origins | `http://tauri.localhost,https://tauri.localhost,tauri://localhost` |
| `RUNLY_WOPI_SECRET` | Dedicated server-only HMAC key, at least 32 bytes | Generated and preserved |
| `RUNLY_WOPI_TOKEN_SECONDS` | WOPI capability lifetime, 300–28800 seconds | `28800` |

Origins cannot contain credentials, a path, query or fragment. Remote browser origins must use HTTPS; loopback HTTP is allowed for development. Do not substitute an internal Docker hostname into the browser URL. For development with the API outside Docker use the root `.env.example` values and configure CODE's allowed WOPI host as `http://host.docker.internal:4010`. On Linux the CODE service gets host-gateway through the installer override. Localhost in a phone means the phone: use real HTTPS domains for mobile/PWA acceptance.

The installer derives `COLLABORA_WOPI_HOST`, `COLLABORA_CONTENT_SECURITY_POLICY` and `COLLABORA_EXTRA_PARAMS` for Compose, including exact `aliasgroup1`, public server name, TLS termination and frame ancestor. These are public configuration; the signing key only enters the API env file. Do not use wildcard hosts or disable TLS certificate validation. Internal plain HTTP WOPI is acceptable only on a trusted isolated Docker network; use HTTPS if traffic crosses machines/untrusted networks. Because capabilities authorize requests, do not expose the internal WOPI port through a public proxy unnecessarily. Proof-key validation is not implemented in this version; the trust boundary is the configured private CODE/API network plus scoped bearer tokens and reauthorization. Tokens are reusable for the editing session (as WOPI requires), not one-use nonces; possession is sensitive until expiry or permission revocation.

### If host port 4010 is occupied

First identify the listener on the VPS: it may already be the Runly API you intend to update, rather than a conflicting application.

```bash
docker ps --format 'table {{.Names}}\t{{.Ports}}'
ss -ltnp '( sport = :4010 )'
```

`ATLAS_API_PORT` controls the API's listening port **inside its container**. The installer currently publishes the literal mapping `4010:4010` in Compose; changing the variable alone does not change that mapping. If another application requires host port 4010, retain internal `ATLAS_API_PORT=4010` and adjust the Runly API service's published mapping to an available host port, for example `127.0.0.1:4011:4010` when Nginx runs on the host. Replace the existing mapping; do not add it alongside the conflicting one. This mapping is an example, not a claim that 4011 is available on your VPS. Preserve this customization when refreshing the installer.

In that example, the host Nginx API upstream becomes `http://127.0.0.1:4011`, while `RUNLY_WOPI_URL=http://api:4010` remains correct because CODE and Runly share the Docker network. If you instead change the API's internal listening port, update the target port and WOPI URL consistently. [Docker documents the distinction between host and container ports](https://docs.docker.com/compose/how-tos/networking/).

Office itself publishes `127.0.0.1:9980:9980`. The Office Nginx upstream is therefore `http://127.0.0.1:9980`, independent of the Runly API's host port.

## HTTPS reverse proxy

Use a dedicated `office.example.com` virtual host. Existing LiveKit Caddy may already own ports 80/443: add the Office vhost to your existing managed proxy setup, or use an externally managed proxy for both. Do not start a second service on those ports. A host Nginx example:

```nginx
# http {} context
map $http_upgrade $office_connection { default upgrade; '' close; }

server {
    listen 443 ssl;
    server_name office.example.com;
    # Configure your valid ssl_certificate / ssl_certificate_key here.
    client_max_body_size 12m;
    location / {
        proxy_pass http://127.0.0.1:9980;
        proxy_http_version 1.1;
        proxy_set_header Host $http_host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $office_connection;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
        # CODE's URLs may contain session capabilities; avoid access logging.
        access_log off;
    }
}
```

Forward all CODE paths unchanged, including `/browser/`, `/hosting/discovery`, `/cool/` and WebSockets (101 upgrade). Avoid URI rewrites/double decoding. If WOPI itself is proxied, preserve method, binary body, `X-WOPI-*` and `X-COOL-WOPI-Timestamp`, allow at least 10 MiB, disable buffering where needed, and suppress query-string access logs there too. Do not log request bodies, access tokens, signed URLs or document bytes in APM/proxies. Retain Collabora's response CSP; don't add `X-Frame-Options: SAMEORIGIN` on the Office vhost. The Runly host's CSP must permit the configured Office origin in `frame-src` and `form-action`. CODE's `content_security_policy` environment variable sets `frame-ancestors` to the configured allowlist (the older `net.frame_ancestors` is deprecated). This avoids the distroless image's extra_params space parsing problem. Ordinary WOPI traffic is server-to-server and needs no permissive browser CORS.

Tauri currently has no restrictive configured CSP; this change does not relax it. Its standard native origins are explicitly included in the default additional origin list. The session endpoint validates the request Origin against that allowlist and binds it into the signed token; CheckFileInfo returns that exact PostMessageOrigin. Windows Tauri 2 normally uses http://tauri.localhost, and macOS/Linux use tauri://localhost. Additional HTTPS deployment origins can be listed explicitly; no wildcard or opaque null origin is accepted. Native cross-origin embedding and future Android/iOS WebViews still require device validation. Do not claim native/mobile acceptance from a successful Windows build alone. See the [official Tauri origin guidance](https://v2.tauri.app/start/migrate/from-tauri-1/).

## Session and endpoints

Frontend uses `@runly/sdk` methods `files.officeStatus(token)` and `files.createOfficeSession(id, mode, token)`; no session is persisted in the TanStack offline cache. The responsive shared `OfficeDocumentEditor` POSTs the temporary token and expiry to the discovered action in a full-screen iframe. File previews/detail actions and shared attachments use `/app/m/runly.files/files/:id/edit`. The session decides view/edit from actual company permissions (`auto`); explicit `edit` is rejected without update permission.

| Endpoint | Authorization / operation |
|---|---|
| `GET /files/office/status` | Runly auth + files read; cached discovery health |
| `GET /files/:id/office/download` | Runly auth + current company/parent access; binary download still works without CODE |
| `POST /files/:id/office/session` | Runly auth + current company/parent access; `{mode: "auto"\|"view"\|"edit"}` |
| `GET /wopi/files/:id` | WOPI capability; CheckFileInfo |
| `GET /wopi/files/:id/contents` | WOPI capability; GetFile through Runly Storage client |
| `POST /wopi/files/:id` | WOPI capability + `X-WOPI-Override`: LOCK, REFRESH_LOCK, UNLOCK, GET_LOCK; LOCK with `X-WOPI-OldLock` implements UnlockAndRelock |
| `POST /wopi/files/:id/contents` | Edit capability + `X-WOPI-Override: PUT` + matching lease; PutFile |

Tokens contain server-resolved auth user, profile, company, file, mode and expiry; the server rechecks active profile/company/membership/role/permissions and enabled file on every WOPI request. Supported parent access currently includes direct Files documents, project task attachments with project membership, HR/contact metadata origins verified against company-owned records, and inventory attachments with persisted joins. Calendar, chat, fleet and other unregistered scopes fail closed; their existing preview/download workflows remain. They can reuse the same component and add an explicit authoritative access adapter later. Company-wide admin does not bypass project membership.

`WOPISrc` is stable per FileAsset; it never includes user/session/revision, allowing CODE to place authorized users in one document. WOPI version increments only on changed content. Rename/PutRelative capabilities are explicitly false and their operations return 501. Reads remain possible when another user holds the write lease. Discovery success is cached 5 minutes, failures 15 seconds; browser status is also cached.

## Save, locks and recovery

Leases last 30 minutes and persist in PostgreSQL. Lock transitions and the final save use row-level transactions; mismatches return 409 with the current `X-WOPI-Lock`, including the empty string for an expired/missing lease. `X-WOPI-OldLock` is checked atomically. There is no process-local lock authority.

PutFile validates a bounded 10 MiB body, extension/MIME and OOXML central directory/content types, bounded expansion and macros/encryption restrictions. A new immutable Storage key is uploaded with `upsert:false`. The final transaction rechecks authorization, lock and expected current pointer/revision, inserts the previous pointer into `file_asset_version`, switches FileAsset and writes `office.document.saved`. Storage/transaction failures keep the previous committed version. A crash after upload may leave an unreferenced candidate; it is deliberately not deleted after an ambiguous commit error because it might be the committed live file. Reconcile candidates against both tables before any manual cleanup. Do not enable an object-age deletion policy on the Office prefix.

Identical bytes do not create a revision. Revisions are internal recovery records, not separate assets or a visible autosave timeline. Office deletion disables the asset while retaining bytes/recovery data; hard purge and automated retention are outside this MVP. Names/disable/delete/association changes are blocked while a lease is active, including other module routes through the database guard. Closing CODE normally releases the lease; after a crash it expires. Never force-clear a live lease to make a conflicting save succeed.

For recovery, an administrator can inspect `file_asset_version` by `file_id, revision`, then retrieve its private `bucket/object_key` with the privileged Storage client and upload it as a separate recovery copy using the normal Files upload. Do not overwrite the current pointer during an active session. There is no end-user restore API in this MVP. Recovery rows have RLS enabled and no anon/authenticated grants. Back up the database and Storage together.

Audit events: `office.document.opened`, `office.document.saved`, `office.document.save_failed`. They include file/actor/company, revision/size or bounded error code, never capabilities or bytes. Runly's back action requests a save and waits for acknowledgment; a timeout leaves the editor mounted. An expired session is visible and must be reopened deliberately. If saving is unavailable, recover edits through CODE's own download UI before leaving. Office documents are not available for offline editing.

## Troubleshooting and acceptance

### Changes appear only after saving and reloading another device

There is no separate collaboration switch. Both devices must open the same FileAsset in the live Office editor, with sessions routed to the same CODE document process. A file preview or downloaded copy does not join that live session. Use the same `/app/m/runly.files/files/:id/edit` path on the same deployed Runly installation for an initial check; matching filenames alone do not establish file identity.

Development and production normally run separate CODE instances. A browser on `localhost:5173` with `COLLABORA_PUBLIC_URL=http://localhost:9980` does not collaborate live with a browser using the VPS's `https://office.example.com`, even when both Runly APIs share database/Storage. Reading saved versions from common storage does not synchronize their live editor processes; competing write leases can also prevent saves. To test cross-device collaboration, open the deployed Runly URL on both devices instead of mixing local development and production. Do not change only the public Office URL to combine environments: discovery routing, the canonical WOPI URL, token validation and host origins must be consistent too.

For a failure within one installation, compare the file ID, effective editor origin and decoded WOPISrc from the two session responses locally; do not share access tokens or complete capability URLs. Runly creates WOPISrc from the configured WOPI base plus FileAsset ID, without user, token or revision suffixes. Check that `/cool/` WebSockets stay connected and that any proxy with multiple CODE backends routes the same document to the same instance. Collabora documents this requirement in its [deployment guidance](https://github.com/CollaboraOnline/online/blob/main/kubernetes/helm/collabora-online/README.md). Separate logged-in users are useful for checking permissions, but using the same account on two devices does not itself disable coediting.

| Symptom | Check |
|---|---|
| White iframe | CODE public origin reachable; `frame-src`, `form-action`, `frame-ancestors`; no incompatible X-Frame-Options; browser console |
| Host not authorized | Exact WOPI origin/port in `aliasgroup1`; CODE can resolve/reach API |
| Discovery unavailable | API->CODE internal URL, container health and correct pinned image; localhost IPv6 vs IPv4 on host development |
| WebSocket reconnect loop | `/cool/` upgrade headers, HTTP/1.1, long timeout, no URI rewriting |
| Mixed content | Both browser-facing ERP and CODE use valid HTTPS |
| Opens but does not save | Current update and parent permissions; WOPI PUT/lock headers; Storage writes; 10 MiB limit; audit error code |
| Lock conflict | Another lease, expired lease, stale timestamp or competing save; do not overwrite the winner |
| Phone layout/network fails | Public DNS/TLS instead of localhost; supported touch browser; actual WebView origin; safe-area height |
| Tauri fails to embed | Actual WebView top-level origin is missing from `RUNLY_OFFICE_ADDITIONAL_ORIGINS`; validate separately |

Automated commands:

```sh
node --test apps/api/src/services/__tests__/office-wopi.test.js infra/installer/lib/office-config.test.mjs packages/ui/src/components/office-message.test.js
# Optional actual PostgreSQL suite, on a disposable database with schema + migration:
# OFFICE_TEST_DATABASE_URL=postgresql://...@127.0.0.1:.../office_test
node --test apps/api/src/services/__tests__/office-postgres.test.js
pnpm lint
pnpm build
```

Acceptance on your deployment: upload XLSX, edit A1, save/close, reopen and download to verify bytes; open two authorized users concurrently; verify a view-only user's read mode and another company's rejection. Repeat with DOCX/PPTX, Android Chrome, iOS Safari, installed PWA and Tauri. Stop CODE and confirm Runly listing/upload/download remain usable. Benchmarks depend on document complexity and users; provision headroom for CODE alongside Runly/Supabase and measure memory/CPU under collaborative load. Official sizing guidance is in the [Collabora FAQ](https://www.collaboraonline.com/faqs/).

## Files workspace

Document creation, internal invitations, per-document permissions and server pagination are covered in [the Files workspace deployment guide](files-workspace.md). This requires updated API/web images and the Files workspace migration; it reuses the existing CODE service.
