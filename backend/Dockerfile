# APEX F1 API — Google Cloud Run (FastAPI + uvicorn)
# Cloud Run sets PORT; listen on 0.0.0.0.

FROM python:3.12-slim-bookworm

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    MPLBACKEND=Agg \
    FASTF1_CACHE_DIR=/tmp/fastf1-cache

# Wheels for scientific stack; gcc sometimes needed for rare builds
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p /tmp/fastf1-cache && \
    useradd -r -u 1000 appuser && \
    chown -R appuser:appuser /app /tmp/fastf1-cache

USER appuser

EXPOSE 8080

# PORT is injected by Cloud Run (typically 8080)
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}"]
