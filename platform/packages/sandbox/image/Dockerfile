# syntax=docker/dockerfile:1

FROM debian:stable-slim

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

LABEL org.opencontainers.image.source="https://github.com/AstralBeamAI/astralbeam"

RUN apt-get update \
    && apt-get upgrade -y --no-install-recommends \
    && apt-get install -y --no-install-recommends \
        7zip ca-certificates curl ffmpeg file \
        fonts-dejavu-core fonts-liberation fonts-noto-core fonts-noto-cjk \
        gawk git jq less patch procps ripgrep rsync sqlite3 \
        time unzip wget xz-utils zip \
        libreoffice-calc libreoffice-impress libreoffice-writer \
        pandoc poppler-utils qpdf tesseract-ocr tesseract-ocr-eng \
    && curl -fsSL https://deb.nodesource.com/setup_lts.x -o /tmp/nodesource.sh \
    && bash /tmp/nodesource.sh \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /tmp/nodesource.sh /var/lib/apt/lists/*

ENV PATH="/opt/venv/bin:${PATH}" \
    UV_PYTHON_INSTALL_DIR=/opt/python \
    PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers \
    PYTHONUNBUFFERED=1 \
    LANG=C.UTF-8 \
    MPLBACKEND=Agg

RUN uv --no-cache python install \
    && uv --no-cache venv --seed /opt/venv \
    && uv pip install --no-cache \
        beautifulsoup4 httpx lxml markdown matplotlib numpy \
        opencv-python-headless openpyxl pandas pdf2image pdfplumber pillow \
        playwright pyarrow pypdf pytesseract python-docx python-pptx pyyaml \
        reportlab requests seaborn sympy xlrd xlsxwriter \
    && pip check \
    && python -m playwright install --with-deps --only-shell chromium \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 1000 --user-group --shell /bin/bash node \
    && chown -R node:node /opt/venv \
    && install -d -o node -g node /workspace

USER node
WORKDIR /workspace
CMD ["sleep", "infinity"]
