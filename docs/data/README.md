# Domain data handoff — frontend → backend

This folder is the **preserved domain data** from the Earth Agent frontend prototype.

Until now the frontend carried a complete simulated backend: a skills registry, saved places,
watches with history series, scripted agent answers, and a feasibility rule engine. That
simulation has been removed from the frontend (see `frontend/src/api/`), and everything it
contained is captured here so **nothing is lost** while @meetrk and @Alex-bot16 build the real
database and endpoints.

Nothing in this folder is imported by any application. It is reference data and a contract
proposal — read it, model from it, then serve it.

> Generated from the prototype's data modules, not hand-copied: `skills.json` is resolved from a
> tuple table and the `*.example.json` files are captured by running the prototype's own answer
> and feasibility functions. The numbers are exactly what the UI renders today.

## What the frontend needs back

| File | Records | Becomes | Notes |
| --- | --- | --- | --- |
| `categories.json` | 9 | `GET /api/catalog` | The 9 top-level domains. **`color` and `fg` are presentation** — the frontend keeps its own copy keyed on `key`; the backend only needs `key`, `name`, `icon`, `uses`, `sats`. |
| `satellites.json` | 8 | `GET /api/catalog` | Sensor specs: resolution, revisit, free/paid, price. Drives the "satellite routing" the answer card shows. |
| `skill-modules.json` | 12 | `GET /api/catalog` | The building blocks a skill is composed from, with default params. A skill is an ordered list of these. |
| `delivery-channels.json` | 5 | `GET /api/catalog` | Email / push / WhatsApp / SMS / Slack, with tier and cost. |
| `languages.json` | 25 | `GET /api/catalog` | `ui: true` = interface is translated (8 of them). All 25 are expected to work for **answer prose**, so every endpoint returning text needs a `lang` parameter. |
| `skills.json` | 28 | `GET /api/skills`, `GET /api/skills/{id}` | The library. Official vs community, ratings, run counts, accuracy statements, known limits. |
| `skill-manifests.json` | 28 | storage format | The versioned JSON manifest shape the prototype proposed for storing a skill (publisher, pricing, inputs, ordered steps with params, outputs, accuracy). Suggested as the DB representation — e.g. Postgres `JSONB` plus signature and run stats. |
| `places.json` | 4 | `GET /api/places` | Saved user places. **See "Geometry" below — this format must change.** |
| `place-search-results.json` | 7 | `GET /api/places/search?q=` | Place-name search. Real implementation is a geocoder. |
| `watches.json` | 7 | `GET /api/watches`, `GET /api/watches/{id}` | Standing questions re-asked each satellite pass: condition, metric, confidence interval, 12-point history series, 5-year band and mean, delivery channels, event log. |
| `map-layers.json` | 6 | part of the `/ask` response | The overlay stack an answer switches on (NDMI, NDVI, thermal, dry spots, cloud mask). |
| `clarifying-questions.json` | 3 | part of the `/ask` flow | Questions the agent asks before running (crop / irrigation / when it started). |
| `source-labels.json` | 7 | enum | How a place was added: drawn, uploaded, search, coords, whatsapp, parcel, pin. |
| `ask-answers.example.json` | 4 cases | `POST /api/ask` response | **The most important file here.** See below. |
| `watch-feasibility.example.json` | 8 cases | `POST /api/watches/feasibility` response | See below. |
| `timeline.example.json` | — | part of the `/ask` response | Per-pass dates, which were cloudy, and a per-pass intensity used to animate overlays. |

## The two files worth reading closely

### `ask-answers.example.json`

Four exemplar `POST /api/ask` response bodies. This is the shape the answer card renders, and it
is deliberately richer than "a number and some text". Every answer carries:

- `stats[]` — headline numbers, each with a confidence range (`ci`)
- `confidence` — level, percentage, **and a note saying why it is not higher**
- `caveats[]` — what could be wrong, in plain language
- `route[]` — every satellite considered, each marked `chosen` / `support` / `fallback` / `skipped`, **with the reason**. This is what shows users that free sources were tried first.
- `proof[]` — every scene, whether it was used, and why it was rejected (cloud %, rain)
- `hash` — a processing hash, so a run is reproducible

**Please keep all of it.** The honesty of these answers — showing skipped scenes, inferred causes
and confidence ranges — is the product's main differentiator over "AI says 4.6 ha". If the response
drops to a bare summary string the UI loses most of what makes it trustworthy.

### `watch-feasibility.example.json`

Eight exemplar `POST /api/watches/feasibility` responses — "can satellites actually watch this?"
asked before a watch is created.

