# Multi-stage build for the MCP HTTP/SSE transport on Cloud Run.
# Final image: ~50MB Alpine + bundled JS, no transitive node_modules.

FROM node:20-alpine AS builder
WORKDIR /app

# Install deps using lockfile (npm ci is idempotent and lockfile-driven).
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Build with tsup; output is fully bundled into dist/cli.js + dist/http.js.
COPY tsconfig.json tsup.config.ts ./
COPY src ./src
COPY spec ./spec
RUN npm run build

# Runtime stage: only Node + the bundled entry points. No node_modules.
FROM node:20-alpine
WORKDIR /app

# Run as non-root for defense-in-depth.
RUN addgroup -S app && adduser -S app -G app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/spec ./spec
COPY --from=builder /app/package.json ./

USER app

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# Cloud Run sends SIGTERM on scale-down; http.ts handles graceful shutdown.
CMD ["node", "dist/http.js"]
