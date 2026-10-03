# HANDOFF: Earth Agent backend architecture

> **This is a handoff document.** It records every backend design decision made on Sat 3 Oct 2026 (HacKU 2026, Day 2), so a teammate or their coding agent can pick the work up without the original conversation.
>
> - **Written by:** Alex (@Alex-bot16) with Claude Code
> - **For:** @meetrk (backend co-owner), and everyone else for context
> - **Status:** design agreed, nothing built yet beyond the FastAPI skeleton in `backend/`
> - **Code freeze:** **Sun 4 Oct 2026, 13:00 HKT.** No late submissions.

## How to read this

| You are… | Read |
|---|---|
| A teammate who wants the picture | **Part A** (sections A1–A8), about 10 minutes |
| A coding agent (Claude etc.) implementing this | Everything. **Part B is the binding spec.** Repo rules in `COLLABORATION.md` §10 still apply (branches, Conventional Commits, stay in your area, regenerate `contracts/openapi.json`). |
| In a hurry | A1, A3 and **A7 (build steps)** |

Sources of context that fed this design are listed in **B15**. Where this document and the Friday "Overhead" prototype or brief disagree, **this document wins**. Overhead is reference material only.

---

# PART A: Architecture overview

## A1. What we are building, in one paragraph

**Earth Agent** lets anyone pick any place on Earth and ask a plain-language question: "did a landslide happen on this slope after last week's rain?", "was this pond filled in?", "is this construction progressing?", "did the flood reach here?". It is **general purpose, not farm-specific**.

An AI agent reasons in a **fixed, visible, step-by-step process** grounded in a **curated knowledge base**. It **writes and runs small programs** in a sandbox against **our own satellite library, `earth`**, which reads free satellite data. It then answers with:

- one plain sentence
- the evidence from each satellite
- how sure it is, and why
- what it **cannot** tell
- interactive visuals: maps, timelines, then-and-now comparisons, ranked possible causes

Satellite pixels never go to the language model. The model plans and explains; code measures, scores and enforces.

## A2. Principles (non-negotiable)

1. **The LLM requests, code grants.** Policy, budgets, confidence and knowledge promotion are decided by code and files, never by the model.
2. **No number the code did not produce.** Every number in an answer must exist in the tool results; otherwise a template sentence is used.
3. **No cause without a knowledge card.** The agent can only name causes described in a card, backed by the signs that card lists.
4. **Pixels stay on the server.** The model sees small tables, never arrays.
5. **Every result carries provenance:** satellite, scene date, cloud, resolution, method.
6. **Honest limits on every answer.** "Can't tell between A and B" is a valid answer.
7. **Structured everything.** Decisions are values from fixed lists (rule ids, card ids, skill ids, block types), not free text.

## A3. Architecture diagram

```
 Frontend (React, existing app in frontend/)
     │  area (GeoJSON) + question                         ◄── streamed steps, then Answer + visual blocks
     ▼
 ┌─ Backend (FastAPI, backend/app) ───────────────────────────────────────────────────────────┐
 │                                                                                             │
 │  API  ──►  AGENT PIPELINE (Claude Opus 5.5)                                                 │
 │             guard → think (understand, hypothesise, expectation table, plan, code) → explain │
 │                │ reads                                   │ writes code                      │
 │                ▼                                         ▼                                  │
 │  KNOWLEDGE BASE (backend/knowledge)            SANDBOX (Docker: no internet, no keys)       │
 │   cards: event · setting · measure ·           │ run.py → `import earth` (thin client)      │
 │          source · method                       └───────────────┬────────────────────────────┘
 │   skills: SKILL.md + run.py + tests.yaml                       │ every call forwarded + logged
 │   policy: rules.yaml · templates · tests                       ▼                            │
 │                                               EARTH SERVICE (trusted, ours)                 │
 │                                                plain-language measures · provenance ·       │
 │                                                routing · budgets · cache · rendering        │
 └────────────────────────────────────────────────────────────┬────────────────────────────────┘
                                                              ▼
              Earth Search (Sentinel-2) · Planetary Computer (Sentinel-1, Landsat, DEM, WorldCover)
              NASA FIRMS (fire) · Open-Meteo (weather/rain) · Nominatim (place names)
```

## A4. The components

| # | Component | One-line job | Where |
|---|---|---|---|
| 1 | **`earth`** | Our satellite library: area + time + plain measure → small numbers, layers, provenance | `backend/earth/` (separate package, no FastAPI imports) |
| 2 | **Earth service** | Runs the real `earth`, holds keys, enforces budgets, logs each call (these become UI steps), renders map images | process next to the API |
| 3 | **Sandbox** | Runs agent-written Python with no internet; `earth` inside it is a thin client forwarding to the service | Docker image `earth-runner` |
| 4 | **Agent pipeline** | The structured thinking process (A5) using Claude Opus 5.5 | `backend/app/services/agent/` |
| 5 | **Knowledge base** | Cards (what things look like from space) + skills (tested procedures) | `backend/knowledge/` |
| 6 | **Policy** | Every "no" as structured rules: hard blocks, out-of-scope, feasibility, emergency, off-topic, injection | `backend/knowledge/policy/` |
| 7 | **Output blocks** | Typed visual descriptions (timeline, then_now…) the frontend renders | schemas in `backend/app/schemas/` |
| 8 | **API** | Contract the frontend codes against (`contracts/openapi.json`) | `backend/app/api/routes/` |

## A5. The thinking pipeline (what the agent does, in order)

> **Superseded (team decision, 3 Oct):** the agent now runs as a tool-use loop with these stages kept as harness rules. See [`backend/ARCHITECTURE.md`](../backend/ARCHITECTURE.md) §4.0. The stages below remain the reference for *what* the loop must do.

```
0. GROUND       earth.describe(area) → facts about the place; the matching SETTING card is attached automatically
1. GUARD        policy check: answerable / partial / out_of_scope / not_allowed / emergency / off_topic (+ rule id)
2. HYPOTHESISE  candidate events from the question + setting + recent triggers (rain, fire alerts)
                code adds the look-alikes of each candidate + "seasonal change" ALWAYS
3. LEARN        the agent reads the cards it needs (and may ask for more); every card read is logged
4. EXPECT       ★ EXPECTATION TABLE, written before seeing data: for each hypothesis, the expected sign per measure
5. CHECK FIT    can we measure this here? area size vs resolution, data available, clouds → adjust, ask or refuse
6. PLAN         choose the measurements that SEPARATE the hypotheses (not everything)
7. CODE         reuse a matching skill's run.py (fill parameters) or write new code against the earth API
8. RUN + CHECK  sandbox; check crash / output shape / plausibility; fix and rerun (max 3)
9. SCORE        CODE (not the LLM) fills the "observed" row, scores each hypothesis against its card, computes confidence
10. RE-LOOK     if the top two are close, the card's "tell apart by" picks ONE extra measurement → back to 7 (once)
11. EXPLAIN     sentence + evidence + "what else it could be" + "can't tell" + cards/skills/versions used + visual blocks
```

**Physically there are only 3 LLM calls** (plus retries): **guard**, **think** (stages 2–7 in one structured call), **explain**.

## A6. Decisions table

