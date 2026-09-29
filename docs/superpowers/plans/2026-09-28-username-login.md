# Username login — plan

Spec: `docs/superpowers/specs/2026-09-28-username-login-design.md`

1. Prisma: `UserProfile.username String?` + forward migration with unique index on `lower(username)`.
2. Validators: `usernameSchema`, `loginSchema`; `createUserSchema.username` optional.
3. API: `services/auth-login-service.js` (resolve identifier, rate limit, sign in) + unit tests; `POST /auth/login`; `/auth/forgot-password` accepts `identifier`.
4. API: `username` in `POST /identity/users`, `PATCH /identity/users/:id` (admin), `PUT /profile/me`, user serializers, audit `identity.user.username_changed`, 409 on duplicates.
5. SDK: `auth.login`, `auth.forgotPassword(identifier)`.
6. Desktop: login + forgot dialog use identifier and `setSession`; username field in user create, user detail edit and profile.
7. Verify: tests, lint, build:web, db migrate, curl against running API.
