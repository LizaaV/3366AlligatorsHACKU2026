# Constellation API: guide for the frontend

**Who this is for:** @LizaaV and @annaclairebb (frontend), plus anyone calling the backend.
**Source of truth:** `contracts/openapi.json` (generated from the backend's Pydantic schemas). This guide explains what OpenAPI can't: how the live stream works, the order of events, how to read it in the browser, and how fields map onto the existing mocks in `frontend/src/data/`.

> **Status (Sun 4 Oct):** the agent is live. The contract only grew, additively.
>
> - When the server has `ANTHROPIC_API_KEY`, `POST /api/runs` runs the **agent loop** (A3, Claude Opus 5.5). Clarification cards and refusals now come from real runs. Agent answers have `preset: false` and `method.model` set. How the agent works: [AGENT.md](AGENT.md).
> - Without a key, with `AGENT_MODE=preset`, or once the daily spend cap is reached, the server falls back to the **scripted Hoo Hok Wai run** (`preset: true`), but only for that place (section 3.4).
> - New: `RunRequest.provider`, `RunRecord.provider` / `model`, `Method.model`, a **429** cooldown, and **429 / 503** on `/reply`.
> - Fix your stream reader if it normalises `\r\n` per chunk (section 3.6).

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
| `GET /api/threads?limit=20` | **Chat history:** the user's conversations, newest first (title = first question, place, last question, status, answer line) | `ThreadSummary[]` |
| `GET /api/threads/{thread_id}` | Reopen one conversation: every run, oldest first, with answers, blocks and event logs to redraw it exactly | `ThreadDetail` |
| `GET /api/health` | Liveness check | `{status: "ok"}` |

**Not built yet** (coming in later modules; keep using the mocks):

- watches and skills listing (A5)

## 3. The live stream (`POST /api/runs`)

### 3.1 Request

```json
{
  "question": "Have these ponds been filled in?",
  "area": { "point": { "lat": 22.534, "lon": 114.0906, "radius_m": 350 }, "name": "Hoo Hok Wai ponds" },
  "place_id": null,
  "thread_id": null,
  "skill_id": null,
  "lang": "en",
  "provider": null
}
```

| Field | Notes |
|---|---|
| `question` | Required, 1–2000 characters |
| `area` | Optional. Either `{point: {lat, lon, radius_m}}` or `{geojson: <Feature, FeatureCollection or geometry>}`, plus an optional `name`. Outlines are capped at 10,000 points, 200 features and nesting depth 8 (422 beyond that). **Send it whenever the user picked a place.** If omitted, the agent works without an outline: it can look up a place named in the question, or ask. It never uses the demo place as a stand-in. Only the preset fallback assumes Hoo Hok Wai |
| `place_id` | A saved place. The agent prefills clarification answers from its memory, and `remember: true` on `/reply` saves to it. The agent takes the outline from the saved place only once the places service is installed, so send `area` too |
| `thread_id` | To ask a **follow-up** in the same conversation. Must be a thread id this user got from an earlier `run_started`; anything else → 404 |
| `skill_id` | Optional hint: the agent is told the user picked this skill and runs it if it fits the question |
| `lang` | Optional, default `"en"`. The language you want the answer in, as a BCP 47 tag (`en`, `zh-Hant`, `yue`, `pt-BR`…). Stored on the run (`RunRecord.lang`). **For now answers are always English**; a non-English question gets the caveat "Answers are in English for now." Translated answers come later, and nothing changes for the frontend when they do |
| `provider` | Optional, `"claude"` or `null`. Omit it (or send `null`) for the server default. Naming a provider the server has not configured → **400** |

Errors **before** the stream starts are plain JSON:

- **400:** bad area, bad ids, bad `X-User-Id`, or a `provider` the server has not configured
- **404:** unknown thread
- **422:** validation
- **429:** too many runs. Either the same user started a run less than 3 s ago (`RUN_COOLDOWN_S`), or 3 agent runs are already streaming on the server. The response has a `Retry-After` header (seconds) and a text `detail`. Wait, then retry. Only agent runs are limited; the preset fallback is not

### 3.2 What comes back

The response has `Content-Type: text/event-stream`.

- Each message is an `event:` line plus a `data:` line holding JSON. Every JSON payload also carries its own `"event"` field, so you can ignore the `event:` line and just parse `data`.
- Lines end with `\r\n`, and messages are separated by a blank line. A `\r\n` can be split across two network chunks; section 3.6 handles that.
- Lines starting with `:` are keep-alive pings; skip them.

Agent runs take tens of seconds, with gaps of several seconds between events while the model thinks.

**Every stream ends with exactly one `done`.** That's your signal to stop the spinner.

### 3.3 Events

| Event | When | Payload (key fields) | Show it as |
|---|---|---|---|
| `run_started` | First | `run_id`, `thread_id` | Store both: `run_id` for reload/reply/share, `thread_id` for follow-ups |
| `guard` | Second | `scope` (`answerable` · `partial` · `out_of_scope` · `not_allowed` · `emergency` · `off_topic`), `rule_id`, `reason` | Usually nothing. On a refusal it's followed by a `limits` block and `done{status: "refused"}`. Rarely, a **second** `guard{scope: "not_allowed", rule_id: null}` arrives mid-run when the AI model itself declines; a `limits` block and `done{status: "refused"}` follow. Show the latest `guard` |
| `hypotheses_registered` | Before any data is read, and again if the agent adds causes later | `hypotheses` (card ids), `expectation_table` [{`hypothesis`, `expected` {measure → text}, `observed`, `verdict`}], `post_hoc` | "What I'm checking" line or chips. Append the new ones; `post_hoc: true` means they were added after data was read (confidence capped at Low). Code always adds `seasonal` and look-alikes. The final verdicts arrive in the `hypotheses` block |
| `clarification_needed` | When the agent needs the user (at most twice per run) | `questions` [{`key`, `label`, `options`, `value` (prefill), `source` {`from`: `memory`·`inferred`, `saved`}}], `remember` | The clarification card: 1–3 questions, 2–5 option chips each. Show a "From memory · 12 Sep" badge when `source.from == "memory"`. The stream then ends with `done{status: "waiting_user"}` (section 4) |
| `clarification_answered` | First event of a reply stream | `answers`, `remember` | Collapse the card into a summary line |
| `step_started` | Each visible step begins | `index`, `title`, `desc`, `tool` | A step row with a spinner |
| `step_finished` | Each step ends | `index`, `title`, `desc`, `tool`, `result`, `ms`, `provenance`, `error` | Tick the row and show `result`. **Same shape as the mock `Step` in `agent.ts`** |
| `block_ready` | A visual is ready | `block` (typed; section 6) | Render the block; at most one has `primary: true`. Ids are unique within a run |
| `answer` | The answer is ready | `answer` (section 5) | The answer card |
| `error` | Something failed | `message`, `recoverable`, `kind` | An inline notice. A `done{status: "failed"}` always follows. `recoverable: true` means trying again later may work. Kinds: `llm_unavailable` (the AI model could not be reached), `agent_unavailable` (no live analysis on this server, only the demo place), `spend_cap` (daily budget used up), or an `earth` kind such as `no_clear_scenes` |
| `done` | Always last | `run_id`, `status` (`done` · `waiting_user` · `failed` · `refused`), `tokens`, `cost_usd`, `ms` | Stop loading. `tokens` and `cost_usd` are filled for agent runs (0 for the preset) |

**Steps in an agent run.** Each tool the agent uses is a step: "Read the card: …", "List what could explain it", "Run the pond-filling-check skill", "Run an analysis script", "Ask you", "Check the answer". Each satellite call inside a script is its own step too ("Find satellite passes", "Track a measure over time", "Compare before and after", …).

- Indexes keep increasing across the whole run, including after a reply. Key rows by `index`.
- "Check the answer" can appear more than once: code rejected a draft ("2 problem(s) found; revising the answer") and the agent fixed it.

### 3.4 Typical orders

```text
Agent run:       run_started → guard → step "Look up the place" → steps "Read the card: …"
                 → step "List what could explain it" + hypotheses_registered
                 → step "Run the … skill" (or "Run an analysis script"): its satellite steps,
                   then block_ready for each visual it made
                 → step "Check the answer" (repeated if a draft was rejected)
                 → block_ready{type: "hypotheses"} → answer → done{status: "done"}

Needs the user:  run_started → guard → … → step "Ask you" → clarification_needed → done{status: "waiting_user"}
                 … user answers …  POST /reply →  clarification_answered → steps → blocks → answer → done

Refused:         run_started → guard{scope: "not_allowed", rule_id: "identify_person"}
                 → block_ready{type: "limits"} → done{status: "refused"}

Redirected:      run_started → guard{scope: "emergency" | "off_topic" | "out_of_scope"}
                 → block_ready{type: "limits"} → answer{kind: "general"} → done{status: "done"}

No live agent:   run_started → error{kind: "agent_unavailable" | "spend_cap", recoverable: false}
                 → done{status: "failed"}          (a place other than the demo place, see below)

Failed:          … → error{kind: "llm_unavailable" | "no_clear_scenes" | …} → done{status: "failed"}
```

Steps and blocks interleave; render each as it arrives.

- **Explanation questions** ("what is greenness?") read cards, measure nothing and end with `answer{kind: "general"}`.
- **Runs that hit a limit** (turns, code runs, the 150 s clock, a draft that keeps failing the checks) still end with an `answer`: a measure-only one built by code from what was measured, with `cause: null` and Low confidence.

**Preset fallback.** When the server has no AI model configured, runs in `AGENT_MODE=preset`, or has used up its daily budget, it answers with the scripted Hoo Hok Wai run (`preset: true`). It does so only when the request names no place, or its `area` is the Hoo Hok Wai outline. Any other place gets the "No live agent" order above, never the demo answer for the wrong place.

### 3.5 A real captured stream (preset run, trimmed)

This is the scripted preset run (what the server streams without an AI model). Agent runs use the same events in the orders shown in 3.4; a live pond run on stub data had 25 to 27 steps and 5 to 6 blocks in 35 to 57 s. Captured from the running server with `curl -N -X POST localhost:8000/api/runs -H 'content-type: application/json' -d '{"question":"Have these ponds been filled in?"}'`. It had 32 events: 11 steps, 5 blocks.

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

The browser's built-in `EventSource` only does GET, and we POST. So read the stream with `fetch`. Drop this into `frontend/src/api/` and type `StreamEvent` from the generated schema.

The reader must handle two network details:

- **A `\r\n` split across two chunks.** One chunk ends with `\r` and the next starts with `\n`. If you normalise each chunk on its own, that `\r\n` is either missed or counted as two line ends. Then a blank line is missed (two events merge and `JSON.parse` throws) or invented (an event is cut in half). So normalise line ends on the **accumulated buffer**, and hold back a trailing lone `\r` until the next chunk arrives.
- **A last event without its blank line.** When the stream ends, parse what is left in the buffer as one more event.

`frontend/src/api/stream.ts` currently normalises per chunk and drops a final unterminated event; port these two changes.

`TextDecoderStream` already handles multi-byte characters (e.g. Chinese) split across chunks.

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
    buffer += value;
    // Normalise \r\n and lone \r on the whole buffer (a \r\n can be split across chunks),
    // holding back a trailing \r: its \n may be the first character of the next chunk.
    const held = buffer.endsWith('\r');
    buffer = (held ? buffer.slice(0, -1) : buffer).replace(/\r\n?/g, '\n') + (held ? '\r' : '');
    let cut: number;
    while ((cut = buffer.indexOf('\n\n')) !== -1) {
      emitMessage(buffer.slice(0, cut), onEvent);
      buffer = buffer.slice(cut + 2);
    }
  }
  // End of stream: a trailing \r is a line end now, and the last event may have no blank line.
  for (const message of buffer.replace(/\r\n?/g, '\n').split('\n\n')) {
    emitMessage(message, onEvent);
  }
}