| Topic | Decision | Why |
|---|---|---|
| Scope | General (any place, any question), not farm-specific | Team decision; matches the Deep Tech brief "capability that hasn't travelled", where the barrier is expertise |
| Satellite access | **Our own library `earth`**; providers plug in behind it | One place for satellite knowledge; swap providers freely; easy to test and explain to judges |
| How the agent uses `earth` | **Agent writes small Python programs** (not one tool call per function) | Flexibility: loops, combinations, new analyses |
| Where that code runs | **Our Docker sandbox**, no internet, no keys; `earth` inside is a thin client to the trusted earth service | Safety plus a log of every call |
| Check loop | Run → check → fix → rerun, **max 3 tries**; `earth` errors include hints | Self-correcting without guessing |
| Anti-hallucination | **Knowledge cards** + fixed stages + expectation table + code scoring | The model reasons inside known things |
| Knowledge format | Cards = **Markdown with a YAML header**; skills = **folder** (`SKILL.md` + `run.py` + `tests.yaml`); policy = **YAML**; JSON only on the wire | Readable diffs, comments, real runnable code; same convention as Claude Agent Skills |
| Agent drafting knowledge | **Allowed** (draft status only, low confidence); never writes directly, only `propose_change` | Growth without poisoning |
| Verification | draft → **tested** (automatic backtest on hidden real cases + controls) → **reviewed** (human) | Truth comes from outside the LLM |
| Confidence caps | draft = low, tested = medium, reviewed = high | Unverified knowledge can't sound sure |
| Refusals | Structured file `backend/knowledge/policy/rules.yaml`; LLM classifies to a rule id, code enforces | Consistent, testable, editable without code |
| Hard blocks | Identifying people, surveillance of homes or people, military/weapons targeting, harassment | Team decision |
| Prompt injection | 8 defence layers (B8); "nothing to steal" first | Assume the model can be fooled |
| Outputs | Typed **visual blocks**, linked through a shared time cursor | Consistent, interactive, also renderable to PDF |
| Map delivery | PNG overlays + bounds, rendered on demand and cached | Simple |
| Model | **Claude Opus 5.5 (`claude-opus-5-5`) for every call** | Team decision |
| Agent shape | **Tool-use loop** with harness rules (replaces the 3-call pipeline; `backend/ARCHITECTURE.md` §4.0) | Team decision: better results, flexibility and analysis |
| Limits (hackathon) | Per-call `max_tokens`, max 12 model turns / 6 code runs per run (§4.0), retries (code ×3, API ×1), per-user cooldown, daily spend cap | Keep it simple; no queues or backoff machinery |
| Hosting | One VM with Docker (about 4 vCPU / 8 GB) for backend + earth service + sandbox; frontend on Vercel with `/api` forwarded | Render/Railway can't start Docker containers |
| Backend split | **@meetrk:** `earth`, providers, sandbox. **@Alex-bot16:** agent, knowledge, policy, API contract | Parallel work with a clean interface |
| Community content | Off for the hackathon (roadmap) | Risk |

## A7. Build steps (simple, in order)

| Step | What | Owner | Time | Done when |
|---|---|---|---|---|
| 1 | **API contract**: Pydantic schemas (`Area`, `RunRequest`, step events, `Answer`, 6 demo blocks) + stub endpoints serving the Hoo Hok Wai preset + regenerated `openapi.json`. Branch `api/runs-contract` | Alex | ~1 h | Frontend can call `/api/runs` and render the preset |
| 2 | **`earth` v1**: `describe`, `scenes`, `load`, `index` (greenness, water, bare), `measure`, `series`, `compare`, `render`. Sentinel-2 only, disk cache | meetrk | ~4 h | `earth.series(hoo_hok_wai, "greenness", years=4)` reproduces the drop in B12 |
| 3 | **Knowledge seed**: 4 event cards (seasonal, landslide, pond_filling, construction), 2 settings (hillside, wetland_ponds), `policy/rules.yaml`, a validating loader | Alex | ~2 h | Loader validates all files; broken links fail tests |
| 4 | **Agent pipeline**: guard → think → run → explain on Opus 5.5, simple limits, number and wording checks. Code runs in a **subprocess** with timeout + AST scan first | Alex | ~4 h | One real question answered end to end |
| 5 | **Docker sandbox**: move execution into the container, earth calls forwarded to the service | meetrk | ~2 h | Same question works in the container with network off |
| 6 | **Two skills + cached presets**: `slope-check`, `pond-filling-check`; cache Hoo Hok Wai + one landslide run | both | ~2 h | Demo works offline |
| 7 | **Deploy + demo**: VM up, frontend on Vercel, rehearse 3 questions (one refusal), record the 3-minute video | all | Sun AM | Submitted before 13:00 |

**Cut order if time runs out:** Docker sandbox (keep the subprocess version) → second skill → radar and rain.

## A8. Still open

- Exact API contract fields (B10 is the draft; finalise in step 1 with @LizaaV / @annaclairebb)
- Follow-up conversations (proposal in B3.6)
- Watches and alerts in this design (proposal in B10.4: watch = skill + place + schedule + condition; stub only for the hackathon)
- Proof link page (proposal in B9.6)
- Which landslide event to use as the second preset

---

# PART B: Detailed specification (binding for implementers)

## B1. The `earth` library

### B1.1 Purpose

The **only** code in the project that knows about satellites. Everything else (agent, skills, API, watches) goes through it.

### B1.2 Package layout (proposal)

```
backend/earth/
  __init__.py          # public API (the functions below)
  area.py              # Area: from_point / from_geojson / from_place; equal-area hectares; pixel estimate
  measures.py          # plain-language measures → per-sensor formulas
  providers/
    base.py            # Provider interface + capabilities
    earth_search.py    # Sentinel-2 L2A (public, no key)
    planetary.py       # Sentinel-1 RTC, Landsat C2 L2, Copernicus DEM, ESA WorldCover (free URL signing)
    firms.py           # NASA FIRMS active fire (MAP_KEY, server only)
    openmeteo.py       # weather / rain history and forecast (no key)
    nominatim.py       # place names (no key; respect usage policy)
  router.py            # picks a provider per request, records WHY
  budget.py            # per-run limits (calls, scenes, pixels, time)
  cache.py             # disk cache keyed by (collection, item, bands, bbox, resolution)
  render.py            # Layer → PNG + bounds; colour ramps come from measure cards
  errors.py            # errors with hints (see B1.7)
  client.py            # thin client used INSIDE the sandbox: same API, forwards over HTTP to the earth service
```

### B1.3 Public API (what agent code can call)

