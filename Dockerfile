# syntax=docker/dockerfile:1
#
# One image, three roles (unchanged):
#   - web     → `npm run start`        (next start, port 3000, GET /api/health)
#   - worker  → `npm run worker:prod`  (tsx src/workers/index.ts)
#   - migrate → `npm run migrate:all` / `npm run check:schema` / one-off scripts (tsx)
#
# LAYOUT — built so that a normal release changes ONE small layer (the app), not
# the whole image (2026-10-14; the old single `COPY --from=build /app` layer was
# 3.2 GB and changed on every release):
#
#   os        OS + fonts + the `app` user                         (changes ~never)
#   deps-prod production node_modules (npm ci --omit=dev)          (changes with package-lock.json)
#   build     full install + `next build`                          (build only — NOT shipped)
#   runtime   os + deps-prod + .next + src/scripts/drizzle/public  (the app layers are ~180 MB)
#
# What is deliberately NOT in the runtime image (measured on the 3.52 GB image):
#   - .next/cache        2.0 GB  Next's compile cache; useless once built
#   - dev dependencies   typescript, eslint, vitest, drizzle-kit, tailwind, @types/* …
#   - the musl SWC binary (131 MB): this image is glibc, Next loads the -gnu one
#   - npm's download cache
#
# tsx IS a runtime dependency (package.json): the worker, `migrate:all`,
# `check:schema` and the maintenance scripts all run TypeScript straight from
# source through it. The old comment here claimed that; package.json did not.
#
# No secret is ever baked in. The build-stage placeholders below never reach the
# runtime stage; real values arrive only at run time through env_file.

ARG NODE_IMAGE=node:20-bookworm-slim

# ---- os: the part of the runtime that almost never changes --------------------
FROM ${NODE_IMAGE} AS os
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
# Render every server-side date and time in India time (the container is UTC by
# default, which put every server-rendered time 5h30m behind). This image runs
# web-blue, web-green, the worker AND the one-off tasks, so one line covers all
# of them. Formatters should still pass timeZone: "Asia/Kolkata" explicitly.
ENV TZ=Asia/Kolkata
# curl for the container healthcheck; run as non-root.
# fontconfig + DejaVu/Liberation/Noto fonts so server-side SVG→PNG branding
# (sharp/librsvg) renders text instead of tofu boxes.
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl fontconfig fonts-dejavu-core fonts-liberation \
      fonts-noto-core fonts-noto-ui-core \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -f \
    && groupadd -r app && useradd -r -g app -m app

# ---- deps-prod: production node_modules only ----------------------------------
FROM ${NODE_IMAGE} AS deps-prod
WORKDIR /app
COPY package.json package-lock.json ./
# --omit=dev keeps everything the app, the worker and the migration scripts load
# (tsx included). `rm` drops the musl SWC build npm installs next to the glibc
# one; `npm cache clean` and the rm of ~/.npm keep the download cache out.
RUN npm ci --omit=dev --no-audit --no-fund \
    && rm -rf node_modules/@next/swc-linux-arm64-musl node_modules/@next/swc-linux-x64-musl \
    && npm cache clean --force \
    && rm -rf /root/.npm /tmp/*

# ---- build: compile the Next.js app (full install; nothing here is shipped) ---
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* are inlined into the client bundle at BUILD time — must be passed
# as build args (public URLs only; never secrets).
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_S3_PUBLIC_URL
# Identifies THIS build in /api/health (next.config.ts prefers it to `git`,
# which does not exist inside the build).
ARG BUILD_GIT_SHA=
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_S3_PUBLIC_URL=$NEXT_PUBLIC_S3_PUBLIC_URL \
    BUILD_GIT_SHA=$BUILD_GIT_SHA
# Build-time placeholders so module-load guards (db/client, redis, auth) don't throw
# while `next build` collects page data. NO database/redis is contacted — every data
# route is force-dynamic — and the REAL values are injected only at runtime. They are
# given INLINE to the one RUN below (not ENV), so they are in no image configuration.
# Bound V8's old-space heap for the build (a container cannot read the host's real
# memory, so Node's default ceiling is too low for a cold `next build`).
ENV NODE_OPTIONS=--max-old-space-size=4096
# DO NOT add a BuildKit `--mount=type=cache` with sharing=locked for .next/cache:
# on the old on-server builder it blocked deploys indefinitely. Build-cache reuse
# now comes from the CI runner's layer cache instead.
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build \
    REDIS_URL=redis://127.0.0.1:6379 \
    NEXTAUTH_SECRET=build-time-placeholder-not-used-at-runtime \
    npm run build \
    && rm -rf .next/cache

# ---- runtime: lean image that runs any of the three roles ---------------------
FROM os AS runtime
# Layer 1 (stable): production dependencies.
COPY --from=deps-prod --chown=app:app /app/node_modules ./node_modules
# Layer 2: the compiled app (no .next/cache).
COPY --from=build --chown=app:app /app/.next ./.next
# Layer 3: what the worker, migrations and scripts run from source.
COPY --chown=app:app package.json next.config.ts tsconfig.json ./
COPY --chown=app:app public ./public
COPY --chown=app:app drizzle ./drizzle
COPY --chown=app:app scripts ./scripts
COPY --chown=app:app src ./src
# The RDS CA bundle: DATABASE_URL / APP_DATABASE_URL carry sslrootcert=/app/rds-ca.pem. The old
# server-side `COPY . .` picked up an untracked copy lying in ~/app; a CI-built image has no such
# file, so it ships the public AWS bundle (docker/rds-global-bundle.pem, a superset of the one the
# box had) instead. Public trust anchors, not a secret.
COPY --chown=app:app docker/rds-global-bundle.pem /app/rds-ca.pem
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://localhost:3000/api/health || exit 1
# Default command = web. The worker service overrides it with:
#   command: ["npm","run","worker:prod"]
CMD ["npm", "run", "start"]
