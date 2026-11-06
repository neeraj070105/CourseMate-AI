FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    RAG_HOST=0.0.0.0 \
    RAG_SERVICE_PORT=8000 \
    CHROMA_DB_PATH=/app/chroma_db \
    HF_HUB_DISABLE_SYMLINKS_WARNING=1

WORKDIR /app

# Install system dependencies for PyMuPDF, Tesseract OCR, and OpenMP runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    tesseract-ocr \
    tesseract-ocr-eng \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download CrossEncoder model weights to avoid runtime downloads
RUN python -c "from sentence_transformers import CrossEncoder; CrossEncoder('cross-encoder/ms-marco-MiniLM-L6-v2')"

COPY . .

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:8000/health || exit 1

CMD ["python", "-c", "import os, rag_server; rag_server.start_server(port=int(os.getenv('RAG_SERVICE_PORT', 8000)), host=os.getenv('RAG_HOST', '0.0.0.0'))"]