```python
import earth

area   = earth.Area.from_point(22.49, 114.03, radius_m=400)   # also from_geojson(...), from_place("Wong Tai Sin")
ctx    = earth.describe(area)
# → {name, country, area_ha, pixels_10m, land_cover: {trees: .62, water: .1, built: .05, ...},
#    elevation_m: {min, max}, slope_deg: {mean, p90}, recent_scenes: {optical: 7, clear: 4, radar: 3},
#    warnings: ["area under 1 ha: small changes invisible at 10 m"]}

scenes = earth.scenes(area, last="60d", kind="optical", max_cloud=30)   # kind: optical | radar | thermal
# → SceneList (dates, satellite, cloud over THE AREA not the whole tile, usable flag); .latest_clear(), .clear()

layer  = earth.load(area, scenes.latest_clear())     # Layer object: pixels stay server-side, returns an id
g      = earth.index(layer, "greenness")             # plain measure name → Layer
earth.measure(g)
# → {"mean": 0.41, "median": 0.43, "p10": 0.22, "p90": 0.55, "clean_px": 958, "cloud": 0.04, "provenance": {...}}

earth.series(area, "greenness", years=5, every="month")
# → points [{date, value, scene, clean_px}], band {month: {lo, hi, mean}}, provenance

earth.compare(area, "bare", before="2026-08-01", after="2026-09-30")
# → {before, after, delta, changed_ha, patches: [{ha, centroid, geojson}], provenance}

earth.surroundings(area, ring_m=300)                 # the area around the outline: local vs regional change
earth.change_date(series)                            # when the trend broke + confidence
earth.weather(area, last="14d")                      # rain_mm per day etc.; labelled NON-SATELLITE
earth.fires(area, last="30d", radius_km=10)          # FIRMS detections
earth.next_passes(area, days=10)                     # predicted passes + cloud odds (later)
earth.render(g)                                      # → {"layer_id": "L3", "url": "/api/layers/...png", "bounds": [...]}
earth.show.timeline(...), earth.show.then_now(...)   # build output blocks (B9)
```

**Rule:** every function returns **small** results (numbers, ids, short lists). Never arrays.

### B1.4 Plain-language measures (v1)

| Measure | Meaning (shown to users) | Formula / source | Sensor | Resolution |
|---|---|---|---|---|
| `greenness` | How much living vegetation | NDVI = (B8 − B4)/(B8 + B4) | Sentinel-2 | 10 m |
| `moisture` | Plant / soil water (drops before greenness) | NDMI = (B8 − B11)/(B8 + B11) | Sentinel-2 | 20 m |
| `water` | Open water | NDWI = (B3 − B8)/(B3 + B8) | Sentinel-2 | 10 m |
| `bare` | Bare soil or built surface | NDBI = (B11 − B8)/(B11 + B8) | Sentinel-2 | 20 m |
| `burn` | Burn scar | NBR = (B8 − B12)/(B8 + B12); dNBR > 0.1 low, > 0.27 moderate, > 0.66 high | Sentinel-2 | 20 m |
| `roughness` | Surface texture (sees through cloud) | Mean VV (and VH) backscatter in dB; > 3 dB change is material; same orbit direction only | Sentinel-1 RTC | 10 m |
| `heat` | Surface temperature (°C) | Landsat C2 L2 ST_B10 × 0.00341802 + 149.0 − 273.15 | Landsat 8/9 | 100 m (resampled 30 m) |
| `fire` | Active fire detections | FIRMS VIIRS NRT | Suomi NPP, NOAA-20/21 | 375 m |
| `rain` | Rainfall (mm) | Open-Meteo archive / forecast | weather model | ~10 km |
| `slope_deg`, `elevation_m` | Terrain | Copernicus DEM 30 m | DEM | 30 m |
| `land_cover` | What's there | ESA WorldCover 10 m | — | 10 m |

**Sentinel-2 details the implementer must know:**
- Bands: B2 blue, B3 green, B4 red, B8 NIR (10 m); B5–B7 red edge, B8A, B11 SWIR 1610, B12 SWIR 2190 (20 m); B1, B9, B10 (60 m, atmospheric only). 13 bands, not 12.
- Earth Search asset names: `blue`, `green`, `red`, `nir`, `swir16`, `swir22`, `scl`, `visual`.
- **Processing baseline offset:** scenes from **2022-01-25 onwards** have a +1000 offset on reflectance values. Subtract 1000 before computing indices. (The Friday prototype did this and its numbers matched.)
- **Cloud mask (SCL):** 0 no data, 1 saturated, 2 dark, 3 cloud shadow, 4 vegetation, 5 bare, 6 water, 7 unclassified, 8 cloud medium, 9 cloud high, 10 thin cirrus, 11 snow. **Mask 0, 1, 3, 8, 9, 10.**
- **Always compute cloud over the area, not the scene's cloud figure.** The Friday prototype hit a scene that was 6% cloudy overall but 24% over the island of interest.

### B1.5 Providers and routing

```python
class Provider(Protocol):
    id: str                        # "earth_search_s2"
    kinds: set[str]                # {"optical"}
    measures: set[str]             # {"greenness", "water", "bare", "moisture", "burn"}
    resolution_m: float
    revisit_days: float
    free: bool
    needs_key: bool
    async def search(self, area, start, end, **filters) -> list[Scene]: ...
    async def read(self, area, scene, bands, resolution_m) -> Array: ...
```

The router picks the provider for `(measure or kind, area, time)` and records **why** ("Sentinel-2: free, 10 m, 4 clear scenes in window"). Rejected options are recorded too ("Sentinel-1: not needed, sky clear"). These records feed the `route` block (B9).

**Reading strategy:**
1. **Discover:** STAC search returns metadata only. Cheap.
2. **Read:** windowed reads of only the area's pixels from Cloud-Optimised GeoTIFFs via HTTP range requests. **Never download whole scenes** (a Sentinel-2 tile is about 1 GB).
3. **Recommended:** `pystac-client` + `odc-stac` or `rasterio`. **Fallback:** titiler `.npy` endpoint (proven Friday; see B12). It's a public demo server, so expect rate limits.
4. Reproject to the area's UTM zone for maths, to WGS84 (lat/lon) for the frontend; compute hectares in an equal-area projection.

### B1.6 Budgets (enforced inside `earth`, per run)

| Budget | Hackathon value |
|---|---|
| earth calls per run | 30 |
| scenes per series | 60 (one clear scene per month for 5 years) |
| pixels per read | ~2.5 M (larger areas drop to coarser resolution automatically) |
| max area | 25 km² at 10 m, larger at coarser resolution |
| wall-clock per call | 20 s |

When a budget is exceeded, `earth` raises a `BudgetExceeded` error with a hint, never a silent truncation.

### B1.7 Errors with hints (these make the retry loop smart)

```text
NoClearScenes: 0 of 9 optical scenes clear over this area (cloud 70–100%).
  Try: kind="radar", or extend last="90d".
AreaTooSmall: 0.3 ha ≈ 30 pixels at 10 m. Changes under ~20 m are invisible.
  Try: report with low confidence, or enlarge the area.
BudgetExceeded: 61 scenes requested, max 60.
  Try: every="month" or years=4.
```

### B1.8 Provenance (attached to every result)

```json
{"provider": "earth_search_s2", "satellite": "Sentinel-2B", "scene": "S2B_49QHE_20260930_0_L2A",
 "date": "2026-09-30", "cloud_over_area": 0.04, "resolution_m": 10,
 "method": "NDVI, SCL mask [0,1,3,8,9,10], mean over 958 clean pixels"}
```

## B2. The sandbox

### B2.1 Shape

```
┌──────────── Sandbox container (untrusted) ───────────┐
│  script.py written by the agent                      │
│  import earth  ← earth/client.py: same functions,    │
│                  each call forwarded to the service  │
│  no internet · no keys · CPU/RAM/time limits         │
└──────────────────────────┬───────────────────────────┘
                           ▼ internal Docker network only
┌──────────── Earth service (trusted) ─────────────────┐
│  real earth · keys · budgets · cache · call log      │
└──────────────────────────────────────────────────────┘
```

