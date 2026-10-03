# Earth Agent API. Build context: backend/  (see deploy/docker-compose.yml)
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.12.22 /uv /uvx /bin/

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH" \
    EARTH_DATA_DIR=/data

# rasterio's bundled GDAL links libexpat; the slim image lacks it. No system GDAL needed.
RUN apt-get update && apt-get install -y --no-install-recommends libexpat1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first: this layer is cached until pyproject.toml / uv.lock change.
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project

# Application code (changes here do not reinstall deps).
COPY . .

RUN useradd --system --create-home --uid 1000 app \
    && mkdir -p /data && chown app:app /data
USER app

EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4).status==200 else 1)"

# One worker on purpose: the place-memory, run-store and earth locks are in-process,
# so a second worker would not share them.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
