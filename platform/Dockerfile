FROM debian:bookworm

RUN apt-get update \
    && apt-get upgrade -y --no-install-recommends \
    && apt-get install -y --no-install-recommends ca-certificates libstdc++6 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 astralbeam \
    && useradd --no-log-init --uid 10001 --gid 10001 --no-create-home --home-dir /tmp --shell /usr/sbin/nologin astralbeam

LABEL org.opencontainers.image.source="https://github.com/AstralBeamAI/astralbeam" \
      org.opencontainers.image.licenses="AGPL-3.0-only"

ARG TARGETARCH
COPY --chmod=755 astralbeam-platform-${TARGETARCH} /usr/local/bin/astralbeam-platform
COPY licenses/ /usr/share/doc/astralbeam/

ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
USER 10001:10001
WORKDIR /tmp
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/astralbeam-platform"]
CMD ["start"]
