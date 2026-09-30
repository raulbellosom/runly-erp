# Atlas ERP - Core Modules

Fourteen official modules. All have `core: true`, `uninstallable: false`. None can be removed or disabled from module lifecycle endpoints.

## Quality standards

All core modules must comply with the [Module Quality Standards](module-quality-standards.md). Criteria marked **REQUIRED** in that document are non-negotiable for any core module. CONDITIONAL criteria apply based on whether the module's design includes the relevant surface (list views, entity attachments, push events, etc.). Run a full 17-point audit before marking any core module update as production-ready.

## runly.core

Owns module registry/lifecycle, dashboard shell entry, system config, and audit-level platform controls.

Depends on: none.

Permissions: `core.access`, `core.read`, `core.manage`, `core.modules.read|create|update|delete`, `core.instance.read|create|update|delete`, `audit.read`

Navigation: Modulos (`/modules`), Configuracion (`/settings`)

## runly.identity

Owns identity and access control: users, roles, permissions, profiles, memberships.

Depends on: `runly.core`

Permissions: `identity.access`, `identity.users.read|create|update|delete`, `identity.roles.read|create|update|delete`, `identity.permissions.read|create|update|delete`, `profile.self.read|update`, `profile.avatar.update`, `profile.password.update`

Navigation: Usuarios (`/identity/users`), Roles (`/identity/roles`)

## runly.files

Owns file metadata (`FileAsset`) and storage integration contracts for uploads, signed URLs, and asset lifecycle.

Depends on: `runly.core`

Permissions: `files.access`, `files.assets.read|create|update|delete`

Navigation: Archivos (`/files`)

Storage baseline: bucket `runly-files` is canonical for module assets.

## runly.company

Owns company profile, address, and branding configuration.

Depends on: `runly.core`, `runly.files`

Permissions: `company.access`, `company.profile.read|create|update|delete`, `company.address.read|create|update|delete`, `company.branding.read|create|update|delete`

Navigation: Resumen (`/`), Perfil (`/company`), Direccion (`/company/address`), Marca visual (`/company/branding`)

## runly.contacts

Owns customer/supplier/person/company contact records and reusable picker contracts.

Depends on: `runly.core`, `runly.identity`

Permissions: `contacts.access`, `contacts.contacts.read|create|update|delete`

Navigation: Contactos (`/contacts`)

## runly.hr

Owns employee records, departments, job titles, and HR org-chart surfaces.

Depends on: `runly.core` (`runly.files` optional)

Permissions: `hr.access`, `hr.employee.read|create|update|delete`, `hr.department.read|create|update|delete`, `hr.job_title.read|create|update|delete`, `hr.org_chart.read|create|update|delete`

Navigation: Colaboradores (`/hr/employees`), Organigrama (`/hr/org-chart`), Catalogos (`/hr/catalogs`)

## runly.fleet

Owns fleet management: vehicles, drivers, insurance policies, maintenance/service/repair reports, and catalogs (vehicle types, brands, models).

Depends on: `runly.core`

Permissions: `fleet.access`, `fleet.vehicles.read|create|update|delete`, `fleet.drivers.read|create|update|delete`, `fleet.reports.read|create|update|delete`, `fleet.insurance.read|create|update|delete`, `fleet.catalogs.read|create|update|delete`

Navigation: Vehiculos (`/app/m/runly.fleet/vehicles`), Seguros (`/app/m/runly.fleet/insurance`), Reportes (`/app/m/runly.fleet/reports`), Choferes (`/app/m/runly.fleet/drivers`), Catalogos (`/app/m/runly.fleet/catalogs`)

## runly.ledger

Owns bank accounts, transactions, categories, transaction types, and multi-user ledger groups (shared accounts with role-based access).

Depends on: `runly.core`

Permissions: `ledger.accounts.read|create|update|delete`, `ledger.transactions.read|create|update|delete`, `ledger.export`, `ledger.import`, `ledger.categories.manage`, `ledger.types.manage`, `ledger.groups.read|write`, `ledger.members.write`

