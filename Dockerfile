# syntax=docker/dockerfile:1
# One image = web app + API in one process on :8501. Web search (SearXNG) runs
# as a separate container via docker-compose.yml.
#
# Build stages are pinned to $BUILDPLATFORM: npm/tsc/vite run natively on the
# amd64 CI runner instead of under QEMU, so the arm64 build is mostly
# copy-only (docker builds went 15min -> ~2min warm). The runtime `npm ci`
# stays target-platform — native modules (@resvg/resvg-js) must match the
# container arch.
#
# This is an npm workspace, so there is exactly ONE lockfile: the one at the
# repo root. Every stage installs from it; client/ and services/ package*.json
# are copied in only so npm can resolve the workspace members.

FROM --platform=$BUILDPLATFORM node:22-alpine AS client
WORKDIR /src
COPY package.json package-lock.json .npmrc ./
COPY client/package.json client/
COPY services/package.json services/
RUN --mount=type=cache,target=/root/.npm npm ci --workspace=client
COPY client/ client/
RUN npm run --workspace=client build

FROM --platform=$BUILDPLATFORM node:22-alpine AS api
WORKDIR /src
COPY package.json package-lock.json .npmrc ./
COPY client/package.json client/
COPY services/package.json services/
RUN --mount=type=cache,target=/root/.npm npm ci --workspace=services
COPY services/ services/
RUN npm run --workspace=services build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8501 RELATIVITY_HOST=0.0.0.0 SQLITE_PATH=/app/data/relativity.db
COPY --from=api /src/services/dist ./dist
# Runtime reads these relative to cwd: skills (config/skills), skill-repos.json,
# harness prompt assets and default agents. See harness/skills.ts + harness/config.ts.
COPY --from=api /src/services/config ./config
COPY --from=api /src/services/assets ./assets
COPY --from=api /src/services/harness/assets ./harness/assets
COPY --from=api /src/services/harness/agent-defaults ./harness/agent-defaults
COPY package.json package-lock.json .npmrc ./
COPY client/package.json client/
COPY services/package.json services/
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --workspace=services
# The workspace lock parks some services deps in services/node_modules, but the
# built app sits at /app/dist — without this, `import "multer"` can't resolve.
RUN ln -s ../services/node_modules dist/node_modules
# npm needed the workspace root manifest to install, but the nearest package.json
# to dist/ decides module type — restore the services one (it declares ESM).
COPY services/package.json ./package.json
# Container cwd is /app, so the client build sits one level *down* (dev runs
# from services/ and uses the ../client/dist default instead).
ENV CLIENT_DIST=./client/dist
COPY --from=client /src/client/dist ./client/dist
EXPOSE 8501
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/api/index.js"]
