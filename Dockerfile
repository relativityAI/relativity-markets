# syntax=docker/dockerfile:1
# One image = web app + API in one process on :8501. Web search (SearXNG) runs
# as a separate container via docker-compose.yml.
#
# Build stages are pinned to $BUILDPLATFORM: npm/tsc/vite run natively on the
# amd64 CI runner instead of under QEMU, so the arm64 build is mostly
# copy-only (docker builds went 15min -> ~2min warm). The runtime `npm ci`
# stays target-platform — native modules (@resvg/resvg-js) must match the
# container arch.

FROM --platform=$BUILDPLATFORM node:22-alpine AS client
WORKDIR /src/client
COPY client/package*.json ./
# npm 10's strict peer resolver crashes ("edgesOut") without the repo .npmrc.
COPY .npmrc ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY client/ ./
RUN npm run build

FROM --platform=$BUILDPLATFORM node:22-alpine AS api
WORKDIR /src/services
COPY services/package*.json ./
COPY .npmrc ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY services/ ./
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8501 RELATIVITY_HOST=0.0.0.0 SQLITE_PATH=/app/data/relativity.db
COPY --from=api /src/services/dist ./dist
# Runtime reads these relative to cwd: skills (config/skills), skill-repos.json,
# harness prompt assets + default agents. See harness/skills.ts + harness/config.ts.
COPY --from=api /src/services/config ./config
COPY --from=api /src/services/assets ./assets
COPY --from=api /src/services/harness/assets ./harness/assets
COPY --from=api /src/services/harness/agent-defaults ./harness/agent-defaults
COPY services/package*.json ./
COPY .npmrc ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev
# Container cwd is /app, so the client build sits one level *down* (dev runs
# from services/ and uses the ../client/dist default instead).
ENV CLIENT_DIST=./client/dist
COPY --from=client /src/client/dist ./client/dist
EXPOSE 8501
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/api/index.js"]