Run command (indicative):

```bash
docker run --rm --network=earth-only --memory=1g --cpus=1 --read-only --pids-limit=128 \
  --tmpfs /tmp:size=64m -e RUN_ID=... earth-runner python /work/script.py
```

**Hackathon fallback (build step 4):** run the script in a **subprocess** with a timeout and the AST scan, before the Docker version (step 5) exists.

### B2.2 Code scan before running (AST, not string matching)

- Allowed imports: `earth`, `math`, `statistics`, `datetime`, `numpy` (only if needed), `json`.
- Rejected: `eval`, `exec`, `compile`, `open`, `__import__`, `getattr` on dunders, any `__dunder__` attribute access, `os`, `sys`, `subprocess`, `socket`, `requests`, `httpx`, `importlib`, `pickle`.
- Max script length: ~300 lines.

The scan is the first wall; the container is the second.

### B2.3 Script contract

The script must define `run(**params)` and return:

```python
{
  "findings":   {...},     # numbers used by scoring, keyed by measure/hypothesis
  "evidence":   [...],     # list of {measure, value, scene/date, provenance}
  "blocks":     [...],     # visual blocks built with earth.show.*
  "notes":      [...]      # optional plain notes ("radar not available here")
}
```

### B2.4 Run → check → fix loop

```
write code ──► run ──► CHECK ──ok──► result
     ▲                   │
     └── fix (max 3) ◄───┘ fail
```

**CHECK** = (1) did it crash? → trimmed traceback to the model; (2) is the output the right shape? → schema validation; (3) is it plausible? → enough clean pixels, values in valid ranges, ≥1 scene, budget not exceeded. After 3 failures: stop and say honestly what couldn't be done.

## B3. The agent pipeline

### B3.1 Model and API settings

- **Model:** `claude-opus-5-5` for **all** calls (team decision). Official `anthropic` Python SDK.
- **Thinking:** cannot be disabled on Opus 5.5; control depth with `output_config.effort`. Use `low` for guard and explain, `medium` for think. (Opus 5.5 defaults to `medium`, so set it explicitly.)
- **Forced tool choice (`tool_choice: any/tool`) is rejected on Opus 5.5.** Use **structured outputs** (`output_config.format` / `client.messages.parse()`) for stage outputs, and `strict: true` on any tool definitions.
- **Refusals:** check `stop_reason == "refusal"` before reading content. Enable the server-side fallback (`betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`). Show a model refusal as a policy `limits` block, never a crash.
- **Prompt caching:** request order = tools → system rules → policy summary → card index → earth API reference (all stable, cached), then per-request content. Never put timestamps or ids in the cached part. Verify with `usage.cache_read_input_tokens`.
- **No assistant prefill** (rejected on this model family).

> Implementers: load the Claude API skill or the official docs before writing SDK code; API shapes changed in 2025–26.

### B3.2 The three calls

> **Superseded (Sun 4 Oct).** The three-call pipeline below was replaced by the guard plus tool-use loop (ARCHITECTURE §4.0). For the calls, `max_tokens`, effort and retry rules in force now, see [AGENT.md](AGENT.md) (sections 3, 4 and 6). This section is kept for history.

| Call | Input | Structured output | max_tokens | effort |
|---|---|---|---|---|
| **A. Guard** | question, place facts, policy rule summaries | `{scope, rule_id, reason, clarify?: [≤2 questions]}`. `rule_id` must exist in `rules.yaml` | 300 | low |
| **B. Think** | cached prefix + place facts + fetched cards + question (+ previous-turn summary) | `{hypotheses[], cards_used[], expectation_table, feasibility, plan[], skill_id?, params?, code?}` | 8 000 | medium |
| **C. Explain** | cached prefix + results summary + scored expectation table | `{sentence, how_sure, todo, caveats[], followups[3], primary_block}` | 1 500 | low |

Retries: code fix ×3 (each a small call with the trimmed traceback), API error ×1. **Max 6 LLM calls per run.** Then a template answer.

### B3.3 Expectation table (central structured artifact)

Written in stage 4, **before any data**. Filled with observed values by **code** in stage 9.

| Hypothesis (card) | greenness | bare | slope | rain (14 d) | roughness | verdict |
|---|---|---|---|---|---|---|
| landslide | ↓↓ > 0.15, sudden | ↑ > 0.10 | > 25° | > 100 mm | ↑ | ✅ supported |
| construction | ↓ gradual | ↑ | any | any | ↑ (straight edges) | ❌ change was sudden |
| fire | ↓↓ | ~ | any | any | changed | ❌ no burn signal, no FIRMS |
| seasonal | inside band | inside band | any | any | – | ❌ outside normal band |
| **observed** | −0.31 on 12 Sep | +0.18 | 34° | 312 mm | n/a | |

The same table is what users see as **"What else could it be"** (`hypotheses` block).

### B3.4 Scoring and confidence (code, not LLM)

- Each sign has a `weight` on the card. Score = sum of the weights of matched signs; unknown evidence counts 40% of its weight; contradicted signs subtract.
- A verdict is only asserted if the top score ≥ the card's threshold **and** look-alikes are ruled out by their `tell_apart_by` evidence.
- **Top two within 15%** → "can't tell between A and B; what would settle it: X" (from the card).
- **Confidence level** = card rule (high/medium/low) **capped by card status** (draft → low, tested → medium) and downgraded by data quality: clean pixels < 50, area < ~1 ha, single scene, satellites disagreeing.

### B3.5 Answer validation (before display)

- **Numbers:** regex every number in the sentence and caveats; each must appear in the results (with sensible rounding). Otherwise use the template sentence for the primary block.
- **Wording:** no blame phrasing ("was done by", "illegally" as an assertion), no person names, no links except ours, nothing that looks like a key or system prompt.
- **Causes:** only card ids present in `cards_used`.

### B3.6 Follow-up questions (proposal)

Keep a **board summary** (~1K tokens) per conversation: area, layers available, last verdict, cards and versions used, and the last expectation table. "Since when?", "is that normal?" and "show last month" reuse workspace layers. Direct manipulation (dragging dates, scrubbing the timeline) **re-runs the script with new parameters without the LLM** and uses a template caption.

## B4. Knowledge base

### B4.1 Card types

| Type | Answers | v1 seed | Later |
|---|---|---|---|
| **event** | What does this event look like from space? | `seasonal` (always a hypothesis), `landslide`, `pond_filling`, `construction` | `flood`, `fire`, `clearing`, `drought`, `harvest`, `reclamation`, `algae_bloom` |
| **setting** | What's normal for this kind of place? | `steep_hillside`, `wetland_ponds` | `cropland`, `urban`, `forest`, `coast_water` |
| **measure** | What does this number mean and when does it lie? | Generated from `earth/measures.py` docs | — |
| **source** | What can this satellite/dataset see? | Sentinel-2, Sentinel-1, Landsat, FIRMS, Open-Meteo, DEM, WorldCover (short) | paid sources (route option only, never bought) |
| **method** | How to measure correctly | `before_after`, `seasonal_baseline`, `surroundings_compare`, `change_date`, `cloud_mask` | — |
| **skill** | Tested procedure (code) | `slope-check`, `pond-filling-check` | saved runs |

