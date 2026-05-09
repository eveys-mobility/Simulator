################################################################
# Build stage — install all workspace deps, build the web bundle.
################################################################
FROM node:20-alpine AS builder

# better-sqlite3 needs python + build tools to compile its native add-on.
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy lockfile + package manifests first so Docker can cache the
# `npm install` layer when only sources change.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
COPY packages/csms/package.json packages/csms/

RUN npm install --ignore-scripts && npm rebuild better-sqlite3

# Now bring in the rest of the workspace and build the web bundle.
COPY packages packages

RUN npm --workspace @ocpp-sim/web run build

################################################################
# Runtime stage — slim node + tsx + only what the server runs.
################################################################
FROM node:20-alpine AS runtime

# Runtime needs the better-sqlite3 native binding compiled above; keep
# the python toolchain out of this stage.
RUN apk add --no-cache tini

WORKDIR /app

# Copy the whole built workspace from the builder. Works because
# the workspace symlinks are inside node_modules.
COPY --from=builder /app/package.json /app/package-lock.json /app/tsconfig.base.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001 \
    DB_PATH=/data/sim.sqlite \
    WEB_DIST_DIR=/app/packages/web/dist

# SQLite lives on a volume so devices + sessions + benchmark runs
# survive container restarts.
VOLUME /data

EXPOSE 3001

# tini PID 1 so SIGTERM propagates and the server's graceful
# shutdown hook fires.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npm", "--workspace", "@ocpp-sim/server", "run", "start"]
