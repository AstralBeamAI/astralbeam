# syntax=docker/dockerfile:1

FROM debian:trixie
LABEL org.opencontainers.image.source="https://github.com/AstralBeamAI/astralbeam"

# Set locale so Unicode characters render correctly in locale-aware tools (e.g. tmux).
ENV LANG=C.UTF-8 LC_ALL=C.UTF-8

ADD .devcontainer/install.sh /tmp/
RUN . /tmp/install.sh \
  && apt-get autoremove -yq && apt-get clean -yq && rm -rf /var/lib/apt/lists /var/cache/apt/archives 

# Host-mounted workspaces often have a different UID than the container user.
RUN git config --system --add safe.directory '*'

# Install Vite Plus
ARG VP_VERSION=latest
ENV VP_HOME=${HOME}/vp/.vite-plus
ENV PATH="${VP_HOME}/bin:${PATH}"
# Bundles the `vp` CLI for the build, CI, and development phases. 
# This is NOT a production runtime image: it ships the full toolchain (vite, rolldown, vitest, oxlint, ...) and is meant for use as a build stage, CI image, or devcontainer.
# TODO: For production image, refer https://viteplus.dev/guide/docker#production-ssr-node-js-server-app
RUN mkdir -p "${VP_HOME}" \
  && curl -fsSL https://vite.plus | VP_VERSION="${VP_VERSION}" bash \
  && vp --version \
  && vp env setup \
  && vp env on \
  # The installer pre-provisions a default Node.js (~190 MB). Drop it;
  # the project pin from .node-version is installed next instead.
  && rm -rf "$VP_HOME/js_runtime"

COPY .node-version /tmp/.node-version
RUN vp env install "$(cat /tmp/.node-version)" \
  && node --version \
  && rm /tmp/.node-version
