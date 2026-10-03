# Groundtruth · Earth Agent (front-end)

React 18 + TypeScript + Vite implementation of `project/Earth Agent.dc.html`, extended with the feature feedback from the other prototypes. All data and agent answers are scripted mocks (`src/data/`).

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build into dist/
```

## Structure

| Area | Route | Files |
| --- | --- | --- |
| Ask (landing globe → chat + map) | `#/ask?place=<id>` (`place=none` = general question) | `pages/AskPage.tsx`, `pages/AnswerCard.tsx`, `components/Globe.tsx`, `components/MapView.tsx` |
| Places + 3-step add-place wizard | `#/places` | `pages/PlacesPage.tsx`, `modals/AddPlaceModal.tsx` |
| Watches (was "My dashboard" + "Triggers"), grouped by category | `#/watches`, `#/watches/<id>` | `pages/WatchesPage.tsx`, `pages/WatchDetail.tsx`, `modals/WatchBuilderModal.tsx` |
| Skills library, skill detail, skill builder | `#/library`, `#/library/<id>`, `#/library/new` | `pages/LibraryPage.tsx`, `pages/SkillDetail.tsx`, `pages/SkillBuilder.tsx` |
| Shared modals | — | `modals/` (export link/PDF/data, ask an expert, connectors incl. WhatsApp, mobile app, language, upgrade) |

Design tokens live in `src/styles.css` (from `project/uploads/DESIGN-hashicorp.md`). Every CTA that does work carries a `Free` / `Paid` tag (`<Btn tier=…>`).

## Skill storage format

A skill is a versioned **JSON manifest** validated against a JSON Schema (see `skillManifest()` in `src/data/catalog.ts`, and the "Skill file (JSON)" tab on any skill page): publisher, pricing, inputs, an ordered list of `steps` (each a module id from `MODULES` plus params), outputs and accuracy/known limits. The registry would store each published version in a database (e.g. Postgres `JSONB`) alongside signature and run stats, so a run is reproducible: same modules, params and version.

## Not real yet

Agent runs, feasibility checks, translations beyond the 8 UI languages, WhatsApp/SMS delivery, payments, exports and expert booking are front-end simulations. Map tiles (EOX Sentinel-2 cloudless) and globe textures load from public CDNs, as in the prototype.
