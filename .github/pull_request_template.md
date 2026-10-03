## What & why
<!-- One or two sentences. Link the issue if there is one: Closes #12 -->

## Area
- [ ] `frontend/`
- [ ] `backend/`
- [ ] `contracts/` (API change — tag the other team)
- [ ] repo / docs / CI

## Checklist
- [ ] Branch is rebased on latest `main`
- [ ] CI is green (`npm run build` / `uv run pytest` + `uv run ruff check`)
- [ ] If the API changed: `contracts/openapi.json` regenerated in this PR
- [ ] No secrets, `.env`, `node_modules`, or build output committed
- [ ] Screenshot attached (UI changes only)
