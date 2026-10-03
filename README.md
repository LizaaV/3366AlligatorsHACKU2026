# Earth Agent — 3366 Alligators · HacKU 2026

Ask questions about any place on Earth and get answers from satellite data.

| Folder | What | Owners |
| --- | --- | --- |
| [`frontend/`](frontend/) | React + TypeScript + Vite web app | @LizaaV, @annaclairebb |
| [`backend/`](backend/) | Python FastAPI service | @meetrk, @Alex-bot16 |
| [`contracts/`](contracts/) | `openapi.json` — the API contract, generated from the backend | everyone |
| [`docs/`](docs/) | Design handoff (mockups, screenshots, tokens) and design chats | everyone |

## Quick start

```bash
# terminal 1 — backend on :8000
cd backend && uv sync && cp .env.example .env && uv run uvicorn app.main:app --reload

# terminal 2 — frontend on :5173 (proxies /api to the backend)
cd frontend && npm install && npm run dev
```

**Before contributing, read [COLLABORATION.md](COLLABORATION.md)** — branch naming, commit format, PR rules and how we avoid merge conflicts.
