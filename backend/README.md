# Earth Agent · backend (FastAPI)

```bash
uv sync                               # install deps into .venv (Python 3.12, uv downloads it if missing)
cp .env.example .env                  # local settings, git-ignored
uv run uvicorn app.main:app --reload  # http://localhost:8000 — docs at /docs
uv run pytest                         # tests
uv run ruff check . && uv run ruff format .   # lint + format
uv run python -m app.export_openapi   # regenerate ../contracts/openapi.json after API changes
```

## Layout

| Path | What goes here |
| --- | --- |
| `app/main.py` | App factory: middleware, mounts `api_router`. Rarely touched. |
| `app/api/router.py` | One `include_router` line per feature. Append at the end. |
| `app/api/routes/<feature>.py` | HTTP layer for one feature (`ask.py`, `places.py`, `watches.py`, …). Thin: validate, call a service, return a schema. |
| `app/schemas/<feature>.py` | Pydantic request/response models — these *are* the API contract. |
| `app/services/<feature>.py` | Business logic, satellite/LLM calls. No FastAPI imports. |
| `app/core/` | Settings and cross-cutting helpers. |
| `tests/test_<feature>.py` | One test file per feature. |

One file per feature in each folder means the two backend devs rarely edit the same file.
