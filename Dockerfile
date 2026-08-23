# Magpie — single deployable (BUILD-REQUIREMENTS §4).
# Multi-stage: build with full toolchain, run on a slim image. Migrations run at
# container start and the container refuses to start if they fail, then Next
# serves both faces.

FROM node:20-bookworm AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Production dependencies only, resolved separately from the build.
#
# The runner used to copy the builder's node_modules, which is everything `npm ci`
# installed — Playwright and its browsers, Vitest, drizzle-kit, the whole test
# toolchain — shipped to an internet-facing container that never runs any of it.
# That is a larger image, a longer pull on a cold start, and a much larger set of
# packages whose CVEs someone has to answer for. A separate stage rather than
# `npm prune` in the builder, so the build's own tools are never in the layer that
# is copied forward.
#
# `--omit=dev` alone is not enough, which is not obvious and cost a wrong first
# attempt: `next` declares `@playwright/test` as an OPTIONAL PEER, so npm records
# it in the lockfile as a production package and installs it — browsers and all —
# even though nothing here has it as anything but a devDependency. Omitting
# optional and peer as well takes node_modules from 350M to 166M and removes the
# test toolchain entirely. Every genuine runtime peer (react, react-dom) is a
# direct dependency, so nothing needed goes missing; the running container below
# is the check on that claim.
FROM node:20-bookworm AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional --omit=peer

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# DATABASE_URL is deliberately NOT defaulted. It is a Postgres connection string
# injected by the platform's secret store; a default here would only ever be
# wrong, and lib/db refuses a non-postgres:// URL at startup (DL.68).

# Only what the running app needs.
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.mjs ./next.config.mjs
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/scripts/migrate.mjs ./scripts/migrate.mjs
# Administrative CLI, run as a Cloud Run job on the VPC — the database has a
# private address only, so this is the path in that does not involve opening the
# network for an errand.
COPY --from=builder /app/scripts/console-user.mjs ./scripts/console-user.mjs
COPY --from=deps /app/node_modules ./node_modules

# Drop root. An internet-facing Next.js app with 'unsafe-eval' in its CSP should
# not be uid 0 — any RCE would otherwise be root in the container, one hop from
# the metadata server and a token carrying secretAccessor on the database URL.
USER node

EXPOSE 3000

CMD ["sh", "-c", "node scripts/migrate.mjs && node node_modules/next/dist/bin/next start"]
