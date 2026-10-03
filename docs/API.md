# Earth Agent API: guide for the frontend

**Who this is for:** @LizaaV and @annaclairebb (frontend), plus anyone calling the backend.
**Source of truth:** `contracts/openapi.json` (generated from the backend's Pydantic schemas). This guide explains what OpenAPI can't: how the live stream works, the order of events, how to read it in the browser, and how fields map onto the existing mocks in `frontend/src/data/`.

> **Status (Sat 3 Oct):** the contract is real; the "thinking" is not yet.
>
> - `POST /api/runs` plays a **scripted run on the Hoo Hok Wai ponds** through the real plumbing: Meet's `earth` library in stub mode, the knowledge cards and the run store.
> - Every answer from it has `preset: true`.
> - When the agent loop (A3) lands, the same endpoints and events carry real answers, and **nothing in this guide changes**.

---

## 1. Basics

| | |
|---|---|
| Base path | `/api` (in dev the Vite server proxies `/api` → `http://localhost:8000`) |
| Interactive docs | `http://localhost:8000/docs` (try every endpoint in the browser) |
| Format | JSON in, JSON out. The two run endpoints stream **server-sent events** (section 3) |
| Accounts | None. Every request is user `"demo"`. Send `X-User-Id: <id>` to act as another demo user: it must match `^[a-z0-9][a-z0-9_-]{0,31}$`, otherwise you get **400**. Runs are only visible to the user who made them. |
| Ids | Run ids look like `r_93fc26473675`, thread ids like `t_04a22c30aa6d`. Only use ids the server gave you. Other ids (place, card) match `^[a-z0-9][a-z0-9_-]{0,63}$`. |

Generate TypeScript types straight from the contract (recommended):

```bash
npx openapi-typescript ../contracts/openapi.json -o src/api/schema.d.ts
```

## 2. Endpoints

| Method + path | What it does | Returns |
|---|---|---|
| `POST /api/runs` | **Ask a question about a place.** Streams the run live | `text/event-stream` (section 3) |
| `GET /api/runs/{run_id}` | Reload a finished (or paused) run, e.g. after a page refresh or for a share page | `RunRecord` |
| `POST /api/runs/{run_id}/reply` | Answer the agent's clarification card and **stream the rest of the same run** | `text/event-stream` |
| `POST /api/areas/resolve` | Turn a pin, a drawing, a map link, coordinates or a place name (OpenStreetMap search) into an `Area` | `AreaResolveResponse` |
| `POST /api/areas/context` | "What's at this place?": size, land cover, slope, recent satellite passes | `PlaceContext` |
| `GET /api/knowledge/index` | All knowledge cards (11 events + 13 settings), for a Library / "Method" view | `CardIndexEntry[]` |
| `GET /api/knowledge/cards/{card_id}` | One card, with its full Markdown body | `CardDetail` |
| `GET /api/knowledge/find?q=...` | Which cards a sentence mentions ("were there floods here" → `water_gain`) | `CardIndexEntry[]` |
| `GET /api/layers/{run_id}/{measure}/{scene}.png` | A rendered map image. You never build this URL yourself: it comes inside blocks (`image.url`) | PNG |
| `GET /api/health` | Liveness check | `{status: "ok"}` |

**Not built yet** (coming in later modules; keep using the mocks):

- threads list (A4)
- watches and skills listing (A5)
- dashboards, share links, PDF (Meet's modules)

## 3. The live stream (`POST /api/runs`)

### 3.1 Request

```json
{
  "question": "Have these ponds been filled in?",
  "area": { "point": { "lat": 22.534, "lon": 114.0906, "radius_m": 350 }, "name": "Hoo Hok Wai ponds" },
  "place_id": null,
  "thread_id": null,
  "skill_id": null,
  "lang": "en"
}
```

| Field | Notes |
|---|---|
| `question` | Required, 1–2000 characters |
| `area` | Optional. Either `{point: {lat, lon, radius_m}}` or `{geojson: <Feature, FeatureCollection or geometry>}`, plus an optional `name`. Outlines are capped at 10,000 points, 200 features and nesting depth 8 (422 beyond that). If omitted, the stub uses Hoo Hok Wai |
| `place_id` | A saved place, so the agent can prefill from its memory |
| `thread_id` | To ask a **follow-up** in the same conversation. Must be a thread id this user got from an earlier `run_started`; anything else → 404 |
| `skill_id` | Optional: force a specific skill |
| `lang` | Optional, default `"en"`. The language you want the answer in, as a BCP 47 tag (`en`, `zh-Hant`, `yue`, `pt-BR`…). Stored on the run (`RunRecord.lang`). **For now answers are always English**; translated answers come later, and nothing changes for the frontend when they do |

Errors **before** the stream starts are plain JSON:

- **400:** bad area, bad ids, bad `X-User-Id`
- **404:** unknown thread
- **422:** validation

### 3.2 What comes back

The response has `Content-Type: text/event-stream`. Each message is an `event:` line plus a `data:` line holding JSON. Lines end with `\r\n`, and messages are separated by a blank line. Every JSON payload also carries its own `"event"` field, so you can ignore the `event:` line and just parse `data`. Lines starting with `:` are keep-alive pings; skip them.

**Every stream ends with exactly one `done`.** That's your signal to stop the spinner.

### 3.3 Events

| Event | When | Payload (key fields) | Show it as |
|---|---|---|---|
| `run_started` | First | `run_id`, `thread_id` | Store both: `run_id` for reload/reply/share, `thread_id` for follow-ups |
| `guard` | Second | `scope` (`answerable` · `partial` · `out_of_scope` · `not_allowed` · `emergency` · `off_topic`), `rule_id`, `reason` | Usually nothing. On a refusal it's followed by a `limits` block and `done{status: "refused"}` |
| `hypotheses_registered` | Before any data is read | `hypotheses` (card ids), `expectation_table` [{`hypothesis`, `expected` {measure → text}, `observed`, `verdict`}], `post_hoc` | "What I'm checking" line or chips; the table becomes the "What else could it be" view |
| `clarification_needed` | When the agent needs the user | `questions` [{`key`, `label`, `options`, `value` (prefill), `source` {`from`: `memory`·`inferred`, `saved`}}], `remember` | The clarification card. Show a "From memory · 12 Sep" badge when `source.from == "memory"`. The stream then ends with `done{status: "waiting_user"}` (section 4) |
| `clarification_answered` | First event of a reply stream | `answers`, `remember` | Collapse the card into a summary line |
| `step_started` | Each visible step begins | `index`, `title`, `desc`, `tool` | A step row with a spinner |
| `step_finished` | Each step ends | `index`, `title`, `desc`, `tool`, `result`, `ms`, `provenance`, `error` | Tick the row and show `result`. **Same shape as the mock `Step` in `agent.ts`** |
| `block_ready` | A visual is ready | `block` (typed; section 6) | Render the block; at most one has `primary: true` |
| `answer` | The answer is ready | `answer` (section 5) | The answer card |
| `error` | Something failed | `message`, `recoverable`, `kind` (e.g. `no_clear_scenes`) | An inline notice; if `recoverable` is false, a final `done{status: "failed"}` follows |
| `done` | Always last | `run_id`, `status` (`done` · `waiting_user` · `failed` · `refused`), `tokens`, `cost_usd`, `ms` | Stop loading |

### 3.4 Typical orders

```text
Normal run:      run_started → guard → hypotheses_registered → (step_started → step_finished)×N
                 → block_ready×M → answer → done{status: "done"}

Needs the user:  run_started → guard → … → clarification_needed → done{status: "waiting_user"}
                 … user answers …  POST /reply →  clarification_answered → steps → blocks → answer → done

Refused:         run_started → guard{scope: "not_allowed", rule_id: "identify_person"}
                 → block_ready{type: "limits"} → done{status: "refused"}      (emitted once A3 lands)

Failed:          … → error{recoverable: false, kind: "no_clear_scenes"} → done{status: "failed"}
```

Steps and blocks can interleave in real runs; render each as it arrives.

### 3.5 A real captured stream (stub run, trimmed)

Captured from the running server with `curl -N -X POST localhost:8000/api/runs -H 'content-type: application/json' -d '{"question":"Have these ponds been filled in?"}'`. It had 32 events: 11 steps, 5 blocks.

```text
event: run_started
data: {"event":"run_started","run_id":"r_93fc26473675","thread_id":"t_04a22c30aa6d"}

event: guard
data: {"event":"guard","scope":"answerable","rule_id":null,"reason":null}

event: hypotheses_registered
data: {"event":"hypotheses_registered","hypotheses":["pond_filling","water_loss","seasonal"],"expectation_table":[{"hypothesis":"pond_filling","expected":{"water":"↓ by > 0.2; < 0","roughness":"↑ by > 6","moisture":"< -0.05","bare":"> 0","greenness":"< 0.25"},"observed":{},"verdict":"untested"}, …],"post_hoc":false}

event: step_started
data: {"event":"step_started","index":1,"title":"Look up the place","desc":"Size, land cover and recent satellite passes","tool":"describe"}

event: step_finished
data: {"event":"step_finished","index":1,"title":"Look up the place","desc":"Size, land cover and recent satellite passes","tool":"describe","result":"Looked up Hoo Hok Wai ponds: 38.4 ha, 9 clear scenes in 60 days","ms":0,"provenance":null,"error":null}

… steps 2–11 …

event: block_ready
data: {"event":"block_ready","block":{"type":"then_now","id":"b1","primary":true,"title":"Water, 5 Oct 2024 vs 30 Sep 2026", …}}

… 4 more blocks: timeline b2 (open water), timeline b3 (greenness), stat b4, hypotheses b5 …

event: answer
data: {"event":"answer","answer":{"kind":"place","title":"About 32.7 ha of the ponds no longer show open water","eyebrow":"Hoo Hok Wai ponds","color":"#3b82f6","sentence":"About 32.7 ha of the ponds no longer show open water: the water index fell from 0.10 to -0.25 between 5 Oct 2024 and 30 Sep 2026.","l1":"Likely cause","cause":"consistent with the ponds being filled in","l2":"What to do","todo":"Check later images after heavy rain, or the site itself, before relying on this.","stats":[{"l":"Area without open water","v":"32.7 ha","ci":null},{"l":"Water index","v":"0.10 → -0.25","ci":null},{"l":"Clear passes","v":"99 of 148","ci":null}],"confidence":{"level":"Low","pct":40,"note":"The knowledge cards behind this are drafts, not yet tested on known cases."},"caveats":["Who did the filling, why, and whether it was permitted cannot be known from satellite images.", …],"preset":true, …}}

event: done
data: {"event":"done","run_id":"r_93fc26473675","status":"done","tokens":0,"cost_usd":0.0,"ms":53}
```

The steps in that run:

1. Look up the place
2. Find satellite passes
3. Track open water
4. Track greenness
5. Compare water before and after
6. Read the earlier image
7. Compute water for the earlier image
8. Draw the earlier water map
9. Read the latest image
10. Compute water for the latest image
11. Draw the latest water map

### 3.6 Reading the stream in the browser

The browser's built-in `EventSource` only does GET, and we POST. So read the stream with `fetch`. Drop this into `frontend/src/api/` and type `StreamEvent` from the generated schema:

```ts
// frontend/src/api/stream.ts
export type StreamEvent = { event: string; [key: string]: unknown }; // replace with generated types

export async function streamRun(
  path: string,                       // "/api/runs" or `/api/runs/${runId}/reply`
  body: unknown,
  onEvent: (ev: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`${path} failed: ${res.status} ${await res.text()}`); // JSON error detail
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value.replace(/\r\n/g, '\n');
    let cut: number;
    while ((cut = buffer.indexOf('\n\n')) !== -1) {
      const message = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      const data = message
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (data) onEvent(JSON.parse(data) as StreamEvent); // ':' ping lines have no data
    }
  }
}
```

Usage:

```ts
await streamRun('/api/runs', { question, area }, (ev) => {
  switch (ev.event) {
    case 'run_started': setRun(ev.run_id, ev.thread_id); break;
    case 'step_started':
    case 'step_finished': upsertStep(ev); break;            // key by ev.index
    case 'block_ready': addBlock(ev.block); break;
    case 'clarification_needed': showClarifyCard(ev.questions, ev.remember); break;
    case 'answer': setAnswer(ev.answer); break;
    case 'error': showNotice(ev.message); break;
    case 'done': setStatus(ev.status); break;               // 'waiting_user' keeps the card open
  }
});
```

If the user navigates away, call `abort()` on the `AbortController`. The server records how the run ended.

## 4. Clarification cards and `/reply`

1. The run stream sends `clarification_needed`, then `done{status: "waiting_user"}`, and closes. The run stays `waiting_user`, and `GET /api/runs/{id}` shows it that way after a refresh.
2. Show the card. Prefill each question from `value`, and show the badge from `source`.
3. When the user submits, POST the answers, **reading the response as a stream again**:

```ts
await streamRun(`/api/runs/${runId}/reply`, { answers: { use: 'Fish ponds', since: 'This year' }, remember: true }, onEvent);
```

- **Same handler, same `run_id`.** The reply stream starts with `clarification_answered`, then continues with steps, blocks, `answer` and `done`.
- Only keys that were asked are accepted.
- `remember: true` saves the answers to the place's memory, if the run has a `place_id`.
- Replying to a run that isn't waiting gives **409**. A run you don't own gives **404**.

> The current stub run never asks a question. This flow goes live with A3, and the contract above is frozen.

## 5. The answer (`answer` event / `RunRecord.answer`)

The backend `Answer` is built to drop into the existing answer card in `frontend/src/data/agent.ts`:

| Backend field | Frontend `Answer` field | Notes |
|---|---|---|
| `kind`, `title`, `eyebrow`, `color` | same | `kind`: `place` or `general` |
| `l1`, `cause` | same | `cause` is `null` for **measure-only** answers (no knowledge card matched); show "Cause unknown" |
| `l2`, `todo` | same | |
| `stats` [{`l`, `v`, `ci`}] | `stats` | same keys |
| `confidence` {`level`, `pct`, `note`} | same | Capped at **Low** while cards are drafts |
| `caveats` | same | The "what it can't tell" list |
| `route` [{`sat`, `status`, `why`}] | same | |
| `proof` [{`id`, `date`, `sat`, `cloud`, `used`, `why`}] | same | |
| `hash` | same | Reproducibility hash |
| `skill_id` | `skillId` | rename |
| `suggested_skills` | `suggested` | rename (general answers) |
| `sentence` | *(new)* | The one-sentence answer: show under the title |
| `blocks` | *(new)* | The same blocks that were streamed as `block_ready` |
| `followups` | *(new)* | Up to 3 suggested next questions (chips) |
| `method` {`cards`[{`id`, `version`, `status`}], `skill`, `code_ref`} | *(new)* | "Method" panel; link cards to `/api/knowledge/cards/{id}` |
| `measure_only`, `preset` | *(new)* | Flags. Show a small "demo data" tag when `preset` is true |

## 6. Blocks (visuals)

Blocks are defined by Meet in `backend/earth/blocks.py` (HANDOFF B9). Each has `type`, `id`, `primary`, `title`, `caption`, `links` and `provenance`, plus its own fields. v1 types:

| `type` | Draw it as |
|---|---|
| `then_now` | Two dated map images with a slider. Images come with `url` + `bounds` (west, south, east, north) to place on the map |
| `timeline` | A line of a measure over time, the normal seasonal band, and marks. Each point carries its `scene`, so clicking a point can move the map's time cursor |
| `scene_strip` | A strip of satellite passes (date, satellite, clear or cloudy) |
| `highlight` | Patches outlined on the map, with their size |
| `hypotheses` | "What else could it be": each cause with its verdict |
| `stat` | One big number with its range |
| `limits` | A "can't / won't" answer: `cant_tell`, `actions` (radar, wait, enlarge, expert), `contacts`, `rule_id` |

`links` say how blocks connect:

- `{"time": "cursor"}` blocks **set** the shared time cursor.
- `{"time": "follow"}` blocks **follow** it.

Map image URLs (`/api/layers/...png`) are always given inside blocks; use them as they are.

## 7. Areas

`POST /api/areas/resolve`. Send **exactly one** of:

| Field | Example | `source` in the response |
|---|---|---|
| `point` | `{"point": {"lat": 22.534, "lon": 114.0906, "radius_m": 350}}` | `point` |
| `geojson` | a drawn polygon (Feature, FeatureCollection or geometry) | `geojson` |
| `link` | a Google Maps, Apple Maps, WhatsApp location or `geo:` link | `link` |
| `query` | `"22.534, 114.0906"` → `coordinates`; `"Hoo Hok Wai"` → `preset`; `"Wong Tai Sin"` → place search | `coordinates` / `preset` / `search` |

- Free-text place search uses Meet's Nominatim provider (OpenStreetMap; needs internet; results cached). A search returns the best match as `area` and other candidates in `matches`: offer them as "Did you mean…". If the geocoder isn't available, the API returns **501**.
- An unusable area gives **422** with `detail: {kind, message, hint}`. Show the `hint`.

`POST /api/areas/context` with `{"point": …}` or `{"geojson": …}` returns the place facts used for the "Spot picked" card: size, land cover, slope, and how many recent passes were clear.

## 8. Errors

| Code | Meaning | `detail` |
|---|---|---|
| 400 | Bad input: ids, `X-User-Id`, area, reply answers too long | text, or `{kind, message, hint}` for areas |
| 404 | Not found, or not yours (runs, threads, cards, layers) | text |
| 409 | Reply to a run that isn't waiting for the user | text |
| 422 | Request didn't match the schema (FastAPI validation), or unusable area | FastAPI validation list / `{kind, message, hint}` |
| 501 | Place search not available (geocoder missing) | text |

Once a stream has started, problems arrive as `error` events, never as HTTP errors.

## 9. Keeping the contract in sync

- The backend changes a schema → runs `cd backend && uv run python -m app.export_openapi` → commits `contracts/openapi.json` in the same PR (CI enforces this).
- The frontend regenerates its types (section 1) and uses only fields that exist there.
- Need a new field or endpoint? Open a GitHub issue labelled `api` (COLLABORATION.md §6).

## 10. Places and memory

Saved places (the Places page) and the private notes the agent reads. Everything is **snake_case**, scoped to the caller (`X-User-Id`), and ids match `^[a-z0-9][a-z0-9_-]{0,63}$` (a bad id in the path gives **422**).

| Method + path | What it does | Returns |
|---|---|---|
| `GET /api/places` | The caller's places, newest first. The demo user gets Hoo Hok Wai (`pl_hhw`) on first load | `PlaceDto[]` |
| `POST /api/places` | Save a place | `PlaceDto` (**201**) |
| `GET /api/places/{id}` | One place | `PlaceDto` |
| `PATCH /api/places/{id}` | Change any field; sending an outline replaces it | `PlaceDto` |
| `DELETE /api/places/{id}` | Remove it (its memory goes unreachable; ids are never reused) | **204** |
| `GET /api/places/{id}/memory` | Profile, notes and saved insights for the timeline | `PlaceMemory` |
| `PATCH /api/places/{id}/memory` | `{profile?: {k: v}, note?: str}`: profile keys merge, a note is appended | `PlaceMemory` |
| `GET /api/me/memory`, `PATCH /api/me/memory` | The user's own profile (`{profile: {k: v}}`) | `{profile}` |
| `POST /api/runs/{run_id}/insight` | "Save to place": `{place_id, text, confidence?}` | `{run_id, place_id, saved}` (**201**) |

`PlaceDto`: `id, name, category_key, center{lat,lon}, geometry, area_ha, is_circle, project (nullable), tags, source, created_at, updated_at, details[{label, value}]`. `area_ha` is computed by the server; show it as is.

Create/patch rules:

- Send `geometry` (a GeoJSON Polygon/MultiPolygon). If you also send `center`, it is ignored: the centre is recomputed.
- Without `geometry`, send `center` + `radius_m` (a dropped pin, `is_circle` defaults to true).
- `is_circle` can be set explicitly on create and patch.
- `details` (create only) are saved to the place's memory profile and come back in `details`.
- Limits (**422**): name 120 chars, ≤ 20 tags of ≤ 40 chars, `details` ≤ 30 rows (label ≤ 40, value ≤ 300), geometry within the same size limit as `/api/runs`. A place's profile holds at most 50 keys in total.
- An unusable outline gives **400** `{kind, message, hint}`; show the `hint` (for example "did you swap them?"). Outlines over 25 km² are refused with `kind: "budget_exceeded"`.
- Unknown or someone else's place: **404**.
- Not built yet: place search (use `/api/areas/resolve`), detect-boundary, parcel lookup.
