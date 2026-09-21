FROM node:22-alpine
WORKDIR /app
RUN corepack enable
# Copy workspace manifests for deterministic install
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY prisma.config.ts prisma.config.ts
COPY apps/api/package.json apps/api/package.json
COPY apps/desktop/package.json apps/desktop/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/module-engine/package.json packages/module-engine/package.json
COPY packages/offline/package.json packages/offline/package.json
COPY packages/sdk/package.json packages/sdk/package.json
COPY packages/storefront-sdk/package.json packages/storefront-sdk/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/validators/package.json packages/validators/package.json
COPY prisma prisma
ENV DIRECT_URL=postgresql://postgres:postgres@localhost:5432/postgres
# Single RUN: install (full) → generate Prisma client → prune devDeps.
# Chaining in one instruction means the final layer only contains the
# production state — devDependencies never make it into the image layers.
RUN pnpm install --frozen-lockfile && \
    pnpm prisma:generate && \
    pnpm prune --prod
# Copy full sources after install: packages/* and modules/* change on nearly every
# commit but neither is needed for `pnpm install` (modules/ isn't even a workspace
# member), so copying them here keeps the expensive install+prisma layer cached.
# api/src is required because apps/worker/src/index.js imports directly from it.
COPY packages packages
COPY modules modules
COPY apps/api apps/api
COPY apps/worker apps/worker
CMD ["pnpm", "--filter", "@runly/worker", "start"]
