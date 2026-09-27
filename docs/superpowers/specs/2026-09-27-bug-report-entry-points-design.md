# Persistent Bug Report Entry Points

## 1. Feature title

Persistent "Reportar un problema" entry points (desktop footer + mobile user menu).

## 2. Status

Approved

## 3. Context

Runly ERP already has a bug-reporting pipeline (`BugReportHost.jsx` + `BugReportDialog.jsx` + `bugReportBus.js` + `POST /support/report-bug`), but the only two call sites that trigger it are `ErrorState` and `ApiErrorScreen` — both of which only render when something has already gone wrong (a 502, an uncaught error boundary, a failed API call). During this session's production incident triage, the user asked for a way to report something (a rough edge, a confusing screen, a suspicion something's off) without the app having actually crashed, and asked where such an entry point should live.

## 4. Problem

There is no way to open the bug-report dialog during normal, error-free app usage. A user who notices something wrong but doesn't hit an actual crash/API-error screen has no path to report it short of contacting someone directly.

## 5. Goals

1. Add a bug-report trigger that is reachable at all times during normal app usage, not gated behind an error state.
2. On desktop (`lg` and up), place it as a small icon+tooltip in the bottom `BrandFooter`, next to the "Hecho con amor por Racoon Devs" credit.
3. On mobile/tablet (below `lg`), place it as an item in the user avatar dropdown (`UserMenu`).
4. Best-effort auto-detect the current module/screen and include it in the report context, so support sees more than a bare URL.
5. Reuse the existing dialog, screenshot capture, rate limiting, and email pipeline without modification.

## 6. Non-goals

1. Changing `ErrorState`/`ApiErrorScreen`'s existing crash-triggered behavior.
2. A new backend endpoint, table, or email template — the existing `POST /support/report-bug` contract is unchanged.
3. An always-visible floating action button, badge/unread indicator, or in-app history of past reports.
4. Resolving `RUNLY_SUPPORT_EMAIL` not being configured on an instance — the existing 503 behavior (`support_report_error`/`not_configured`) is unchanged and out of scope here.

## 7. User stories

1. As a desktop user, I want a small, unobtrusive "report a problem" icon always visible near the bottom of the screen, so that I can report something without needing an error to have occurred.
2. As a mobile user, I want the same option available from my user menu, so that I have the same capability on a small screen where a persistent footer icon isn't practical.
3. As a member of the Runly support team, I want the report's context to show me which module and route the user was on, so that I don't have to ask a follow-up question just to start investigating.

## 8. UX requirements

- Desktop trigger: a `Bug` (lucide-react) icon button inside `BrandFooter`, positioned immediately to the left of the "Hecho con amor por Racoon Devs" link, in the same right-hand cluster. Wrapped in the existing `Tooltip`/`TooltipTrigger`/`TooltipContent` components from `@runly/ui` (no new `TooltipProvider` — `AppEntry.jsx` already mounts one at the app root). Tooltip label: "Reportar un problema".
- Mobile trigger: a `DropdownMenuItem` in `UserMenu.jsx` labeled "Reportar un problema" with a `Bug` icon, styled identically to the existing items (`Mi perfil`, `Configuración`, etc.).
- Breakpoint parity: the desktop trigger already only renders at `lg+` (`BrandFooter`'s existing `className="hidden lg:flex"` in `RunlyApp.jsx`). The mobile menu item must be wrapped in `<div className="lg:hidden">` so the two never overlap and no breakpoint is left without either option.
- Clicking either trigger opens the existing `BugReportDialog` exactly as today (screenshot capture via `html2canvas`, optional description textarea, submit/cancel). No `errorMessage` is passed, so the dialog's error-message block simply doesn't render (existing conditional behavior, unchanged).
- All new UI text is in Spanish, per project convention.

## 9. Routes/screens

No new routes or screens. Both triggers are additions to existing, already-mounted shell components:
- `packages/ui/src/components/BrandFooter.jsx` (desktop, rendered by `apps/desktop/src/app/RunlyApp.jsx`)
- `apps/desktop/src/components/UserMenu.jsx` (mobile, rendered by `apps/desktop/src/components/Topbar.jsx`, present at every breakpoint)

## 10. Data model

N/A — no new or modified Prisma models.

## 11. Prisma impact

N/A — no migration.

## 12. API contract

N/A — reuses the existing `POST /support/report-bug` endpoint (`apps/api/src/routes/support-routes.js`) unmodified.

## 13. SDK contract

N/A — reuses the existing `runly.support.reportBug(data, token)` method unmodified.

## 14. Validator contract

N/A — no new or modified Zod schemas.

## 15. Module manifest impact

N/A — no module manifest changes; this lives in the app shell, not inside a module.

## 16. Navigation impact

N/A — not a navigation entry (no permission gate, no route); it's a utility action, same as the existing "Cerrar sesión"/"Chat"/"Actividad" items already in `UserMenu`.

## 17. Blueprint impact

N/A.

## 18. RBAC/permissions

N/A — no permission gate. The existing `ErrorState`/`ApiErrorScreen` triggers have none either (any authenticated user can report a bug); these new entry points follow the same rule.

## 19. Multi-company behavior

Unchanged from the existing pipeline: `BugReportHost.jsx` already attaches the active session's company context server-side (`support-report-service.js`'s `sendViaAvailableSmtp({ companyId, ... })`). No new company-scoping logic is introduced.

