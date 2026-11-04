# syntax=docker/dockerfile:1

FROM node:lts-slim AS node-runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends binutils \
    && strip --strip-unneeded /usr/local/bin/node

FROM debian:stable-slim

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/
COPY --from=node-runtime /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm

LABEL org.opencontainers.image.source="https://github.com/AstralBeamAI/astralbeam"

RUN apt-get update \
    && apt-get upgrade -y --no-install-recommends \
    && apt-get install -y --no-install-recommends \
        7zip ca-certificates curl file \
        fonts-dejavu-core fonts-liberation \
        gawk git jq less patch procps ripgrep rsync sqlite3 \
        time unzip wget xz-utils zip \
        poppler-utils qpdf tesseract-ocr tesseract-ocr-eng \
    && ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && rm -rf /var/lib/apt/lists/*

ENV PATH="/opt/venv/bin:${PATH}" \
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
        reportlab requests seaborn sympy xlrd xlsxwriter \
    && pip check \
    && useradd --create-home --uid 1000 --user-group --shell /bin/bash node \
    && chown -R node:node /opt/venv \
    && install -d -o node -g node /workspace

USER node
WORKDIR /workspace
CMD ["sleep", "infinity"]
