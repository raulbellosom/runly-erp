# Username login

## 1. Feature title

Username login — sign in with "email or username".

## 2. Status

Complete. Verified: 2026-09-28 (service unit tests, web build, curl smoke tests on running API, manual login with a real account by the user). Users PDF export column deferred.

## 3. Context

The desktop login (`apps/desktop/src/auth/LoginScreen.jsx`) calls
`supabase.auth.signInWithPassword({ email, password })` directly from the
client. Supabase Auth only accepts email or phone as identifier, and
`UserProfile` has no username field. Some operators (shared terminals, staff
without a personal work email) prefer a short username.

## 4. Problem

Users can only sign in by typing their full email address. There is no way to
define or use a shorter, memorable identifier.

## 5. Goals

1. A user with a username can sign in by typing either their username or their email.
2. Users without a username keep signing in with their email, unchanged.
3. Admins can set/edit a user's username; users can set/edit their own.
4. Login and password recovery never reveal whether a username or email exists.
5. Password recovery ("Olvidé mi contraseña") accepts username or email.

## 6. Non-goals

1. Storefront login (`/public/storefront/auth/login`) and `PublicClientLogin.jsx` stay email-only.
2. No per-company usernames — usernames are instance-wide.
3. No mandatory username / no backfill of existing users.
4. No username-only accounts without email (Supabase still requires an email).
5. No change to session handling after login (AuthProvider, refresh, sign-out).

## 7. User stories

1. As an employee, I want to sign in with my username so that I don't have to type my full email.
2. As an admin, I want to assign a username when creating a user so that they can sign in with it from day one.
3. As an admin, I want to change a user's username from the user detail screen.
4. As a user, I want to set or change my own username from my profile.
5. As a user who forgot my password, I want to request a reset link by typing my username.

## 8. UX requirements

- Login field label: "Correo o nombre de usuario"; placeholder "tu@empresa.com o usuario"; `type="text"`, `autoComplete="username"`, user icon.
- Submit enabled when identifier (trimmed) and password are non-empty (no email-format check).
- Invalid credentials message (unchanged wording, adjusted): "Credenciales incorrectas. Verifica tus datos e intenta de nuevo."
- Unconfirmed email keeps: "Tu cuenta no ha sido confirmada. Contacta al administrador."
- Rate-limited: "Demasiados intentos. Espera unos minutos e intenta de nuevo."
- Forgot-password dialog: label "Correo o nombre de usuario"; success copy: "Si la cuenta existe, enviamos un enlace para restablecer la contraseña al correo asociado."
- Username input (admin create/edit + profile): `TextField` "Nombre de usuario", helper "3 a 30 caracteres: letras, números, punto, guion o guion bajo." Input is lowercased on blur. Duplicate error: "Ese nombre de usuario ya está en uso."
- Clearing the field (empty string) removes the username.

## 9. Routes/screens

- `/app/login` — `LoginScreen.jsx` (shell, no module).
- Identity user create form and user detail edit (runly.identity).
- Profile screen (`/profile/me` consumer, shell).

## 10. Data model

`UserProfile`:
- `username String?` — stored lowercased; unique instance-wide (case-insensitive).

Format (`usernameSchema`): 3–30 chars, `^[a-z0-9._-]+$` after trim + lowercase,
must not start or end with `.`/`-`/`_`. Never contains `@`, so it can never be
confused with an email.

## 11. Prisma impact

- Modify `UserProfile`: add `username String? @map("username")`.
- New forward migration: add column + `CREATE UNIQUE INDEX user_profile_username_lower_key ON user_profile (lower(username))` (table is `@@map("user_profile")`). Multiple NULLs allowed.
- Run `pnpm db:generate` after.

## 12. API contract

### `POST /auth/login` (public, no auth)

Request: `{ identifier: string, password: string }`

Resolution:
1. `identifier` trimmed; if it contains `@` → treated as email (lowercased).
2. Otherwise → lowercase, look up `UserProfile` where `lower(username) = identifier` and `enabled = true`; take its `email`.
3. Not found → respond 401 generic (no Supabase call, but same response shape/timing class).
4. `supabaseAnon.auth.signInWithPassword({ email, password })` server-side.

Responses:
- 200 `{ data: { access_token, refresh_token, expires_at } }`
- 400 `{ error: "Datos inválidos." }` — missing identifier/password.
- 401 `{ error: "Credenciales incorrectas.", code: "INVALID_CREDENTIALS" }` — unknown username, disabled profile, wrong password, unknown email.
- 403 `{ error: "...", code: "EMAIL_NOT_CONFIRMED" }` — Supabase "Email not confirmed".
- 429 `{ error: "...", code: "RATE_LIMITED" }` — too many attempts for this identifier.

Rate limit: in-memory, keyed by normalized identifier (and client IP when
available), same style as `lib/forgot-password-rate-limit.js`
(e.g. 10 failures / 15 min). Successful login resets the key.

### `POST /auth/forgot-password` (modified)

Request: `{ identifier }` (preferred) or legacy `{ email }`.
- `@` present → email path (existing behavior, email-format check stays → 400 on malformed).
- Otherwise → username lookup; if found and enabled, send reset to its email; if not, do nothing.
- Always returns the existing generic 200 response (except the malformed-email 400).
- Rate limit keyed by the resolved identifier as today.

### `POST /identity/users` (modified)

`createUserSchema` gains optional `username`. Duplicate → 409 `{ error: "Ese nombre de usuario ya está en uso." }`.

