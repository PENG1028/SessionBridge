# SessionBridge — Production Docker Image
# Multi-stage build: install → build → minimal runtime

# ─── Stage 1: Install dependencies ─────────────────
FROM node:20-slim AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ─── Stage 2: Build ────────────────────────────────
FROM node:20-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.server.json next.config.ts tailwind.config.ts postcss.config.mjs ./
COPY app/ app/
COPY src/ src/
COPY adapters/ adapters/
COPY lib/ lib/
COPY public/ public/

RUN npx next build
RUN npm run build:server

# ─── Stage 3: Runtime ──────────────────────────────
FROM node:20-slim AS runtime
WORKDIR /app

# Install Claude Code (optional, for AI agent features)
ARG INSTALL_CLAUDE=false
RUN if [ "$INSTALL_CLAUDE" = "true" ]; then \
      npm install -g @anthropic-ai/claude-code; \
    fi

# Copy built artifacts from previous stages
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/adapters ./adapters
COPY --from=build /app/lib ./lib

EXPOSE 8080

ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "require('http').get('http://localhost:8080/api/health', r => {process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

ENTRYPOINT ["node", "dist/index.js"]
CMD []