Note the two refusals. Asked to count cars or identify people, the prototype returns `ok: false`
with an explanation (*"free satellites see 10 m pixels — a car is smaller than one pixel"*) and
offers a legitimate alternative. **This behaviour is a product requirement, not a limitation to
engineer away.** The prototype decided it with a regex router; the real version should be rules
over the area size and the sensor catalogue.

## Geometry — the one thing that must change

The prototype stores outlines as **pixel offsets from the centre at zoom 16** (`pts: [[x, y], …]`).
That was convenient for drawing on a tile map and is wrong for a database.

**Please store and return GeoJSON `Polygon` geometry in WGS84 (EPSG:4326)**, and let PostGIS do the
measuring. The frontend converts its pixel geometry to lat/lon before sending.

**Area must be computed and returned by the backend** as `area_ha`. It is not decoration: it appears
in answers, in watch thresholds ("dry area larger than 5 ha"), in pricing ($/km²) and in feasibility
gates ("field is large enough for 10 m imagery"). If the frontend and backend each compute it,
the UI, the analysis and the invoice will disagree about the same field. The frontend still computes
a provisional area while the user is dragging an outline that has no server-side identity yet, and
labels it approximate — but once a place is saved, the API's number is the only one displayed.

Same applies to any other number of record: distance, volume, surface area.

## Other notes for modelling

- **Dates are display strings** (`"Sep 28, 18:04"`, `"Oct 3"`, `"Today, 06:10"`, `"Paused"`). Please
  return real ISO-8601 timestamps and let the frontend format them — the prototype has a
  `nextRank()` function that parses these strings to sort them, which should not need to exist.
- **`history`, `band` and `histMean` are normalised 0–1** for chart drawing, which loses the real
  values. Prefer returning real measured values plus the unit, and let the chart normalise.
- **Category is an array index** (`cat: 0`). Please use the stable string `key` from
  `categories.json` instead; indices break the moment a category is added or reordered.
- **Skill `runs` and `rating` are generated** from a hash in the prototype — they are placeholders,
  not real engagement data.
- `places.json` `details[]` is a display-oriented list of label/value pairs. Real structured fields
  (crop, irrigation, soil, elevation) would be better; the frontend can do the presenting.

## Proposed endpoints

The frontend already calls these, against typed placeholders in `frontend/src/api/endpoints/`.
Each one has a `TODO(api)` marker naming the endpoint it expects. Paths and shapes are a
**proposal** — if you prefer different ones, say so and we will change the frontend to match;
it is a one-file change per endpoint.

```
GET    /api/catalog                     categories, satellites, modules, channels, languages
GET    /api/skills                      ?category=&tier=&q=
GET    /api/skills/{id}
GET    /api/places
POST   /api/places                      create (GeoJSON in, area_ha out)
GET    /api/places/{id}
PATCH  /api/places/{id}
DELETE /api/places/{id}
GET    /api/places/search               ?q=            geocoder
POST   /api/places/detect-boundary      {lat, lon} → suggested GeoJSON outline
POST   /api/places/parse-file           KML / GeoJSON / Shapefile / CSV upload → GeoJSON
POST   /api/places/lookup-parcel        {system, parcel_id} → GeoJSON + registry metadata
GET    /api/watches
POST   /api/watches
GET    /api/watches/{id}
PATCH  /api/watches/{id}                pause/resume, edit condition and channels
DELETE /api/watches/{id}
POST   /api/watches/feasibility         {text, place_id?} → can satellites watch this?
POST   /api/ask                         {question, place_id?, skill_id?, context?, lang}
POST   /api/export                      {target, format} → link / PDF / data pack
```

### `/api/ask` does not need to stream

We decided the agent's step-by-step progress is **prewritten in the frontend** — a short
choreography played while the request is in flight (`frontend/src/ask/progressScripts.ts`). So
`POST /api/ask` can be an ordinary request/response that returns the finished answer. You do not
need SSE, WebSockets or a job queue for the step reveal.

Two things that would help:

1. If a run will routinely take more than ~20 s, tell us and we will add job polling
   (`POST /ask → {run_id}` + `GET /ask/{run_id}`). The prewritten choreography holds on its last
   step indefinitely, so a slow response degrades gracefully, but a user staring at one step for a
   minute is not great.
2. If the answer can name which **map layers** it produced, the frontend will switch them on as
   the choreography completes — that is what makes the map feel alive. `map-layers.json` has the ids.

## Keeping this in sync

Once an endpoint is live, the matching fixture file in
`frontend/src/api/fixtures/` is deleted and the frontend reads the API instead. The copies in
*this* folder stay as the historical record of what the prototype modelled — they are not wired to
anything, so they will not drift into being a second source of truth.
