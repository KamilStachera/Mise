# Built from the repo root (it bundles the pichci MCP server): docker compose builds it.
FROM node:22-slim AS mcp
WORKDIR /src/mcp
COPY mcp/package.json mcp/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY mcp/tsconfig.json ./
COPY mcp/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
# Codex shells out for file reads (rg, sed); ca-certificates for the ChatGPT backend.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates ripgrep \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY sous/package.json ./
RUN npm install --omit=dev --no-audit --no-fund \
    # `docker compose exec sous codex login --device-auth` needs the CLI on PATH.
    && ln -s /app/node_modules/@openai/codex/bin/codex.js /usr/local/bin/codex
COPY sous/server.mjs ./
COPY --from=mcp /src/mcp/dist ./mcp/dist
COPY --from=mcp /src/mcp/node_modules ./mcp/node_modules
COPY mcp/package.json ./mcp/package.json
ENV CODEX_HOME=/root/.codex
EXPOSE 8090
CMD ["node", "server.mjs"]
