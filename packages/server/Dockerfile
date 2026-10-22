# ===========================
# Build Stage
# ===========================
FROM node:22.23.2-alpine AS builder

WORKDIR /app

# Copy workspace configuration and package files first for caching
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./

# Install the exact pnpm version from package.json's "packageManager" field.
# Prefer a direct npm global install over upgrading corepack: under QEMU
# arm64 emulation, `npm install -g corepack@…` has been observed to SIGILL
# (exit 132) on GitHub Actions multi-arch builds.
RUN PNPM_VERSION="$(node -p "require('./package.json').packageManager.replace(/^pnpm@/, '')")" && \
    test -n "$PNPM_VERSION" && \
    npm install -g "pnpm@${PNPM_VERSION}" && \
    rm -rf /root/.npm
COPY scripts ./scripts
COPY packages/shared/package.json ./packages/shared/
COPY packages/core/package.json ./packages/core/
COPY packages/server/package.json ./packages/server/
COPY packages/cli/package.json ./packages/cli/

# Copy all source code before installing dependencies to avoid symlink conflicts
COPY packages/shared ./packages/shared
COPY packages/core ./packages/core
COPY packages/server ./packages/server
COPY packages/cli ./packages/cli

# Install all dependencies
RUN pnpm install --frozen-lockfile && \
    pnpm store prune

# Build all packages (shared before core — core imports @caeliq/ccr-shared)
WORKDIR /app/packages/shared
RUN pnpm build

WORKDIR /app/packages/core
RUN pnpm build

WORKDIR /app/packages/server
RUN pnpm build && \
    rm -rf node_modules/.cache

WORKDIR /app/packages/cli
RUN pnpm build

# ===========================
# Production Stage
# ===========================
# Pin to the current Node 22 LTS patch. The workspace floor is >=22.19.0
# (undici). Keep in sync with the builder stage.
FROM node:22.23.2-alpine AS production

# Install PM2, curl, and pm2-logrotate
RUN apk add --no-cache curl && \
    npm install -g pm2 pm2-logrotate --no-scripts && \
    pm2 install pm2-logrotate && \
    pm2 set pm2-logrotate:max_size 100M && \
    pm2 set pm2-logrotate:retain 5 && \
    pm2 set pm2-logrotate:compress true && \
    pm2 set pm2-logrotate:rotateInterval '0 0 * * *'

WORKDIR /app

# Copy core package (workspace dependency)
COPY --from=builder /app/packages/core ./packages/core

# Copy CLI bundle
COPY --from=builder /app/packages/cli/dist ./packages/cli/dist

# Make CLI executable and create symlink for 'ccr' command
RUN chmod +x /app/packages/cli/dist/cli.js && \
    ln -sf /app/packages/cli/dist/cli.js /usr/local/bin/ccr

# Add CLI dist to PATH (for direct access)
ENV PATH="/app/packages/cli/dist:$PATH"

# Copy server bundle from build stage
COPY --from=builder /app/packages/server/dist ./packages/server/dist
# Copy PM2 configuration file
COPY packages/server/ecosystem.config.cjs /app/

# Create logs directory
RUN mkdir -p /root/.claude-code-router/logs

# Expose API port (host 1455/51121 also map here for OAuth callbacks)
EXPOSE 3456

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://127.0.0.1:3456/health || exit 1

# Start the application
CMD ["pm2-runtime", "start", "/app/ecosystem.config.cjs"]