# syntax=docker/dockerfile:1

FROM debian:stable

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/
COPY --from=node:lts /usr/local/bin/node /usr/local/bin/
COPY --from=node:lts /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
COPY --from=node:lts /usr/local/LICENSE /usr/share/doc/nodejs/LICENSE

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
    && npm install --global typescript \
    && npm cache clean --force \
    && rm -rf /var/lib/apt/lists/*

ENV VIRTUAL_ENV=/usr/local \
    UV_PYTHON_INSTALL_DIR=/opt/python \
    PYTHONUNBUFFERED=1 \
    LANG=C.UTF-8 \
    MPLBACKEND=Agg

RUN uv --no-cache python install \
    && uv --no-cache venv --seed --allow-existing /usr/local \
    && uv pip install --no-cache \
        beautifulsoup4 httpx lxml markdown matplotlib numpy \
        openpyxl pandas pdf2image pdfplumber pillow \
        pypdf pytesseract python-docx python-pptx pyyaml \
        reportlab requests xlrd xlsxwriter \
    && pip check

WORKDIR /workspace
CMD ["sleep", "infinity"]
