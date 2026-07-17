# Process capture — single deployable (BUILD-REQUIREMENTS §4).
# Multi-stage: build with full toolchain, run on a slim image. Migrations run at
# container start against the SQLite volume, then Next serves both faces.

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
ENV DATABASE_URL=file:./data/app.db

# Only what the running app needs.
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.mjs ./next.config.mjs
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/scripts/migrate.mjs ./scripts/migrate.mjs
COPY --from=builder /app/node_modules ./node_modules

# The SQLite database lives on a volume so it survives redeploys (back it up by
# copying data/app.db — see README).
VOLUME ["/app/data"]
EXPOSE 3000

CMD ["sh", "-c", "node scripts/migrate.mjs && node node_modules/next/dist/bin/next start"]