Navigation: Cuentas (`/app/m/runly.ledger/accounts`), Categorias (`/app/m/runly.ledger/categories`), Tipos de mov. (`/app/m/runly.ledger/types`)

Tauri offline mode (Tier 2.5): account list, detail, transaction history, and summary charts read from local SQLite cache when offline. Writes, groups, import, and export remain online-only.

## runly.website

Owns the public website CMS: pages, blog, themes, menus, Puck visual editor, and dist-upload for external builds.

Depends on: `runly.core`

Permissions: `website.access`, `website.site.read|update`, `website.pages.read|create|update|publish|delete`, `website.theme.read|update`, `website.menus.read|update`, `website.dist.upload`

Navigation: Sitio web (`/`), Contenido (`/pages`, `/blog`), Diseno (`/theme`, `/templates`), Negocio (`/forms`, `/payments`), Configuracion (`/settings`)

Kind: `WEBSITE` (not `CORE`). Uninstallable via data purge.

## runly.calendar

Owns personal and shared calendars, events, reminders, and Google Calendar sync (OAuth-based source import).

Depends on: `runly.core`, `runly.identity`

Permissions: `calendar.access`, `calendar.calendars.read|create|update|delete`, `calendar.events.read|create|update|delete`, `calendar.share.manage`

Navigation: Calendario (`/app/m/runly.calendar/calendar`)

Full-screen module (fullscreenPaths: `/calendar`).

## runly.activity

Owns the cross-module activity feed: readable business event log surfaced in the notification bell and timeline.

Depends on: `runly.core`, `runly.identity`

Permissions: `activity.access`, `activity.read`, `activity.publish`, `activity.manage`

Navigation: Actividad (`/`)

Exposes: `publishActivity`, `logAndPublish` functions consumed by other modules.

## runly.notifications

Owns user notification inbox: in-app alerts with priority levels, push delivery (Web Push via service worker), and per-user channel preferences.

Depends on: `runly.core`, `runly.identity`

Permissions: `notifications.access`, `notifications.read`, `notifications.publish`, `notifications.manage`

Navigation: Notificaciones (`/app/m/runly.notifications`), Configuracion (`/app/m/runly.notifications/settings`)

## runly.catalog

Owns product catalog: categories, products (simple and variable), variants, option sets, and inventory stock movements.

Depends on: `runly.core`

Permissions: `catalog.access`, `catalog.products.read|create|update|delete`, `catalog.categories.read|create|update|delete`, `catalog.inventory.adjust`

Navigation: Productos (`/app/m/runly.catalog`), Categorias (`/app/m/runly.catalog/categories`), Inventario (`/app/m/runly.catalog/inventory`)

## runly.projects

Owns project management: projects, task boards (kanban), tasks, statuses, members, file attachments, and task dependencies.

Depends on: `runly.core`, `runly.company`, `runly.calendar` (optional)

Permissions: `projects.access`, `projects.project.read|create|update|delete`, `projects.task.read|create|update|delete`, `projects.member.manage`

Navigation: Proyectos (`/app/m/runly.projects`)

Kanban boards with drag-and-drop (desktop + touch), inline @mention for members, optimistic updates, and mobile-first UX. Tasks support file attachments, dependency linking, and push notifications for assignments.

## runly.purchases

Core module (`core: true`, `uninstallable: false`, color `#0f766e`). Owns the acquisition of goods and services: purchase cases (expedientes), requests, quotes, approvals, purchase orders (with lines), receipts (partial reception), supplier invoices with payment status, supplier profiles, and the N:N relations between purchase documents and other modules' records. Spec: `docs/superpowers/specs/2026-09-30-purchases-core-redesign-design.md`.

Depends on: `runly.core`, `runly.contacts`. Consumes (optional): `runly.files`, `runly.inventory`. Works without Inventario, Flotilla or Finanzas installed.