/** One SSE message: join its `data:` lines (':' ping lines and empty leftovers have none). */
function emitMessage(message: string, onEvent: (ev: StreamEvent) => void): void {
  const data = message
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''))
    .join('\n');
  if (data) onEvent(JSON.parse(data) as StreamEvent);
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

- **Same handler, same `run_id`.** The reply stream starts with `clarification_answered`, then continues with steps, blocks, `answer` and `done`. Step `index` continues from where the first stream stopped.
- Only keys that were asked are accepted.
- `remember: true` saves the answers to the place's memory, if the run has a `place_id`.
- Errors before the stream:
  - **409:** the run isn't waiting.
  - **404:** a run you don't own.
  - **429** (with `Retry-After`): 3 agent runs are already streaming.
  - **503:** the run's AI model is not available any more, or the daily budget is used up. Nothing about the run changes, so the user can retry later.

> **Live since A3.** The agent asks when the answer depends on something only the user knows. That is at most twice per run, with 1–3 questions of 2–5 options each. The card shows options only; send one of them. A value that is not one of the options is treated as private: the agent never repeats it in its answer.
>
> In the live test, "How much forest did the whole Amazon basin lose this year?" asked the user to pick a smaller area. The run waited with `done{waiting_user}` after 7 s, and the reply streamed the rest. The preset run never asks.

