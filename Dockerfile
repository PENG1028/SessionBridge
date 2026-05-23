# SessionBridge — Production Docker Image
# Multi-stage build: deps → build-web → build-go → runtime
# Go Core is the sole runtime. Node relay has been retired.
#
# .next/ is the Next.js production build (served via `next start` or reverse proxy).
# Go Core listens on :8080 (API + WebSocket).

# ─── Stage 1: Production dependencies ────────────
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ─── Stage 2: Build Next.js frontend ─────────────
FROM node:20-slim AS build-web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json next.config.ts tailwind.config.ts postcss.config.mjs ./
COPY app/ app/
COPY lib/ lib/
COPY public/ public/
RUN npm run build:web

# ─── Stage 3: Build Go Core ──────────────────────
FROM golang:1.23-alpine AS build-go
WORKDIR /src
COPY go-core/ ./
RUN CGO_ENABLED=0 go build -o sessionnode ./cmd/node

# ─── Stage 4: Runtime ────────────────────────────
FROM node:20-slim AS runtime
WORKDIR /app

ARG INSTALL_CLAUDE=false
RUN if [ "$INSTALL_CLAUDE" = "true" ]; then \
      npm install -g @anthropic-ai/claude-code; \
    fi

# Production node_modules (for bin/bridge.js and scripts)
COPY --from=deps /app/node_modules ./node_modules

# Next.js production build
COPY --from=build-web /app/.next ./.next

# Go Core binary
COPY --from=build-go /src/sessionnode ./dist/go-core/sessionnode

# Runtime files
COPY package.json ./
COPY bin/ bin/
COPY scripts/start-core.js ./scripts/start-core.js
COPY plugins/ plugins/
COPY public/ public/

EXPOSE 8080

ENV NODE_ENV=production
ENV LISTEN_ADDR=0.0.0.0:8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "require('http').get('http://localhost:8080/health', r => {process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

ENTRYPOINT ["node", "bin/bridge.js", "core"]
CMD []
