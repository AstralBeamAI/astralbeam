# syntax=docker/dockerfile:1

FROM debian:stable-slim

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

LABEL org.opencontainers.image.source="https://github.com/AstralBeamAI/astralbeam"

RUN apt-get update \
    && apt-get upgrade -y --no-install-recommends \
    && apt-get install -y --no-install-recommends \
        7zip ca-certificates curl file \
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
    LANG=C.UTF-8 \
    MPLBACKEND=Agg

RUN uv --no-cache python install \
    && uv --no-cache venv --seed /opt/venv \
    && uv pip install --no-cache \
        beautifulsoup4 lxml matplotlib numpy openpyxl pandas pillow pyarrow \
        pdfplumber pypdf pytesseract python-docx python-pptx reportlab \
        requests xlrd xlsxwriter \
    && pip check \
    && useradd --create-home --uid 1000 --user-group --shell /bin/bash node \
    && chown -R node:node /opt/venv \
    && install -d -o node -g node /workspace

USER node
WORKDIR /workspace
CMD ["sleep", "infinity"]