## 5. The answer (`answer` event / `RunRecord.answer`)

The backend `Answer` is built to drop into the existing answer card in `frontend/src/data/agent.ts`:

| Backend field | Frontend `Answer` field | Notes |
|---|---|---|
| `kind`, `title`, `eyebrow`, `color` | same | `kind`: `place`, or `general` for explanations (no data read) and policy replies (emergency, off-topic, blame) |
| `l1`, `cause` | same | `cause` is `null` for **measure-only** answers (no knowledge card is supported, or code can't tell two causes apart); show "Cause unknown" |
| `l2`, `todo` | same | |
| `stats` [{`l`, `v`, `ci`}] | `stats` | same keys. Every number is checked by code against what the run measured |
| `confidence` {`level`, `pct`, `note`} | same | Computed by code, never by the AI model. Capped at **Low** while cards are drafts (all are today). Policy replies (emergency, off-topic, blame) show High 90: they are fixed texts, not an analysis |
| `caveats` | same | The "what it can't tell" list |
| `route` [{`sat`, `status`, `why`}] | same | |
| `proof` [{`id`, `date`, `sat`, `cloud`, `used`, `why`}] | same | |
| `hash` | same | Reproducibility hash |
| `skill_id` | `skillId` | rename |
| `suggested_skills` | `suggested` | rename (general answers) |
| `sentence` | *(new)* | The one-sentence answer: show under the title |
| `blocks` | *(new)* | The same blocks that were streamed as `block_ready` |
| `followups` | *(new)* | Up to 3 suggested next questions (chips) |
| `method` {`cards`[{`id`, `version`, `status`}], `skill`, `code_ref`, `model`} | *(new)* | "Method" panel; link cards to `/api/knowledge/cards/{id}`. `model` is the AI model id behind the answer (e.g. `claude-opus-5-5`); `null` for preset, policy and code-built (template) answers |
| `measure_only`, `preset` | *(new)* | Flags. Show a small "demo data" tag when `preset` is true. Agent answers have `preset: false` |

**`RunRecord`** (`GET /api/runs/{id}`) also carries:

- `provider` and `model`: which AI ran the agent, e.g. `"claude"` and `"claude-opus-5-5"`. Both are `null` for preset runs.
- `cost` {`input_tokens`, `output_tokens`, `usd`}.
- `params`: only public keys such as `skill_id`, `script_params`, `script_block_ids`. The agent's private state (its transcript and the user's remembered values) is never returned.

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

