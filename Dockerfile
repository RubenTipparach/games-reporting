# better-sqlite3 is a native module, so it is compiled in a builder stage and
# only the finished node_modules is carried into the runtime image. The runtime
# image therefore has no compiler in it.
FROM node:22-slim AS build
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
# Upgrade art. Small, static, and served straight off disk by src/server.js.
COPY assets ./assets

# The volume is mounted here (see fly.toml). Created so a machine with no
# volume still starts rather than crash-looping on a missing directory - it
# will just be writing to a database that a deploy throws away, which the
# startup log says out loud.
RUN mkdir -p /data
ENV DATA_DIR=/data
ENV PORT=8080
EXPOSE 8080

# PID 1 in a container gets no default signal handlers, so without this the
# SIGTERM Fly sends on a deploy would not reach the shutdown that closes
# SQLite cleanly.
STOPSIGNAL SIGTERM
CMD ["node", "src/server.js"]