## 20. Files/storage impact

N/A — the screenshot is sent as a `data:` URL turned into a direct email attachment (`screenshotAttachment()` in `support-report-service.js`), never persisted to Supabase Storage. Unchanged.

## 21. Export/import requirements

N/A.

## 22. Audit log requirements

N/A — the existing pipeline does not write to `AuditLog` today (it sends an email via SMTP), and this feature doesn't change that.

## 23. Edge cases

1. **No active module** (user on `/app/home` or a non-module route): `activeModuleKey` is `null`/`undefined` on both triggers. Context falls back to just `window.location.pathname`, matching `ErrorState`'s existing fallback behavior exactly.
2. **`RUNLY_SUPPORT_EMAIL` not configured on this instance**: `POST /support/report-bug` still returns its existing 503 (`not_configured`); `BugReportHost.jsx`'s existing `catch` surfaces that as the dialog's error message. No new handling needed — behavior is identical to today's crash-triggered path.
3. **Rate limiting**: the existing 5-minute per-user rate limit (`support-report-service.js`) applies identically regardless of which trigger opened the dialog — a user cannot bypass it by using the new entry point right after a crash-triggered report.
4. **Screenshot capture failure** (e.g. a canvas-tainting cross-origin image on screen): already a best-effort try/catch in `BugReportHost.jsx` — the report still sends without a screenshot, unchanged.
5. **Both triggers technically mounted at once during a breakpoint resize**: Tailwind's `hidden`/`lg:hidden`/`lg:flex` classes are purely CSS — there is no state to desync, so resizing the window live never shows both or neither.

## 24. Risks

1. **Icon crowding in `BrandFooter`** — the footer already has three regions (edition/version, centered help tip, credit link) on a `h-12` bar. Mitigation: the icon is small (matching existing icon sizing conventions elsewhere in the shell, e.g. `NotificationBell`), placed immediately adjacent to the credit link with normal `gap` spacing, no new region.
2. **Context string usefulness** — `activeModuleKey` is a raw key (e.g. `runly.core`), not a human-friendly module name; support staff will need to recognize module keys. Accepted as sufficient for this version (still strictly more informative than the bare path alone); a friendlier name is a possible future enhancement (see §28).

## 25. Acceptance criteria

1. Given a desktop viewport (`lg` and up) on any screen, when the user looks at the bottom footer, then a `Bug` icon with a tooltip reading "Reportar un problema" is visible next to the "Hecho con amor por Racoon Devs" link.
2. Given a desktop viewport, when the user clicks that icon, then the existing `BugReportDialog` opens with a screenshot captured and no error message shown.
3. Given a viewport below `lg`, when the user opens the avatar dropdown (`UserMenu`), then a "Reportar un problema" item is present and the footer icon is not rendered.
4. Given a viewport below `lg`, when the user clicks that menu item, then the same `BugReportDialog` opens identically to the desktop path.
5. Given the user is on a module route (e.g. `/app/m/runly.core/module-builder/<id>`), when a report is submitted from either new trigger, then the email support receives shows a "Módulo / ruta" field containing both the module key and the full path (e.g. `runly.core · /app/m/runly.core/module-builder/<id>`).
6. Given the user is on a non-module route (e.g. `/app/home`), when a report is submitted, then the "Módulo / ruta" field falls back to the bare path, with no error thrown.
7. Given `RUNLY_SUPPORT_EMAIL` is unset on the instance, when a report is submitted from either new trigger, then the dialog shows the same "not available on this instance" error the crash-triggered path already shows.

## 26. Verification plan

- `pnpm exec eslint` on the three touched files (`BrandFooter.jsx`, `RunlyApp.jsx`, `UserMenu.jsx`).
- `pnpm --filter @runly/desktop run build:web` succeeds.
- Manual check in a running dev session: resize the viewport across the `lg` breakpoint and confirm exactly one of the two triggers is visible at all times; open the dialog from each; confirm the screenshot appears and the dialog closes cleanly on cancel.
- No automated test suite covers `BrandFooter`/`UserMenu` today (they are presentational shell components); none is added here, consistent with how `ErrorState`'s existing bug-report button is untested at this layer.

## 27. Rollback plan

Pure UI addition with no migration and no API change — revert is a plain `git revert` of the implementing commit(s). No data is created or altered by this feature that would need cleanup.

## 28. Future enhancements

1. Resolve `activeModuleKey` to the module's human-friendly display name (from `moduleMap`) instead of the raw key, for a more readable context field.
2. A lightweight in-app confirmation/history of previously sent reports (explicitly out of scope for this version per §6).
