FROM oven/bun:1.4.3 AS build

WORKDIR /app
COPY . .
RUN test "$(bun --version)" = "$(cat .bun-version)" \
    && bun install --frozen-lockfile \
    && bun run --cwd sdk build \
    && bun run --cwd platform build

FROM debian:bookworm

RUN apt-get update \
    && apt-get upgrade -y --no-install-recommends \
    && apt-get install -y --no-install-recommends ca-certificates libstdc++6 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 astralbeam \
    && useradd --no-log-init --uid 10001 --gid 10001 --no-create-home --home-dir /tmp --shell /usr/sbin/nologin astralbeam

LABEL org.opencontainers.image.source="https://github.com/AstralBeamAI/astralbeam" \
      org.opencontainers.image.licenses="AGPL-3.0-only"

COPY --from=build --chmod=755 /app/platform/.output/astralbeam-platform /usr/local/bin/astralbeam-platform
COPY --from=build /app/LICENSE-AGPL /app/LICENSE-MIT /app/docs/legal/THIRD_PARTY_NOTICES.md /usr/share/doc/astralbeam/
COPY --from=build /app/docs/legal/LICENSES/ /usr/share/doc/astralbeam/LICENSES/
COPY --from=build /app/platform/.output/public/THIRD_PARTY_LICENSES.md /usr/share/doc/astralbeam/CLIENT_THIRD_PARTY_LICENSES.md
COPY --from=build /app/platform/.output/server/THIRD_PARTY_LICENSES.md /usr/share/doc/astralbeam/SERVER_THIRD_PARTY_LICENSES.md

ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
USER 10001:10001
WORKDIR /tmp
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/astralbeam-platform"]
CMD ["start"]
