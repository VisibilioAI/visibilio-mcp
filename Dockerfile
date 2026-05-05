# Multi-stage build for the MCP HTTP/SSE transport on Cloud Run.
# Builder runs the full install + tsup build; runtime carries only the
# bundled entry points plus production deps (tsup externalizes runtime
# packages by default — keeps the npm-published tarball small and lets
# us pin a single source of truth in package-lock.json).

FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json tsup.config.ts ./
COPY src ./src
COPY spec ./spec
RUN npm run build

FROM node:20-alpine
WORKDIR /app

RUN addgroup -S app && adduser -S app -G app

# Production deps only — tsup externalizes packages listed under
# `dependencies`, so they must be present at runtime.
COPY --from=builder /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/spec ./spec

# Drop write perms on app code; runtime only reads.
RUN chown -R app:app /app
USER app

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# Cloud Run sends SIGTERM on scale-down; http.ts handles graceful shutdown.
CMD ["node", "dist/http.js"]
