# syntax=docker/dockerfile:1

FROM ubuntu:24.04

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

LABEL org.opencontainers.image.source="https://github.com/AstralBeamAI/astralbeam"

# Set locale so Unicode characters render correctly in locale-aware tools (e.g. tmux).
ENV LANG=C.UTF-8 LC_ALL=C.UTF-8

ENV DENO_INSTALL=${HOME}/.deno
ENV PATH="${DENO_INSTALL}/bin:${PATH}"
COPY scripts/ /tmp/
RUN INSTALL_EXTRA="cursor-dnd" /tmp/setup.sh \
  && apt-get autoremove -yq \
  && apt-get clean -yq \
  && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*