## 7b. Conversations (threads) and follow-ups

- Every run belongs to a thread. Send the `thread_id` from `run_started` to ask a **follow-up** ("Since when?", "Is that normal?").
- **What the follow-up keeps from the previous answer:** the agent starts from the last answer in the thread (its place, hypotheses, cards and measurements), so it only reads new data when it needs to.
- **The place:** if a follow-up has no `area` or `place_id`, it reuses the previous run's place.
- **History:** `GET /api/threads` lists conversations for a history sidebar, and `GET /api/threads/{id}` reloads one exactly (same events as when it streamed). Store `thread_id` so a refresh can reopen the chat.
- **Limits:**
  - A conversation holds at most **30 runs**, then `POST /api/runs` returns **409** ("start a new one": omit `thread_id`).
  - **Anti-spam:** at most **40 runs per user** and **60 per client address** per hour (questions + clarification replies). Over that, the API returns **429** with `Retry-After` (seconds). There is also a few-second cooldown between runs.

## 8. Errors

| Code | Meaning | `detail` |
|---|---|---|
| 400 | Bad input: ids, `X-User-Id`, area, reply answers too long, a `provider` the server has not configured | text, or `{kind, message, hint}` for areas |
| 404 | Not found, or not yours (runs, threads, cards, layers) | text |
| 409 | Reply to a run that isn't waiting for the user | text |
| 422 | Request didn't match the schema (FastAPI validation), or unusable area | FastAPI validation list / `{kind, message, hint}` |
| 429 | Too many runs: the same user within 3 s, or 3 agent runs already streaming. Wait `Retry-After` seconds | text |
| 501 | Place search not available (geocoder missing) | text |
| 503 | `/reply` only: the run's AI model is not available, or the daily budget is used up | text |

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

