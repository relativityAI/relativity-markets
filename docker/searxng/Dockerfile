# SearXNG with this project's settings baked in (JSON API enabled, engines
# widened). Published as ghcr.io/relativityai/relativity-searxng:latest so
# `docker compose up` works without a checkout — no bind-mounted settings file.
FROM docker.io/searxng/searxng:latest
COPY services/searxng/settings.yml /etc/searxng/settings.yml
