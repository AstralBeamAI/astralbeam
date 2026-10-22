# syntax=docker/dockerfile:1

# Keep build tools out of the runtime: https://docs.docker.com/build/building/multi-stage/
FROM oven/bun:1.4.4 AS build

WORKDIR /app
# Source edits reuse dependency installation: https://docs.docker.com/build/cache/optimize/#order-your-layers
COPY --parents package.json bun.lock bunfig.toml .bun-version */package.json examples/*/package.json patches/*.patch ./
RUN test "$(bun --version)" = "$(cat .bun-version)" && bun install --frozen-lockfile
# Exclude local secrets and host artifacts: https://docs.docker.com/reference/dockerfile/#copy---exclude
COPY --exclude=.git --exclude=**/node_modules --exclude=**/.env* --exclude=**/*.local \
    --exclude=**/dist --exclude=**/.output --exclude=**/.generated \
    --exclude=**/.nitro --exclude=**/.tanstack . .
ENV NODE_ENV=production
RUN bun run --cwd sdk build && bun run --cwd platform build

FROM debian:bookworm

# Update and clean APT in one layer: https://docs.docker.com/build/building/best-practices/#apt-get
RUN apt-get update \
    && apt-get upgrade -y --no-install-recommends \
    && apt-get install -y --no-install-recommends ca-certificates libstdc++6 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 astralbeam \
    && useradd --no-log-init --uid 10001 --gid 10001 --no-create-home --home-dir /tmp --shell /usr/sbin/nologin astralbeam

LABEL org.opencontainers.image.source="https://github.com/AstralBeamAI/astralbeam" \
      org.opencontainers.image.licenses="AGPL-3.0-only"

COPY --from=build --chmod=755 /app/platform/.output/astralbeam-platform /usr/local/bin/astralbeam-platform
# Other notices are embedded. Preserve the SDK's separate notice: https://opensource.org/license/mit
COPY --from=build /app/LICENSE-MIT /usr/share/doc/astralbeam/

ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
# Run without root. The binary unpacks assets and native libraries into writable, executable /tmp.
USER 10001:10001
WORKDIR /tmp
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/astralbeam-platform"]
CMD ["start"]