### B4.2 Folder layout

```
backend/knowledge/
  index.yaml                 # GENERATED at startup: id, type, name, one line, status, version
  events/landslide.md
  events/seasonal.md
  events/pond_filling.md
  events/construction.md
  settings/steep_hillside.md
  settings/wetland_ponds.md
  measures/*.md
  sources/*.md
  methods/*.md
  drafts/                    # agent-proposed, never trusted (server-side; not committed unless promoted)
  policy/rules.yaml
  policy/templates.yaml
  policy/tests.yaml
backend/skills/
  slope-check/{SKILL.md, run.py, tests.yaml}
  pond-filling-check/{SKILL.md, run.py, tests.yaml}
```

### B4.3 Links between cards

| Link | From → To | Used for |
|---|---|---|
| `shows_as` | event → measure (direction, threshold, timing, weight) | what to measure |
| `looks_like` | event ↔ event (+ `tell_apart_by`) | auto-adding alternatives |
| `occurs_in` | event → setting | which hypotheses make sense here |
| `triggered_by` | event → event/measure | rain → landslide/flood; typhoon → several |
| `provided_by` | measure → source | routing |
| `tests` | skill → event | reusing the matching skill |

**Validation at startup and in CI:** every link must resolve; every sign must name a measure `earth` has. Broken links fail.

### B4.4 Full example: event card

```markdown
---
id: landslide
type: event
version: 1
status: draft            # set by the SERVER, never by a proposal
name: Landslide
aliases: [mudslide, slope failure, rockslide, 山泥傾瀉]
summary: Soil and rock sliding down a slope, usually after heavy rain.
min_size_m: 20
occurs_in: [steep_hillside]
triggered_by:
  - {event: heavy_rain, within_days: 7, rain_mm_gt: 100}
signs:
  - {measure: greenness, change: down, by_more_than: 0.15, shape: strip_or_fan, timing: sudden, weight: 3}
  - {measure: bare,      change: up,   by_more_than: 0.10, weight: 3}
  - {measure: slope_deg, greater_than: 25, weight: 2}
  - {measure: rain,      sum_days: 14, greater_than: 100, weight: 1}
  - {measure: roughness, change: up, weight: 1, optional: true}
looks_like:
  - {event: construction, tell_apart_by: "straight edges, gradual over weeks, near roads"}
  - {event: fire,         tell_apart_by: "burn signal and FIRMS detections nearby"}
  - {event: seasonal,     tell_apart_by: "inside the normal seasonal band, whole hillside"}
cannot_tell:
  - slides smaller than about 20 m
  - slides under dense tree canopy
  - whether the slope is still moving (needs radar interferometry, not in v1)
confidence:
  high: "matched weight >= 8 and all look-alikes ruled out"
  medium: "matched weight >= 6"
  low: "otherwise"
suggested_blocks: [then_now, highlight, timeline]
cases:
  - {place: "TBD Hong Kong slope", geometry: "...", date: "2023-09-08", expected: detected,
     source: "CEDD/GEO landslide report (cite exact document)"}
controls:
  - {place: "TBD stable slope nearby", date: "2023-09-08", expected: not_detected}
---

## What it is
Soil, rock and vegetation sliding down a slope, most often after intense rain...

## How it shows up from space
A strip or fan of lost vegetation and new bare ground, appearing between two passes...

## How to tell it apart
Construction is gradual with straight edges; fire leaves a burn signal...

## Sources
- (cite)
```

**Rule:** every sign must be measurable by `earth`. Anything unmeasurable goes under `cannot_tell`.

### B4.5 Example: setting card (header only)

```yaml
id: steep_hillside
type: setting
detect: {slope_deg_mean_gt: 20, land_cover_any: [trees, shrubland, grassland]}
normal:
  greenness: "evergreen in Hong Kong; small wet-season rise (May–Sep)"
  bare: "stable; new bare ground is unusual"
likely_events: [landslide, fire, construction, seasonal]
```

### B4.6 How the agent gets knowledge (progressive disclosure)

1. The **index** (id + one line per card, ~30–50 tokens each) is always in the cached prompt.
2. The agent **asks** for full cards (`knowledge.get(id)` in the think call, or listed in its structured output for the next step). Every read is logged and shown under "Method".
3. **Code attaches automatically**: the setting card that matches `earth.describe`, the `looks_like` cards of every hypothesis, and `seasonal`.
4. The token budget for cards per question is about 5–8K.

## B5. Skills

### B5.1 Folder

```
backend/skills/slope-check/
  SKILL.md      # YAML header + human explanation
  run.py        # def run(area, recent_days=60, rain_days=14) -> result (B2.3)
  tests.yaml    # cases (or references to the linked cards' cases) + expected outputs
```

### B5.2 `SKILL.md` example

```markdown
---
id: slope-check
version: 1
status: draft
tests_events: [landslide]
considers: [construction, fire, seasonal]
params:
  area:        {type: area, max_km2: 5}
  recent_days: {type: int, default: 60, min: 14, max: 365}
  rain_days:   {type: int, default: 14}
needs: [optical, elevation, rain]
outputs: [then_now, timeline, hypotheses, stat]
---

## What it does
Checks one slope for signs of a recent landslide…

## When to use it
"Did a landslide happen here", "is this slope OK after the rain"…

## Limits
Copied from the landslide card's `cannot_tell`…
```

### B5.3 Saving a run as a skill

1. The user likes a result and clicks "Save as skill".
2. The LLM generalises the script: the area, dates and thresholds become `params` with defaults. It writes the name, description and limits.
3. The original run becomes the first test (fixture).
4. The proposal goes through `propose_change` (B6), starting as a **draft**. The user can edit it in the Skill Builder page.

Skills can't call other skills in v1 (roadmap).

## B6. Knowledge growth, verification and change control

### B6.1 Status ladder

```
draft ──(automatic: lint + backtest on HIDDEN cases + controls)──► tested ──(human review)──► reviewed
```

| Status | Max confidence | How you get there |
|---|---|---|
| draft | low ("unverified knowledge" label) | Agent or team proposal passes lint |
| tested | medium | Backtest: ≥ 80% detection, ≤ 20% false alarms, ≥ 3 cases + 3 controls, on held-out cases |
| reviewed | high | A human other than the author approves |

### B6.2 Change control

- **The agent never writes knowledge.** It has one tool: `propose_change(target, diff, reason)`.
- **Server-set fields** (`status`, `version`, confidence caps, promotion results) in a proposal are **rejected**.
- **The hidden holdout:** the system picks the test cases; the agent never sees them (prevents overfitting).
- **Thresholds** move at most ±20% per version.
- **Versions are immutable.** Every answer records the card and skill versions it used. Any card or skill can be disabled instantly (kill switch).
- **Protected (humans only, 2 reviewers = both backend owners):** `policy/*`, confidence caps, promotion thresholds, schemas, measure definitions in `earth`.