## 11. PDF report

| Method + path | What it does | Returns |
|---|---|---|
| `GET /api/runs/{run_id}/report.pdf` | The finished run as an A4 PDF. Owner only: **404** if not yours, **409** if the run is not `done`, **400** for a bad id | `application/pdf`, `Content-Disposition: attachment; filename="earth-agent-<run_id>.pdf"` |
| `GET /api/shares/{slug}/report.pdf` | The same PDF for a share link, no login. **404** unknown link, **410** expired or revoked | `application/pdf`, filename `earth-agent-<first 8 of slug>.pdf` |

Use a plain link or `fetch` + blob; the owner route needs the `X-User-Id` header, so fetch it if you use a non-demo user. On a share page, link to the share route.

- Contents: question, place and date, the answer (sentence, confidence, cause, what to do, caveats), every block (then/now images side by side, timeline chart, highlight, stat, hypotheses table, scene table, limits box), then provenance and method (cards, skill). Footer on every page with the "not an official assessment" line and page numbers.
- Privacy: built from the same allow-list snapshot as a share link. It never contains params, events, script, memory, user id, thread id or run id.
- A layer image that is missing on disk shows a grey placeholder; the PDF is still returned.
- Limit: built-in Helvetica font, Latin only. Chinese text (`zh-Hant`, `yue`) appears as `?` and the PDF says so.

## 12. Trigger recurrence, dashboard link and satellites

**Triggers (watches).** `WatchDto`, `CreateWatchRequest` and `PatchWatchRequest` gain two fields,
both optional on write:

- `recurrence: "recurring" | "once"` (default `"recurring"`). A `once` trigger sets
  `enabled: false` after its first `alert`-level event; `recurring` keeps going. Not nullable on PATCH.
- `dashboard_id: string | null` (default `null`). Links the trigger to a dashboard from
  `/api/dashboards`. Create/PATCH answer **404** when the id is not one of the user's dashboards.
  On PATCH, an explicit `null` unlinks it.

**`GET /api/satellites?at=<ISO datetime>`** returns `SatelliteDto[]` (`at` defaults to now, UTC):

```json
{ "id": "sentinel-2a", "name": "Sentinel-2A", "norad_id": 40697, "mission": "Sentinel-2",
  "lat": 12.3, "lon": 45.6, "alt_km": 786.2, "velocity_kms": 7.45,
  "at": "2026-10-04T12:00:00Z", "track": [{ "lat": 12.3, "lon": 45.6 }] }
```

`track` is the sub-satellite point for the next 90 minutes at 2-minute steps (45 points, the first
equals the current position). Satellites: Sentinel-1A, Sentinel-2A/2B/2C, Landsat 8/9, Terra, Aqua,
Suomi NPP. TLEs come from CelesTrak (cached 6 h) with a bundled fallback snapshot, so the endpoint
works offline; positions are approximate (a few km).