Process model:
- **Capabilities** (what is used): `requests`, `quotes`, `approvals`, `purchaseOrders`, `receipts`, `invoices`, `payments`, `inventoryRelations`. Navigation, routes, tabs, buttons and endpoints all honour them; the backend enforces them (`CAPABILITY_DISABLED` 409).
- **Workflow** (how stages are ordered): `REQUEST → QUOTES → APPROVAL → PURCHASE_ORDER → RECEIPT → INVOICE → PAYMENT → CLOSE`, each stage `REQUIRED | OPTIONAL | CONDITIONAL | DISABLED`. Presets: Simple, Básico, Compras + Inventario, Completo, Personalizado. Stored per company.
- **Policies** (when a conditional stage becomes mandatory): pure `evaluatePolicies()` in `purchase-policies.js`; unsatisfied requirements block `issue` / `pay` / `close` with `POLICY_BLOCKED` 409.

Inventory bridge: relations live in the generic `entity_relation` table (origin `MANUAL | INHERITED | AUTOMATIC | MIGRATED`), money splits in `purchase_allocation`. The inventory item detail renders `runly.purchases:InventoryPurchaseSection` (registered in `apps/desktop/src/lib/moduleComponentRegistry.js`) over `GET /purchases/inventory/:itemId/summary`: an adaptive vertical timeline with only the enabled stages that have documents, the allocated amount, create order/invoice (navigates to the purchases editor with `?inventoryId=`), link existing (`GET /purchases/documents/search`) and unlink. Inventario keeps the object: `inv_item.acquisition_origin` (`PURCHASE | DONATION | TRANSFER | LEASE | INTERNAL | INITIAL_STOCK | OTHER`, validated by `normalizeAcquisitionOrigin` in `inventory-service.js`); the legacy `purchaseDate/purchasePrice/vendorName/invoiceNumber` fields are shown read-only as "Datos de compra heredados" (form only when the item already has them, flagged by `hasLegacyPurchaseData`).

Permissions: `purchases.access`, `purchases.read`, `purchases.case.read|manage`, `purchases.request.read|create|update`, `purchases.quote.read|manage`, `purchases.approval.decide`, `purchases.order.read|create|update`, `purchases.receipt.read|create`, `purchases.invoice.read|create|update`, `purchases.payment.manage`, `purchases.supplier.read|manage`, `purchases.relation.read|manage`, `purchases.settings.read|manage`

Navigation (filtered at runtime by capability): Resumen (`/app/m/runly.purchases/purchases`), Expedientes (`/cases`), Solicitudes (`/requests`), Aprobaciones (`/approvals`), Órdenes (`/orders`), Recepciones (`/receipts`), Facturas (`/invoices`), Pagos (`/payments`), Proveedores (`/suppliers`), Configuración (`/settings`)

Help: `apps/api/src/manifests/official/help/runly.purchases/` (overview + one article per screen), loaded through `loadHelpBlueprints` in the manifest.

MirAI integration points: `apps/api/src/services/purchases-assistant-context.js` exposes read-only, company-scoped helpers (`pendingActions`, `findDocuments`, `supplierSpend`, `itemPurchaseHistory`) returning compact JSON. They are not wired into MirAI yet; a later iteration should expose them as assistant tools following the `inventory-chat-actions.js` pattern (read-only first, any write as a user-confirmed proposal).

Out of scope: automatic workflow selection by amount (the model allows it via `purchase_case.workflow_id`), ledger posting, CFDI XML parsing, supplier portal, e-mailing purchase orders.

## Source of truth

Canonical runtime/seed manifests for official modules are in:
- `apps/api/src/manifests/official/core-modules.js` — runly.core, runly.identity, runly.files, runly.company, runly.fleet, runly.ledger, runly.catalog, runly.calendar
- `apps/api/src/manifests/official/feature-modules.js` — runly.contacts, runly.hr, runly.website, runly.activity, runly.notifications (and `featureModules = []` export, all are seeded via `coreModules` array in core-modules.js)
## runly.files Office extension

`runly.files` optionally opens DOCX/XLSX/PPTX at
`/app/m/runly.files/files/:id/edit` with Collabora CODE. Read-only users receive a
view session; editing requires current `files.assets.update` in the document's
company and access to any parent entity. Shared attachments reuse the same
entry point. FileAssetVersion stores internal recovery pointers; no extra asset
is created on save. The original file previews/downloads remain available when
Office is disabled. See [Office operations](deployment/office-collabora.md).
