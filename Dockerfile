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
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 3000

CMD ["sh", "-c", "node scripts/migrate.mjs && node node_modules/next/dist/bin/next start"]
