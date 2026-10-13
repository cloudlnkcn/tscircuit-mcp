# syntax=docker/dockerfile:1

# ============================================================================
# tscircuit-mcp — full-featured MCP server for tscircuit
#
# Runtime image ships:
#   - the MCP server (dist/) with all transport modes
#   - the full `tscircuit` aggregate package (tsci CLI, core, eval, runframe,
#     footprinter, checks, soup-util, ... — all official subpackages)
#   - component libraries: @tscircuit/footprinter (footprints),
#     schematic-symbols (schematic symbol library),
#     @tscircuit/parts-engine (JLCPCB/EasyEDA parts engine)
# ============================================================================

# ----------------------------------------------------------------------------
# Stage 1 — build the MCP server
# ----------------------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY viewer ./viewer
RUN npm run build && npm run build:viewer

# ----------------------------------------------------------------------------
# Stage 2 — runtime
# ----------------------------------------------------------------------------
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production

# Runtime deps of the MCP server only (no dev toolchain needed)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/assets ./assets

# ---------------------------------------------------------------------------
# Full tscircuit toolchain + component libraries (globally, for CLI use
# inside the container: `tsci dev`, `tsci build`, `tsci export`, ...).
# The `tsci` CLI is a bun script (#!/usr/bin/env bun), so bun is installed too.
# ---------------------------------------------------------------------------
RUN npm install -g bun@latest \
 && npm install -g \
      tscircuit@latest \
      schematic-symbols@latest \
      @tscircuit/parts-engine@latest \
 && npm cache clean --force \
 && tsci --version

# Non-root user; /data holds artifacts (SVG / CSV / GLB / CircuitJson) and the
# persisted tscircuit registry component cache (prefetched @tsci/* packages).
RUN mkdir -p /data/output /data/registry-cache && chown -R node:node /data /app
USER node
ENV TSCIRCUIT_MCP_OUTPUT_DIR=/data/output \
    TSCIRCUIT_MCP_REGISTRY_CACHE=/data/registry-cache \
    TSCIRCUIT_REGISTRY_API_BASE_URL=https://registry-api.tscircuit.com

VOLUME ["/data/output", "/data/registry-cache"]
EXPOSE 3000

# Default: Streamable HTTP. Override with `command:` for stdio
# (e.g. `docker run -i tscircuit-mcp node dist/index.js`).
CMD ["node", "dist/index.js", "--http", "--host", "0.0.0.0", "--port", "3000"]
