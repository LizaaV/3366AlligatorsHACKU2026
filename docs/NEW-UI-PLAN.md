# New UI plan (feedback from Anna & Liza)

Branch `fe/new-ui`, stacked on the open PRs #47 (`fe/shell-cleanup`: no upsell, Watches → Triggers)
and #48 (`fe/rebrand-constellation`). Uses the thread shape from #49 (`be/threads`) behind a fixture
until it merges.

## Naming decision
- **Triggers** (`#/triggers`, from #47) = the existing watches: things the agent looks out for and
  notifies about. Gains *recurring / one-time* and an optional *dashboard link*.
- **Dashboard** (`#/dashboard`, new) = the `/api/dashboards` boards of live blocks. Triggers can
  point at a dashboard ("tell me when this dashboard's state changes").

## Workstreams (one agent each, separate worktree branches, merged into `fe/new-ui`)

| # | Stream | Area | Owns (files) |
|---|--------|------|--------------|
| A | Backend: trigger recurrence + dashboard link, satellite positions endpoint | `backend/`, `contracts/` | `schemas/watches.py`, `services/watches*`, new `routes/satellites.py`, `schemas/satellites.py`, `services/satellites.py`, tests |
| B | Chat everywhere: home layout, Claude-style bottom composer, history sidebar with folders, merged place+search picker, language in composer, floating chat bubble on every page | `frontend/` | `pages/AskPage.tsx`, new `components/chat/*`, `components/Shell.tsx`, `App.tsx`, `data/i18n.ts` (append) |
| C | Globe: less glow, live satellites, Google-Earth controls (drag rotate, wheel/pinch zoom, click to pick) | `frontend/` | `components/Globe.tsx`, new `components/globe/*`, `api/endpoints/satellites.ts` |
| D | Add place: drop Draw/Parcel/WhatsApp/Project methods, draw tools always available after locating, editable AI boundary, globe for pin + zoom-out | `frontend/` | `modals/AddPlaceModal.tsx`, `modals/addPlace/**` |
| E | Examining a place: simple layer rail on the left, "what each satellite saw" comparison, no permanent timeline | `frontend/` | new `components/place/*` |
| F | Dashboard page, Triggers page (recurring/one-time, dashboard link, create), Library categories side-scroll | `frontend/` | new `pages/DashboardPage.tsx`, `api/endpoints/dashboards.ts`, `pages/WatchesPage.tsx`, `pages/WatchDetail.tsx`, `modals/WatchBuilderModal.tsx`, `pages/LibraryPage.tsx`, `router.ts` |

## Shared interfaces (agreed up front)
- `Globe` props: `{ visible, autoRotate?, offsetRight?, onPickLocation?: (p: {lat, lon}) => void, focus?: {lat, lon} | null, showSatellites?: boolean }`.
- Chat context: `ChatContext = { kind: 'general' } | { kind: 'place', placeId } | { kind: 'dashboard', dashboardId? } | { kind: 'trigger', triggerId? } | { kind: 'library', skillId? }`.
- Threads: `ThreadSummary` from #49 + client-side `folderId` (localStorage) until a backend folder field exists.
- Layer rail: `LayerRail({ layers, onToggle })`; comparison: `SatelliteCompare({ place, blocks })`. B leaves a slot in the place view; integration happens at merge.

## Deferred / needs input
- "Alex's globe" image and "Liza's example" chat are not in the repo; built from the text description.
- Folder persistence on the server waits for #49 to merge (then add `folder_id` to threads).
- Second translated language: the existing i18n already has 8; only new keys get translations.

## Known gaps (team decisions, 4 Oct 2026)
- **Alerts are sample only.** Triggers are saved and checked, but nothing sends alerts yet: there is no scheduler or notifier, delivery channels are "Coming soon", and a one-time trigger's auto-disable (`watches.record_event`) is not called. Kept as a sample for now.
- **Skills still to be added.** Trigger feasibility rules point to skills the library does not have yet (e.g. `dry-patch-finder`, `flood-extent`, `active-fire-map`, `deforestation-alerts`); only `pond-filling-check` exists. The team will add them.
- **Demo sample text stays** while the app runs on demo data (trigger builder examples, the sample email address).
- **Live answers need `ANTHROPIC_API_KEY`** in `backend/.env`; without it only the Hoo Hok Wai demo place is answered.