| Change | Burden | Approval |
|---|---|---|
| Add a case | Cited source (or user confirmation, always spot-checked) | Spot-check |
| New draft | Lint, measurable signs, links resolve, no instruction-like text | None (it's a draft) |
| Draft → tested | Hidden backtest passes | Automatic |
| Edit tested card | New version no worse than old on hidden cases + linked items re-tested | 1 human |
| Edit reviewed card | Same + ≥ 5 cases and 5 controls | 1 human |
| Change links | Regression on every touched card | 1 human |
| Skill code | AST scan + tests + same outputs on fixtures | 1 human for official skills |
| Protected files | Red-team + regression tests pass | 2 humans |

### B6.3 Hackathon build vs roadmap

- **Build now:** `propose_change` writes to `drafts/`, server-set fields, lint + content scan, hidden-split backtest (with the seed cases), version pinning on answers.
- **Roadmap slide:**
  - bot-opened GitHub PRs for promotions
  - shadow mode for reviewed edits
  - automatic case-finding from catalogues (NASA Global Landslide Catalog, Copernicus EMS, FIRMS, Global Forest Watch, HK government reports)
  - nightly regression
  - quotas and cooldowns
  - community submissions

## B7. Policy and refusals

### B7.1 Files

```
backend/knowledge/policy/
  rules.yaml       # every "no", structured (pure YAML: it's a list of rules)
  templates.yaml   # fixed reply per rule (later: per language)
  tests.yaml       # red-team questions + expected decision; runs in CI
```

### B7.2 Rule schema and example

```yaml
- id: identify_person
  kind: not_allowed        # not_allowed | out_of_scope | feasibility | uncertain | emergency | off_topic | abuse
  action: block            # block | partial | redirect | ask
  description: Identifying, locating or following a specific person.
  examples:
    - "Where does John Chan park his car every day?"
    - "Is my ex at home right now?"
  not_examples:            # look similar but are fine (stops over-blocking)
    - "How many cars park in this lot on weekdays?"
    - "Has this building been extended since 2020?"
  checks:
    - output_must_not_contain: person_names
  reply: tpl_identify_person
  alternatives: false      # block rules never offer workarounds
  log: true
  version: 1
```

### B7.3 v1 rule set

| id | kind | action | Covers |
|---|---|---|---|
| `identify_person` | not_allowed | block | Identifying, locating or following people |
| `surveil_private_home` | not_allowed | block | Monitoring a specific home or person's property |
| `military_targeting` | not_allowed | block | Military sites, weapons, targeting, troop movements. **Code check:** block any area overlapping OSM `landuse=military` |
| `harassment` | not_allowed | block | Using results to threaten or expose someone |
| `ownership_or_blame` | out_of_scope | redirect | Who owns it, who did it |
| `below_resolution` | feasibility | partial | Smaller than ~20 m |
| `no_clear_data` | feasibility | partial | Clouds / no scenes → radar or the next pass |
| `area_too_large` | feasibility | ask | Over the area budget |
| `cannot_distinguish` | uncertain | partial | Top causes too close |
| `emergency_now` | emergency | redirect | Someone in danger now → **999** / emergency services; satellite data is days old |
| `off_topic` | off_topic | redirect | Not about a place or satellites |
| `prompt_injection` | abuse | block | Attempts to override rules |
| `sensitive_allegation` | out_of_scope | partial | Dumping or filling: allowed, but only "consistent with" wording, never names |

### B7.4 Enforcement points

```
0. CODE GATES   cooldown · spend cap · area valid · military overlap · clean place names
1. GUARD        LLM → {scope, rule_id} from rules.yaml (structured). Code applies the rule's action.
5. CHECK FIT    code feasibility → partial + alternatives
8. SANDBOX      hard limits regardless of the LLM
11. EXPLAIN     wording / numbers / names check; weak evidence → forced "can't tell"
+ model refusals (stop_reason "refusal") → shown as a not_allowed limits block
```

When unsure on a `block` rule: **block**, politely. When unsure on a `partial` rule: ask.

### B7.5 What a "no" returns: the `limits` block

1. What it can't tell, and why (one line)
2. What it **can** do instead, as actions: run radar, wait for the next pass, enlarge the area, ask an expert (not for block rules)
3. Who to go to, when relevant (emergency services, Planning Department, a surveyor)

Refusals are logged with the rule id (30 days, personal details stripped). Frequent "no card / out of scope" refusals are candidates for new cards.

### B7.6 Frontend role

UX only: warnings before sending (area too small or too large, no place selected for a place question), and rendering the `limits` block. **Never the gate.** The API is enforced server-side.

## B8. Prompt injection defences

Untrusted text sources: the user's question; place names and OSM tags; uploaded files; community and draft cards and skills; saved skill code; chat history.

| # | Layer | Implementation |
|---|---|---|
| 1 | Nothing to steal | No API keys in the LLM context or sandbox; sandbox has no internet; earth service holds keys and budgets |
| 2 | Data ≠ instructions | Untrusted text only inside labelled data fields (JSON), never in the system prompt; place names length-capped and cleaned of markup and control characters |
| 3 | Structured outputs | Every decision is a value from a fixed list; free text can't trigger actions |
| 4 | Separate guard | The guard call sees only the question, policy and place facts, never tool outputs or community content |
| 5 | Code scan | AST allow-list before the sandbox (B2.2) |
| 6 | Knowledge supply chain | Only `reviewed` content is trusted guidance; drafts and community content are data, scanned for instruction-like text, and can never change policy, caps or status |
| 7 | Output check | Numbers exist in results; no names; no blame; no foreign links; nothing resembling keys or prompts |
| 8 | Watch + test | Flagged attempts logged; injection attacks in `policy/tests.yaml` run in CI |

## B9. Output blocks (visuals)

### B9.1 Principle

The backend sends **descriptions** of visuals (typed spec + data or references); the frontend draws them. That gives a consistent look, linked interactivity, and the same blocks render server-side to PNG/PDF.

### B9.2 Catalogue

| Block | Shows | Demo v1? |
|---|---|---|
| `then_now` | Two dated images, slider, change shaded | ✅ |
| `timeline` | Measure over time + normal seasonal band + change marked; each point = a pass | ✅ |
| `scene_strip` | Every pass: satellite, date, clear/cloudy; scrubbing it updates the map | ✅ |
| `highlight` | Outlined patches with size | ✅ |
| `hypotheses` | Expectation table / ranked causes with each piece of evidence | ✅ |
| `stat` | One big number with range ("3.1 ha ± 0.3") | ✅ |
| `limits` | The refusal / "can't tell" block (B7.5) | ✅ |
| `map_layer` | A measure over the map, plain legend | later |
| `timelapse` | Animated frames | later |
| `compare` | Small multiples / bars across places, years, seasons | later |
| `evidence_flow` | Small diagram: which satellite fed which conclusion | later |
| `route` | Satellites used / skipped and why | later (data already in provenance) |
| `next_passes` | Next passes + cloud odds | later |
| `table` | Rows of numbers | later |
| `chart` (escape hatch, Vega-Lite subset) | Anything else | **not for the hackathon** |

At most ~6 blocks per answer; one is marked `primary`.

### B9.3 Block schema (example)

```json
{
  "type": "timeline",
  "id": "b2",
  "primary": false,
  "title": "Greenness on this slope",
  "caption": "Dropped sharply on 12 Sep, outside the usual range",
  "data": [{"date": "2026-09-12", "value": 0.21, "scene": "S2B_49QHE_20260912_0_L2A", "clean_px": 940}],
  "band": [{"month": 9, "lo": 0.48, "hi": 0.62}],
  "marks": [{"date": "2026-09-12", "label": "change"}],
  "links": {"time": "cursor"},
  "provenance": {"provider": "earth_search_s2", "method": "NDVI, SCL-masked, monthly"}
}
```

Captions follow the same number rule as answers.

### B9.4 Linking

The frontend keeps shared state: `time cursor` (selected scene/date), `selection` (area/patch), `measure`. Blocks declare what they read and write: timeline, scene_strip and timelapse **write** the time cursor; map_layer and then_now **follow** it; highlight and compare **set** the selection. Every data point carries a **scene id**. Map images come by reference, `GET /api/layers/{run_id}/{measure}/{scene}.png`, rendered on demand and cached.

### B9.5 Where the look comes from

**Measure cards** own colour ramp, legend words ("greener", "wetter") and valid range. **Event cards** suggest blocks (`suggested_blocks`). **Skills** declare `outputs`.

### B9.6 Proof link (proposal)

`GET /api/runs/{id}` + a frontend route `/proof/{id}`, with an unguessable id and no account. It shows the answer, blocks, provenance, cards and skills with versions, and the code. The same blocks render server-side to a PDF.

## B10. API contract (draft; finalise in build step 1)

Follow `COLLABORATION.md` §6: Pydantic schemas are the source of truth; run `uv run python -m app.export_openapi` and commit `contracts/openapi.json` in the same PR.

### B10.1 Endpoints

| Method | Path | Body → Response |
|---|---|---|
| POST | `/api/areas/resolve` | `{query? , point?, polygon?, link?}` → `Area` |
| POST | `/api/areas/context` | `Area` → `PlaceContext` (B1.3 `describe` output + suggested questions) |
| POST | `/api/runs` | `RunRequest` → **`text/event-stream`** (B10.2) |
| POST | `/api/runs/{id}/reply` | `{answers: {...}}` → continues a run waiting for clarification |
| GET | `/api/runs/{id}` | → `Run` (final answer, blocks, steps, provenance, versions) |
| GET | `/api/layers/{run_id}/{measure}/{scene}.png` | → PNG (bounds in the block) |
| GET | `/api/skills`, `/api/skills/{id}` | → skill library (matches `frontend/src/data/catalog.ts`) |
| GET | `/api/knowledge/index` | → card index (for a "Method" view) |
| CRUD | `/api/places` | saved places |
| CRUD | `/api/watches`, POST `/api/watches/{id}/check` | watches (stub: "check now" + message preview) |
| GET | `/api/health` | exists |

### B10.2 Stream events (`POST /api/runs`)

| Event | Payload |
|---|---|
| `run_started` | `{run_id}` |
| `guard` | `{scope, rule_id?}` |
| `clarification_needed` | `{questions: [{key, label, options[]}]}` (matches `CLAR` in `agent.ts`) |
| `plan` | `{hypotheses[], cards_used[], steps: [{title, desc}]}` |
| `step_started` / `step_finished` | `{index, title, desc, tool, result?}`: **the frontend's `Step` shape** |
| `block_ready` | a block (B9.3) |
| `answer` | `Answer` (B10.3) |
| `error` | `{message, recoverable}` |
| `done` | `{run_id, tokens, cost_usd, ms}` |

Use `fetch` + a stream reader on the frontend (EventSource can't POST).

### B10.3 `Answer` (mirrors `frontend/src/data/agent.ts` `Answer`)

```text
Answer {
  sentence: str
  confidence: {level: High|Medium|Low, pct: int, note: str}
  todo: str                       # what to do / next usable look
  stats: [{l, v, ci?}]
  caveats: [str]
  route: [{sat, status: chosen|support|skipped|fallback, why}]
  proof: [{id, date, sat, cloud, used, why?}]
  blocks: [Block]
  followups: [str, str, str]
  method: {cards: [{id, version, status}], skill?: {id, version}, code_ref: str}
}
```

### B10.4 Watches (stub for the hackathon)

Watch = skill + place + schedule + condition + channels. v1: `POST /api/watches/{id}/check` runs the skill now and returns the message preview ("one line per outline, before/after attached on change"). The real scheduler is roadmap.

## B11. Tokens, limits, speed

### B11.1 Expected cost per answer (Opus 5.5: $4/M input, $0.20/M cached input, $20/M output)

| | Input | Output | Cost |
|---|---|---|---|
| New question (guard + think + explain) | ~20K (≈ half cached) | ~4–6K (thinking counts as output) | **≈ $0.10–0.20** |
| Matched skill (no code generation) | similar prefix | ~1–2K | **≈ $0.03–0.06** |

Output dominates. Levers: reuse skills, keep effort low/medium, cache the prefix, keep follow-up context to a ~1K summary.

### B11.2 Hackathon limits (simple, team decision)

> **Superseded (Sun 4 Oct).** These limits predate the agent loop. The current values, with the costs and times measured live, are in [AGENT.md](AGENT.md) (sections 6, 7 and 13). This section is kept for history. In short:
>
> - turns: 12 per run;
> - code or skill runs: 6;
> - wall clock: 150 s;
> - `max_tokens`: 16,000 per turn, 4,000 for the guard;
> - cooldown: 3 s per user, and at most 3 runs at once;
> - spend cap: $20 per UTC day.

| Limit | Value |
|---|---|
| `max_tokens` per call | guard 300 · think 8 000 · explain 1 500 |
| LLM calls per run | max 6 |
| Retries | code fix ×3 · API error ×1 · then template answer |
| Cooldown | a few seconds between runs per user/IP |
| Daily spend cap | e.g. $20 → **presets-only mode** when hit |
| earth budgets | B1.6 |
| Run wall-clock | 90 s → partial answer with completed steps |

No queues or backoff machinery for the hackathon.

### B11.3 Speed targets and tactics

Targets: first step < 2 s · first visual < 10 s · full answer < 30 s (skill) / < 60 s (new question).

1. **Stream** every step.
2. **Prefetch:** on request arrival, start `earth.describe` + scene search in parallel with the guard and think calls.
3. **Parallel reads:** 8 at a time.
4. **Coarse first:** history at one clear scene a month and 20–30 m; only the latest before/after pair at 10 m.
5. **Caches:** satellite reads; results keyed by (skill, params, card versions); precomputed baselines for demo areas.
6. **No LLM for direct manipulation** (template captions).
7. **Presets fully cached** (works offline).

**Log per run from day one:** time per stage, tokens per call, cache hits (prompt and data), earth reads.

## B12. Data sources and the demo preset

### B12.1 Endpoints known to work (verified in Friday's prototype, from a browser)

| Purpose | Endpoint |
|---|---|
| Sentinel-2 search | `POST https://earth-search.aws.element84.com/v1/search` with `collections: ["sentinel-2-l2a"]`, `bbox`, `datetime`, `query: {"eo:cloud_cover": {"lt": N}}` |
| Sentinel-2 item | `https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items/{id}` |
| Pixel arrays (fallback reader) | `https://titiler.xyz/stac/bbox/{w},{s},{e},{n}/{W}x{H}.npy?url={item_url}&assets=green&assets=red&assets=nir&assets=swir16&assets=scl` (one request returns several bands; load with `np.load`) |
| True-colour tiles | `https://titiler.xyz/stac/tiles/WebMercatorQuad/{z}/{x}/{y}.png?url={item_url}&assets=visual` |
| Sentinel-1 RTC / Landsat | Planetary Computer STAC `https://planetarycomputer.microsoft.com/api/stac/v1/search`; data API `.../api/data/v1/item/bbox/{bbox}/{W}x{H}.npy?collection=sentinel-1-rtc&item={id}&assets=vv` (Landsat: `collection=landsat-c2-l2`, `assets=lwir11&assets=qa_pixel`) |
| Fire | `https://firms.modaps.eosdis.nasa.gov/api/area/csv/{MAP_KEY}/VIIRS_SNPP_NRT/{w},{s},{e},{n}/{days}` (key server-side only) |
| Weather / cloud forecast | `https://api.open-meteo.com/v1/forecast?latitude=..&longitude=..&hourly=cloud_cover&forecast_days=14` (archive API for past rain) |
| Place names | `https://nominatim.openstreetmap.org/search` / `/reverse` (respect the usage policy; add a User-Agent; cache) |
| Satellite orbits (later) | CelesTrak `gp.php?GROUP=resource&FORMAT=tle` (keep a snapshot fallback) |

### B12.2 Demo preset: Hoo Hok Wai fish ponds (Hong Kong wetland, NGO story)

- **Context:** the Conservancy Association and Greenpeace reported 78.7 ha of wetland destroyed in conservation areas between July 2021 and December 2023. Hoo Hok Wai damage roughly doubled (≈17.6 ha in 2021 → 36.9 ha in 2023). Sources: HKFP 18 Jan 2024; SCMP Young Post.
- **Sentinel-2 tile:** `49QHE`. Scene ids look like `S2B_49QHE_20260930_0_L2A`.
- **What Friday's prototype measured** (outline ≈ 958 clean pixels; "ring" = the surroundings):
  - **Greenness inside:** ≈ 0.40–0.48 through 2022–2024 → falls through 2025–2026 → **0.063 (25 Sep 2026)**, **−0.013 (30 Sep 2026)**.
  - **Greenness of the surroundings:** stays ≈ 0.50–0.60. **The change is local**, not regional.
  - **Bare inside:** ≈ −0.30 to −0.40 (2022–2024) → ≈ 0.0 to +0.12 (2026).
  - **Radar VV inside:** ≈ −8.5 dB (early 2026) → **−10.71 dB (28 Sep 2026)**; surroundings ≈ −7.0 to −7.6 dB.
  - **Surface heat:** in 2026 the inside often reads warmer than the surroundings (e.g. 16 Apr 2026: 40.0 °C vs 34.4 °C).
- These numbers must be **recomputed by the new `earth` code**. They are the acceptance test for build step 2 (same trend; exact values may differ slightly).

### B12.3 Second preset (TBD)

A Hong Kong landslide with documented date and location, e.g. from the Sept 2023 record rainstorm (HKO recorded 158.1 mm in one hour on 7–8 Sep 2023). Pick one with clean Sentinel-2 scenes before and after; cite the GEO/CEDD report.

## B13. Mapping to the existing frontend mocks

| Frontend (mock today) | Backend equivalent |
|---|---|
| `frontend/src/data/catalog.ts` `MODULES` (`area.mark`, `time.window`, `sat.route`, `scenes.filter`, `scenes.clean`, `index.compute`, `detect.anomaly`, `detect.change`, `explain.cause`, `output.map`, `output.watch`) | Step titles in the stream; skills' steps should use these ids where they fit |
| `catalog.ts` `SATS`, `CATS`, `Skill` | `/api/skills`; source cards |
| `agent.ts` `Step {title, desc, tool, result}` | `step_started` / `step_finished` events |
| `agent.ts` `Answer`, `RouteOption`, `ProofScene`, `Stat` | `Answer` (B10.3) |
| `agent.ts` `CLAR` | `clarification_needed` |
| `agent.ts` `checkFeasibility` | guard + check-fit stages; `limits` block |
| `watches.ts` `Watch` | `/api/watches` (stub) |
| `places.ts` `Place` | `/api/places`; `Area` |

Frontend calls go only through `frontend/src/api/` with types matching `contracts/openapi.json` (`COLLABORATION.md` §10).

## B14. Glossary

| Term | Meaning |
|---|---|
| **earth** | Our satellite library (B1) |
| **Earth service** | The trusted process running `earth` for the sandbox |
| **Sandbox** | Docker container running agent-written code with no internet |
| **Card** | A knowledge file: event, setting, measure, source or method |
| **Skill** | A tested procedure: `SKILL.md` + `run.py` + `tests.yaml` |
| **Expectation table** | Hypotheses × measures, expected values written before data, observed values filled in by code |
| **Look-alike** | An event that produces similar signs (`looks_like` link) |
| **Case / control** | A documented real event (should be detected) / a place where nothing happened (shouldn't be) |
| **Block** | A typed visual description sent to the frontend |
| **Provenance** | Satellite, scene, date, cloud, resolution, method attached to every result |
| **Guard** | The policy-check LLM call |
| **Limits block** | The structured "can't / won't" answer |
| **Preset** | A fully cached demo place and answer |

## B15. Context and sources

- **Event rules:** `HacKU 2026 Official Participant Handbook` (Drive, Participant Pack). Code freeze **Sun 4 Oct 13:00 HKT**. Deliverables: public repo, live demo link, 3-minute video. All code written during the 48 hours (open-source libraries credited). AI assistants allowed, but **the team must explain the core logic and architecture** (this document helps). Deep Tech exhibition Sun 14:40–15:40; top 8 pitch 16:20 in LE1.
- **Problem statement:** Deep Tech, "The Capability That Hasn't Travelled" (Drive: `HacKU 2026 — Problem Statements`).
  - Capability: expert satellite analysis.
  - Barrier: user expertise.
  - Evidence required: compare with the manual method (steps, time); state cost, what it gets wrong, what leaves the device.
- **Judging (exhibition, 30 marks):** problem and user needs · solution and human-centred design · technical implementation · prototype and demo · innovation · practicality and impact.
- **Team docs (Drive folder "HackU October 2026"):**
  - "ChatGPT for satellite data": use cases, segments, feature ideas
  - "Defining Features and Layout": team UI feedback
  - "Satellite Platform: Customer, Market and Competition Research": market, competitors, risks
  - "overhead-design-brief.md" + Overhead prototype code: Friday exploration, reference only
- **Competitors to name before judges do:**
  - Planet Queryable Earth (chat beta)
  - Google Earth with Gemini (paid, US-first, outputs non-authoritative)
  - WRI Global Nature Watch (free, nature only)
  - Google Earth Engine (code)
  - Copernicus Browser / EO Browser (expert viewers)
  - EOS Data Analytics, OneSoil, Farmonaut (single vertical)
  - **Our line:** chat isn't the product. Proof on every answer, structured reasoning from verified knowledge, honest limits, general purpose, free data first.

---

*End of handoff. Questions → Alex (@Alex-bot16). If you change a decision in A6, update this file in the same PR.*