### `PATCH /identity/users/:id` (modified, admin branch)

Accepts `username` (string or `null`/`""` to clear). Validated with
`usernameSchema`. Duplicate → 409. Non-admin branch unchanged (still only `enabled`).

### `PUT /profile/me` (modified)

Accepts `username` with the same rules. Duplicate → 409.

### Read shapes

User serializers (`identity-shared.js` user mapper, `/profile/me` GET) include `username`.

## 13. SDK contract

- `runly.auth.login({ identifier, password })` → `{ access_token, refresh_token, expires_at }`.
- `runly.auth.forgotPassword(identifier)` — now sends `{ identifier }`.
- Identity/profile update methods pass `username` through (no signature change).

## 14. Validator contract

`@runly/validators`:
- `usernameSchema` — string, trim, lowercase, 3–30, regex above.
- `loginSchema` — `{ identifier: string().trim().min(1), password: string().min(1) }`.
- `createUserSchema` — add `username: usernameSchema.optional()`.
- Profile/user update schemas — add `username: usernameSchema.nullable().optional()` (empty string normalized to `null` before parse).

## 15. Module manifest impact

N/A.

## 16. Navigation impact

N/A.

## 17. Blueprint impact

N/A.

## 18. RBAC/permissions

- `POST /auth/login`, `POST /auth/forgot-password`: public.
- Admin edit: existing `identity.users.create` / `identity.users.update` + admin branch.
- Self edit: authenticated user on own profile.
No new permission keys.

## 19. Multi-company behavior

Usernames are instance-wide (login happens before a company is selected).
Company scoping for admin edits keeps the existing `assertUserInCompany` check.
An admin of company A can only set usernames for users in company A, but
uniqueness is checked across the whole instance (409 reveals only "in use").

## 20. Files/storage impact

N/A.

## 21. Export/import requirements

Add "Nombre de usuario" column to the identity users Excel/PDF exports.

## 22. Audit log requirements

- `identity.user.username_changed` — actor, target user, `{ before: { username }, after: { username } }` — for both admin edit and self edit.
- Login attempts are not audited (same as today).

## 23. Edge cases

1. Identifier with surrounding spaces or uppercase → normalized before lookup.
2. Username lookup matches a disabled `UserProfile` → 401 generic.
3. Username set for a user whose Supabase email changed → lookup always uses the current `UserProfile.email`.
4. Two concurrent updates setting the same username → unique index rejects the second; map Prisma `P2002` to 409.
5. Clearing a username (`""`/`null`) → stored as NULL; user can still log in by email.
6. Identifier without `@` that is not a valid username format → 401 generic (no 400, to avoid leaking format hints beyond what the UI already shows).
7. Legacy clients sending `{ email }` to forgot-password keep working.
8. Supabase unreachable → 503 `{ error: "Sin conexión con el servidor de autenticación." }`; UI shows the existing connection error.

## 24. Risks

1. Account enumeration via login/forgot responses — mitigation: identical 401/200 bodies for unknown vs wrong password; rate limit.
2. Brute force now goes through our API instead of directly to Supabase — mitigation: per-identifier rate limit; Supabase's own limits still apply.
3. Server-side login breaks client session setup — mitigation: client uses `supabase.auth.setSession(...)`, which fires the same `onAuthStateChange` the AuthProvider already listens to.
4. In-memory rate limit resets on API restart / not shared across replicas — accepted (same as forgot-password today).

## 25. Acceptance criteria

1. Given a user with username `jperez`, when they submit `jperez` + correct password, then they land on `/app` signed in.
2. Given the same user, when they submit `JPerez ` + correct password, then sign-in succeeds.
3. Given the same user, when they submit their email + correct password, then sign-in succeeds.
4. Given an unknown username, when submitted, then the API returns 401 with the same body as a wrong password.
5. Given a disabled profile, when its username is submitted with the correct password, then the API returns 401 generic.
6. Given 10 failed attempts for one identifier within 15 min, when an 11th is sent, then the API returns 429.
7. Given an admin creating a user with username `ana`, when `ana` is already taken, then the API returns 409 "Ese nombre de usuario ya está en uso."
8. Given a user editing their profile, when they set username `a@b`, then validation rejects it.
9. Given forgot-password with a known username, then a reset email is sent to that user's email and the response is the generic 200.
10. Given forgot-password with an unknown username, then no email is sent and the response is the same generic 200.
11. Given a username change, then an `identity.user.username_changed` audit entry exists with before/after.

## 26. Verification plan

- `node --test apps/api/src/services/__tests__/auth-login-service.test.js` — resolution (email, username, case/space, unknown, disabled), rate limit, error mapping.
- Validator unit test for `usernameSchema`.
- `pnpm lint`, `pnpm build:web`.
- `pnpm db:migrate` + `pnpm db:generate` against the dev instance.
- Manual: running dev API (reuse, do not restart) — curl `POST /auth/login` with username/email/unknown; login in the web preview with username; set username from profile and from identity detail; duplicate 409; forgot-password with username.

## 27. Rollback plan

- Revert the frontend to call `supabase.auth.signInWithPassword` directly (email only) — no data dependency.
- Column + index can stay (nullable, unused). If removal is required, add a new forward migration dropping the index and column; never edit the applied migration.

## 28. Future enhancements

1. Username login for storefront and public client portal.
2. Shared (Redis/DB) rate limiting across API replicas.
3. Username suggestions on user creation (from first/last name).
4. Optional instance setting to require a username for all users.
