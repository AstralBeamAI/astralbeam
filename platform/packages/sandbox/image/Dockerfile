# syntax=docker/dockerfile:1

FROM node:24-trixie-slim

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
        python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*

ENV PATH="/opt/venv/bin:${PATH}" \
    LANG=C.UTF-8 \
    MPLBACKEND=Agg

RUN python3 -m venv /opt/venv \
    && pip install --no-cache-dir \
        beautifulsoup4==4.15.0 lxml==6.1.3 matplotlib==3.11.2 numpy==2.5.4 \
        openpyxl==3.1.5 pandas==3.1.0 pillow==13.0.0 pyarrow==26.0.1 \
        pdfplumber==0.11.10 pypdf==6.21.4 pytesseract==0.3.13 \
        python-docx==1.2.0 python-pptx==1.0.2 reportlab==5.1.0 \
        requests==2.34.2 xlrd==2.0.2 xlsxwriter==3.3.1 \
    && pip check \
    && chown -R node:node /opt/venv \
    && install -d -o node -g node /workspace

USER node
WORKDIR /workspace
ENTRYPOINT []
CMD ["sleep", "infinity"]
