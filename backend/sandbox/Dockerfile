# Sandbox image for agent-written scripts (SANDBOX_IMPL=docker). Build context: backend/
#   docker build -f sandbox/Dockerfile -t earth-sandbox:latest .
# Holds only pure-pydantic earth types + the thin `earth` client: no providers, keys or app code.
FROM python:3.12-slim

# Versions = backend/uv.lock. shapely/pyproj: Area.from_point / from_geojson run in here.
RUN pip install --no-cache-dir --disable-pip-version-check \
      pydantic==2.13.5 pydantic-core==2.46.5 shapely==2.1.2 pyproj==3.8.0 numpy==2.5.3 \
    && useradd --system --no-create-home --uid 10001 --user-group sandbox

WORKDIR /sandbox
# The real earth types; earth/client.py becomes the `earth` package itself.
COPY earth/types.py earth/errors.py earth/blocks.py earth/show.py earth/presets.py \
     earth/settings.py earth/
COPY earth/client.py earth/__init__.py
# The unchanged child entrypoint (+ the scan/proxy rules it shares with the runner).
COPY app/__init__.py app/
COPY app/services/__init__.py app/services/sandbox.py app/services/sandbox_child.py app/services/
COPY sandbox/relay.py ./

RUN python -m compileall -q /sandbox

ENV PYTHONPATH=/sandbox PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
USER 10001:10001
CMD ["python", "-m", "app.services.sandbox_child"]
