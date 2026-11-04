# syntax=docker/dockerfile:1

FROM debian:stable AS base

FROM base AS build

COPY --from=node:lts /usr/local/bin/node /usr/local/bin/

# NO_PERL keeps Git's core commands without Debian's full Perl dependency.
# https://github.com/git/git/blob/master/Makefile
RUN sed -i 's/^Types: deb$/Types: deb deb-src/' /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential libcurl4-openssl-dev libexpat1-dev libpcre2-dev libssl-dev zlib1g-dev \
    && mkdir /build && cd /build \
    && apt-get source git \
    && cd git-* \
    && printf '%s\n' 'prefix=/opt/git' 'NO_PERL=1' 'NO_TCLTK=1' 'NO_GETTEXT=1' \
        'USE_LIBPCRE2=1' 'PYTHON_PATH=/opt/venv/bin/python' > config.mak \
    && dpkg-buildflags --export=make >> config.mak \
    && make -j"$(nproc)" \
    && make strip install \
    && install -Dm644 debian/copyright /opt/git/share/doc/git/copyright \
    && strip --strip-unneeded /usr/local/bin/node

FROM base

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/
COPY --from=build /usr/local/bin/node /usr/local/bin/
COPY --from=node:lts /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
COPY --from=node:lts /usr/local/LICENSE /usr/share/doc/nodejs/LICENSE
COPY --from=build /opt/git /opt/git

LABEL org.opencontainers.image.source="https://github.com/AstralBeamAI/astralbeam"

RUN apt-get update \
    && apt-get upgrade -y --no-install-recommends \
    && apt-get install -y --no-install-recommends \
        7zip ca-certificates curl file \
        fonts-dejavu-core fonts-liberation \
        gawk jq less patch procps ripgrep rsync sqlite3 \
        libcurl4t64 libexpat1 libpcre2-8-0 libssl3t64 zlib1g \
        time unzip wget xz-utils zip \
        poppler-utils qpdf tesseract-ocr tesseract-ocr-eng \
    && ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && npm install --global typescript \
    && npm cache clean --force \
    && rm -rf /var/lib/apt/lists/*

ENV PATH="/opt/venv/bin:/opt/git/bin:${PATH}" \
    UV_PYTHON_INSTALL_DIR=/opt/python \
    PYTHONUNBUFFERED=1 \
    LANG=C.UTF-8 \
    MPLBACKEND=Agg

RUN uv --no-cache python install \
    && uv --no-cache venv --seed /opt/venv \
    && uv pip install --no-cache \
        beautifulsoup4 httpx lxml markdown matplotlib numpy \
        openpyxl pandas pdf2image pdfplumber pillow \
        pypdf pytesseract python-docx python-pptx pyyaml \
        reportlab requests xlrd xlsxwriter \
    && pip check \
    && useradd --create-home --uid 1000 --user-group --shell /bin/bash node \
    && chown -R node:node /opt/venv \
    && install -d -o node -g node /workspace

USER node
WORKDIR /workspace
CMD ["sleep", "infinity"]
