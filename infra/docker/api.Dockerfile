FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
# IMPORTANT: this `deps` stage must stay byte-identical to the one in
# worker.Dockerfile. BuildKit then reuses the same cached layers for both
# images, so the (slow, QEMU-emulated on arm64) install only runs once per
# release and the resulting layer is pushed once and shared by both tags.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY prisma.config.ts prisma.config.ts
COPY apps/api/package.json apps/api/package.json
COPY apps/desktop/package.json apps/desktop/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/module-compiler/package.json packages/module-compiler/package.json
COPY packages/module-engine/package.json packages/module-engine/package.json
COPY packages/offline/package.json packages/offline/package.json
COPY packages/sdk/package.json packages/sdk/package.json
COPY packages/storefront-sdk/package.json packages/storefront-sdk/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/validators/package.json packages/validators/package.json
# Install depends only on the manifests above, so it stays cached across
# schema changes and new migrations (which land on almost every feature).
RUN pnpm install --frozen-lockfile
# Only schema.prisma is needed to generate the client; migrations/seed are
# copied in the final stage so adding a migration never re-runs generate.
COPY prisma/schema.prisma prisma/schema.prisma
RUN DIRECT_URL=postgresql://postgres:postgres@localhost:5432/postgres pnpm prisma:generate && \
    pnpm prune --prod

FROM node:22-alpine
WORKDIR /app
RUN corepack enable
# Pruned production tree only — devDependencies stay behind in the deps stage.
COPY --from=deps /app /app
# Copy full sources after install: packages/* and modules/* change on nearly every
# commit but neither is needed for `pnpm install` (modules/ isn't even a workspace
# member), so copying them here keeps the expensive install+prisma layer cached.
COPY prisma prisma
COPY packages packages
COPY modules modules
COPY apps/api apps/api
COPY apps/desktop/public/module-logos apps/desktop/public/module-logos
COPY infra/docker/api-entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh
EXPOSE 4010
CMD ["/entrypoint.sh"]
