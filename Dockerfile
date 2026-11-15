# One image = web app + API in one process on :8080. Web search (SearXNG) runs
# as a separate container via docker-compose.yml.
FROM node:22-alpine AS client
WORKDIR /src/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:22-alpine AS api
WORKDIR /src/services
COPY services/package*.json ./
RUN npm ci
COPY services/ ./
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 SQLITE_PATH=/app/data/relativity.db
COPY --from=api /src/services/dist ./dist
# Runtime reads these relative to cwd: skills (config/skills), skill-repos.json,
# harness defaults/config. See services/harness/skills/store.ts + api/config.ts.
COPY --from=api /src/services/config ./config
COPY --from=api /src/services/assets ./assets
COPY --from=api /src/services/harness ./harness
COPY services/package*.json ./
RUN npm ci --omit=dev
# Container cwd is /app, so the client build sits one level *down* (dev runs
# from services/ and uses the ../client/dist default instead).
ENV CLIENT_DIST=./client/dist
COPY --from=client /src/client/dist ./client/dist
EXPOSE 8080
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/api/index.js"]
