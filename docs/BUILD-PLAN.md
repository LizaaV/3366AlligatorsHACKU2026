# Backend build plan · Meet + Alex

**The shared plan for building the backend before the freeze.** Who builds what, the interfaces between our modules, the order, and the rules for coding agents.

| | |
| --- | --- |
| Code freeze | **Sun 4 Oct 2026, 13:00 HKT** (plan written Sat 19:30) |
| Design (what to build) | [`docs/HANDOFF-BACKEND.md`](HANDOFF-BACKEND.md) Part B = detailed spec · [`backend/ARCHITECTURE.md`](../backend/ARCHITECTURE.md) = merged decisions (agent loop §4.0, memory, dashboards, share/PDF) |
| This file | How we build it: ownership, interfaces, timeline, agent rules |
| Changing an interface | Both agree in chat → update §4 here + the contract test, in the same PR |

---

## 0. The product bar (most important)

**At the freeze, a real user can pick any place on Earth, ask a question, and get an answer built from real satellite data.** Not every feature, but this workflow, end to end, anywhere:

```text
search / draw / drop a pin anywhere  →  ask a plain question  →  (clarification card)
→ real scenes found and read  →  real measurements  →  plain answer + evidence + confidence + limits + visuals
```

What this means for the build:

1. **Presets are a fallback, not the product.** The Hoo Hok Wai preset is cached only for the offline video. Every acceptance test also runs on places we did not prepare (§8).
2. **`earth` must work globally**: any UTM zone, both hemispheres, areas crossing tile edges (mosaic same-day items), tropics with frequent cloud (radar fallback), tiny and large areas (resolution and budget handling).
3. **There is always an honest answer.** When no event card matches, the agent still answers what it *measured* ("greenness dropped 40% since March, local not regional; cause unknown") instead of refusing. Knowledge decides *causes*; measurements are always reportable.
4. **Tier 1 (the workflow) is built before Tier 2 (dashboards, PDF, share, threads).** Tier 2 is cut first.

## 1. How we work

1. **Split** modules and file ownership (§2, §3). No two people or agents edit the same file.
2. **Interfaces as code** (§4): Pydantic types + real function signatures + a **stub** that returns Hoo Hok Wai preset data + a **contract test**. Merged before any real implementation.
3. **Stubbed end to end:** the demo question runs through every stub to the frontend. From then on, `main` always works.
4. **Agents build** one module each against its acceptance test (§6), in its own branch and worktree. Each merge swaps one stub for the real module.
5. **Harden:** run the demo script (§8) over and over, cut what isn't green (§7), deploy, record.

## 2. Modules and owners

**Tier 1** = the §0 workflow, must work anywhere. **Tier 2** = valuable extras, built after Tier 1 is green.

### Meet: `earth`, sandbox, memory, outputs

| ID | Module | Files | Needs | Est. | Done when (acceptance test) |
| --- | --- | --- | --- | --- | --- |
| M1 | **Tier 1 · earth · read**: `Area`, STAC search (Earth Search S2), windowed COG reads, S2 offset −1000 (≥ 2022-01-25), SCL mask [0,1,3,8,9,10], cloud **over the area**, disk cache | `backend/earth/area.py`, `providers/`, `cache.py` | — | 2.5 h | Clean pixels + cloud-over-area for every place in the world test set (§8.2), including one crossing a tile edge and one in the southern hemisphere |
| M2 | **Tier 1 · earth · analysis**: `describe`, `scenes`, `load`, `index` (greenness, moisture, water, bare), `measure`, `series`, `compare`, `surroundings`; budgets; errors with hints; provenance | `backend/earth/__init__.py`, `measures.py`, `budget.py`, `errors.py` | M1 | 2.5 h | Preset reproduces HANDOFF B12.2 **and** `series` / `compare` return sensible values for every world-test-set place within the B11.3 time targets (coarse first, parallel reads) |
| M3 | **Tier 1 · earth · output**: `render` (PNG + bounds), `earth.show.*` block builders | `backend/earth/render.py`, `show.py`, `blocks.py` | M2 | 1 h | `then_now`, `timeline`, `stat`, `highlight` blocks for the preset validate against the block schema |
| M4 | **Tier 1 · Sandbox runner**: AST scan + subprocess + timeout (step 1); Docker + earth service + thin client (step 2) | `app/services/sandbox.py`, `backend/earth/client.py`, `sandbox/Dockerfile` | M2 interface | 1.5 h + 2 h | Contract test I2 passes; a script importing `os` is rejected; `earth` calls stream via `on_call` |
| M5 | **Tier 2 · Place memory** + places CRUD | `app/services/memory.py`, `places.py`, routes/schemas `memory.py`, `places.py` | — | 1 h | Contract test I3 passes; prefill returns `{value, saved}` from a place file |
| M6 | **Tier 2 · Share links** (snapshot, no login, expiry, revoke) | `app/services/shares.py`, route/schema `shares.py` | I4 | 1 h | `GET /api/shares/{slug}` returns the run without memory or user id |
| M7 | **Tier 2 · PDF report** | `app/services/reports.py`, route `reports.py`, `app/templates/report.html` | M3, I4 | 1.5 h | `GET /api/runs/{id}/report.pdf` downloads for the preset |
| M8 | **Tier 2 · Dashboards**: save block, manual refresh without the LLM | `app/services/dashboards.py`, route/schema `dashboards.py` | M4, I4 | 1.5 h | Refresh re-runs the saved script and returns a new block; no LLM call |
| M9a | **Tier 1 · place + context providers**: Nominatim search/reverse (for `/api/areas/resolve`), Copernicus DEM (slope, elevation), ESA WorldCover (land cover for `describe` and setting cards), Open-Meteo rain | `backend/earth/providers/nominatim.py`, `planetary.py` (DEM, WorldCover), `openmeteo.py` | M1 | 2 h | `describe()` returns land cover + slope + rain for 3 places on 3 continents |
| M9b | **Tier 1 · radar fallback**: Sentinel-1 RTC `roughness`, used when optical is too cloudy | `providers/planetary.py` (S1) | M1 | 1.5 h | A cloudy tropical area returns a radar measurement instead of `NoClearScenes` |
| M9c | Tier 2 · Landsat heat, FIRMS fire | `providers/planetary.py` (Landsat), `firms.py` | M1 | 1.5 h | **First to cut** |

### Alex: agent, knowledge, contract, run store

| ID | Module | Files | Needs | Est. | Done when |
| --- | --- | --- | --- | --- | --- |
| A1 | **Tier 1 · API contract + run store + stream endpoint** | `app/schemas/runs.py`, `answer.py`, `stream.py`; `app/services/runs.py`; route `runs.py` | — | 1.5 h | Frontend renders the preset from `POST /api/runs`; contract test I4 passes; `openapi.json` regenerated |
| A2 | **Tier 1 · Knowledge**: **breadth before depth**: ~10 short event cards (`seasonal`, `vegetation_loss`, `vegetation_gain`, `water_gain` / flood, `water_loss` / drought, `new_bare_or_built`, `burn`, `landslide`, `pond_filling`, `construction`), settings for the WorldCover classes, loader + validation, `policy/rules.yaml` | `backend/knowledge/**` | — | 3 h | Loader validates; every world-test-set question matches at least one card or uses the measure-only path |
| A3 | **Tier 1 · Agent loop** (ARCHITECTURE §4.0): guard, tools, harness rules, code scoring + answer validation, limits | `app/services/agent/**` | A2, I1, I2, I3, I4 | 5 h | Real answers for ≥ 6 of 8 world-test-set places; hypotheses registered before the first data read; **measure-only answer** when no card matches; a refusal returns a `limits` block |
| A4 | **Tier 2 · Threads** + board summary | `app/services/threads.py`, route `threads.py` | A3 | 1 h | "Since when?" works as a follow-up |
| A5 | Tier 2 · Watches stub ("check now" + message preview), skills listing | routes `watches.py`, `skills.py` | A1 | 0.5 h | Endpoints return the preset |

### Shared

| ID | Module | Owner | Est. |
| --- | --- | --- | --- |
| S1 | Skills `pond-filling-check` (first) and `slope-check` + cached presets | Alex writes `SKILL.md` + tests, Meet writes `run.py` | 2 h |
| S2 | Deploy (VM + Docker, frontend `/api` forwarding) | Meet | 1 h |
| S3 | Demo rehearsal + 3-minute video | all | 1.5 h |

## 3. File ownership and shared files

- **Only edit files you own (§2).** Agents get the file list in their prompt and must not touch anything else.
- `app/api/router.py`: one `include_router` line per module, **appended**.
- `app/core/config.py`, `.env.example`: append settings; document every env var.
- **Dependencies:** one PR first (Phase 1, Meet) adds every known dependency for both of us, so `uv.lock` isn't fought over all night. Later additions: separate tiny PR, regenerate the lock, never hand-merge it.
  - Meet: `pystac-client`, `rasterio` (or `odc-stac`), `numpy`, `pillow`, `shapely`, `pyproj`, `weasyprint`
  - Alex: `anthropic`, `pyyaml`, `sse-starlette` (or plain `StreamingResponse`)
- `contracts/openapi.json`: regenerated by whoever changes a schema, in the same PR.

## 4. Interfaces (built in Phase 1, frozen after)

Every interface ships as: **types + signatures + stub + contract test** (`backend/tests/contracts/test_<name>.py`). The test runs against the stub now and the real module later. Stubs return **Hoo Hok Wai preset data** (HANDOFF B12.2), so the demo flow works from the start. A setting picks stub or real: `EARTH_IMPL=stub|real`, `SANDBOX_IMPL=subprocess|docker`.

**Demo user:** there are no accounts. Every request uses `user_id = "demo"` (an optional `X-User-Id` header overrides it).

### I1 · `earth` public API · Meet provides → used by agent scripts, skills, dashboards

Package `backend/earth/`, no FastAPI imports. Every function returns **small** results, never arrays. Full behaviour: HANDOFF B1.3–B1.8.

```python
Measure = Literal["greenness", "moisture", "water", "bare", "roughness"]  # roughness = S1 radar (M9b); heat/fire with M9c


class Provenance(BaseModel):
    provider: str
    satellite: str
    scene: str
    date: date
    cloud_over_area: float
    resolution_m: float
    method: str


class Area(BaseModel):
    geojson: dict
    area_ha: float
    name: str | None = None

    @classmethod
    def from_point(cls, lat: float, lon: float, radius_m: float = 400) -> "Area": ...
    @classmethod
    def from_geojson(cls, geojson: dict) -> "Area": ...


def describe(area: Area) -> PlaceContext: ...  # name, area_ha, pixels_10m, land_cover, elevation, recent_scenes, warnings
def scenes(area: Area, last: str = "60d", kind: str = "optical", max_cloud: int = 30) -> SceneList: ...
def load(area: Area, scene: Scene) -> LayerRef: ...  # pixels stay server-side
def index(layer: LayerRef, measure: Measure) -> LayerRef: ...
def measure(layer: LayerRef) -> Stats: ...  # mean, median, p10, p90, clean_px, cloud, provenance
def series(area: Area, measure: Measure, years: int = 5, every: str = "month") -> Series: ...
def compare(area: Area, measure: Measure, before: date, after: date) -> Comparison: ...
def surroundings(area: Area, ring_m: int = 300) -> Area: ...
def render(layer: LayerRef) -> RenderedLayer: ...  # layer_id, url, bounds

# earth.show.timeline / then_now / stat / highlight / hypotheses / limits -> Block (I5)
# Errors: EarthError(message, hint) → NoClearScenes, AreaTooSmall, BudgetExceeded
```

### I2 · Sandbox runner · Meet provides → used by the agent loop (`run_code`) and dashboards

```python
class EarthCall(BaseModel):  # one per earth call → becomes a UI step
    fn: str
    summary: str  # "Searched Sentinel-2: 9 scenes, 4 clear"
    ms: int
    provenance: Provenance | None = None


class ScriptError(BaseModel):
    kind: Literal["scan", "crash", "shape", "budget", "timeout"]
    message: str
    hint: str | None = None
    traceback_tail: str | None = None  # last ~20 lines, for the fix loop


class ScriptResult(BaseModel):  # HANDOFF B2.3
    findings: dict
    evidence: list[dict]
    blocks: list[Block]
    notes: list[str] = []


class RunOutcome(BaseModel):
    ok: bool
    result: ScriptResult | None
    error: ScriptError | None
    calls: list[EarthCall]


async def run_script(
    script: str,  # must define run(**params)
    params: dict,
    run_id: str,
    on_call: Callable[[EarthCall], Awaitable[None]] | None = None,
    timeout_s: int = 60,
) -> RunOutcome: ...
```

### I3 · Place memory · Meet provides → used by the agent loop and the API

Files: `backend/data/memory/<user_id>/me.md`, `places/<place_id>.md` (format: ARCHITECTURE §4.3).

```python
class Prefill(BaseModel):
    value: str
    saved: date


class MemoryContext(BaseModel):
    me: dict[str, str]
    places: dict[str, PlaceMemory]  # profile, notes, latest ~10 insights

    def as_prompt(self) -> str: ...  # labelled data block, never instructions


def load_context(user_id: str, place_ids: list[str]) -> MemoryContext: ...
def prefill(user_id: str, place_id: str, keys: list[str]) -> dict[str, Prefill]: ...
def write_profile(user_id: str, place_id: str, values: dict[str, str]) -> None: ...
def save_insight(user_id: str, place_id: str, run_id: str, text: str, confidence: str) -> None: ...
def add_note(user_id: str, place_id: str, text: str) -> None: ...
```

### I4 · Run store · Alex provides → used by share links, PDF, dashboards

```python
class RunRecord(BaseModel):
    run_id: str
    thread_id: str
    user_id: str
    place_ids: list[str]
    question: str
    status: Literal["running", "waiting_user", "done", "failed", "refused"]
    created_at: datetime
    answer: Answer | None
    blocks: list[Block]
    steps: list[Step]
    provenance: list[Provenance]
    method: Method  # cards + versions, skill, code_ref
    script: str | None  # last successful script → dashboard refresh
    params: dict
    cost: Cost | None


def save_run(run: RunRecord) -> None: ...
def get_run(run_id: str) -> RunRecord | None: ...
def list_runs(thread_id: str) -> list[RunRecord]: ...
```

Storage: SQLite, one JSON column per record (Alex's call; the interface is what's frozen).

### I5 · Frontend contract · Alex owns, Meet adds own endpoints

Branch `api/runs-contract`. Pydantic schemas → `contracts/openapi.json` → frontend PR review (@LizaaV, @annaclairebb).

| Area | Endpoints | Owner |
| --- | --- | --- |
| Runs + stream | `POST /api/runs` (SSE), `POST /api/runs/{id}/reply` (+`remember`), `GET /api/runs/{id}`, `GET /api/layers/{run_id}/{measure}/{scene}.png` | Alex |
| Threads | `GET /api/threads`, `GET /api/threads/{id}` | Alex |
| Areas (Tier 1) | `POST /api/areas/resolve` (search text, point + radius, polygon, coordinates), `POST /api/areas/context` | Alex (calls Nominatim via `earth` and `earth.describe`) |
| Skills, watches, knowledge | `GET /api/skills[/{id}]`, watches stub, `GET /api/knowledge/index` | Alex |
| Places + memory | `CRUD /api/places`, `GET/PATCH /api/places/{id}/memory`, `GET/PATCH /api/me/memory`, `POST /api/runs/{id}/insight` | Meet |
| Dashboards | `CRUD /api/dashboards`, `POST /api/dashboards/{id}/blocks/{block_id}/refresh` | Meet |
| Share + PDF | `POST /api/runs/{id}/share`, `GET/DELETE /api/shares/{slug}`, `GET /api/runs/{id}/report.pdf` | Meet |

**Stream events** (HANDOFF B10.2 + ARCHITECTURE §6): `run_started{run_id, thread_id}`, `guard`, `hypotheses_registered{post_hoc}`, `clarification_needed{questions[{key,label,options,value,source}], remember}`, `step_started` / `step_finished` (frontend `Step`), `block_ready`, `answer`, `error`, `done`.

**Block schema** (`backend/earth/blocks.py`, Meet; Alex reviews): HANDOFF B9.3. v1 types: `then_now`, `timeline`, `scene_strip`, `highlight`, `hypotheses`, `stat`, `limits`.

## 5. Timeline (HKT)

| Time | Phase | Meet | Alex | Checkpoint |
| --- | --- | --- | --- | --- |
| 19:30–20:00 | 0 · Agree | Read this doc together, fix disagreements | same | Both say "go" in chat |
| 20:00–22:00 | 1 · Interfaces | Deps PR; I1 types + stub `earth`; I2 runner stub; I3 memory stub; block schema; contract tests | I4 run store stub; I5 schemas + stub endpoints + stream; regenerate `openapi.json`; frontend PR | **22:00:** all interfaces merged, CI green |
| 22:00–23:00 | 2 · Stubbed end to end | `tests/test_e2e_demo.py` (question + refusal) + `tests/world_test_set.yaml` (§8.2) | Loop skeleton calling stubs (LLM can be real) | **23:00:** demo question runs end to end on stubs; frontend sees events |
| 23:00–09:00 | 3 · Agents build | **Tier 1 first:** M1 → M2 → M9a, M9b, M3, M4. **Then Tier 2:** M5 → M6 → M8 → M7 | **Tier 1 first:** A2, A3. **Then Tier 2:** A4, A5 | **02:00:** real `earth` works on the preset + 3 world-test-set places; loop answers with stub earth. **05:00:** loop + real `earth` answer a question on an unprepared place. **09:00:** ≥ 6 of 8 world-test-set places answered sensibly; Tier 2 merged or cut |
| 09:00–11:00 | 4 · Harden | S1 `run.py`, S2 deploy | S1 cards/tests, policy tests | Demo script (§8.1) passes 3 times in a row on the deployed URL, including a place picked on the spot |
| 11:00–12:30 | Feature freeze → fixes only | Video, README | Video, README | Submitted by **12:30** (30 min buffer) |

If we sleep, take shifts so one of us can merge and run the end-to-end test.

## 6. Rules for coding agents

**One module = one branch `be/<module>` = one worktree = one agent.** Each agent gets this prompt:

```text
Build module <ID> from docs/BUILD-PLAN.md §2.
Read: COLLABORATION.md §10, docs/BUILD-PLAN.md §3–§4, ARCHITECTURE.md <sections>, HANDOFF-BACKEND.md <sections>.
You may ONLY edit: <file list from §2>.
Implement against the frozen interface <I-number>; do not change it.
Done when: <acceptance test from §2> passes, plus tests/contracts/test_<name>.py and tests/test_e2e_demo.py.
Run: uv run ruff check . && uv run ruff format --check . && uv run pytest
Commit in Conventional Commits with scope `be`. Open a draft PR. Report actual test output.
```

- **Test on unprepared places, not just the preset** (§8.2).
- **Never** change an interface file without a human OK. If an interface is wrong, stop and report.
- PRs small; CI green; rebase on `main` before merge; after each merge, whoever merged runs the end-to-end test.

## 7. Cut order (if a module isn't green by 09:00)

Tier 2 goes first, so the §0 workflow survives:

1. Docker sandbox → keep the subprocess runner
2. M9c Landsat heat, FIRMS
3. Dashboard refresh → keep save → then dashboards entirely
4. PDF → keep share links
5. Threads beyond one follow-up
6. Second skill / landslide preset
7. Memory prefill → plain clarification card

**Never cut (Tier 1):** area search / draw / pin anywhere; real `earth` for any place (Sentinel-2 + radar fallback + DEM/land cover/rain context); the agent loop with hypotheses before data; the measure-only answer; one clarification card; the refusal.

## 8. Tests that prove the product bar

### 8.1 Demo script (end-to-end test and video)

1. **A place nobody prepared:** search a town or drop a pin wherever the judge says → ask **"Has anything changed here this year?"** → real scenes, real measurements, a plain answer (measure-only if no cause card fits).
2. Hoo Hok Wai → **"Have these fish ponds been filled in?"** → clarification card ("From memory" prefill if Tier 2 memory landed) → then/now, timeline with the drop, ranked causes, confidence, caveats.
3. Follow-up **"Since when?"** → change date from the timeline.
4. Tier 2 if built: **save to dashboard** → refresh; **share** link in a private window; **PDF**.
5. Refusal: **"Is my neighbour at home right now?"** → `limits` block, polite, no workaround.

Cache steps 2–4 for an offline fallback only.

### 8.2 World test set (`backend/tests/world_test_set.yaml`)

Eight places nobody tunes for. Each has a question, a known outcome from a public source, and a nearby control. Both of us add two places in Phase 2; pick events with a documented date and clear Sentinel-2 scenes before and after.

| # | Kind | Place and question (fill in Phase 2) | Must exercise |
| --- | --- | --- | --- |
| 1 | Vegetation loss | Tropical forest clearing | Cloud → radar fallback |
| 2 | Water loss | Reservoir that dropped | `water`, southern or northern hemisphere |
| 3 | Flood / water gain | A documented recent flood | Before/after, radar |
| 4 | Burn scar | A documented wildfire | `burn` / `greenness`, large area budget |
| 5 | Construction / new built | New road, airport or housing | `bare`, gradual change |
| 6 | Cropland status | A farm field: "Is it greener than normal?" | Seasonal band, measure-only path |
| 7 | Urban, small area | A single park under 1 ha | `AreaTooSmall` honesty |
| 8 | Nothing happened | A stable control area | Must say "no unusual change" |

Run it after every Tier 1 merge (`uv run pytest -m world`, network required, not in CI). Pass = sensible direction of change, honest confidence, correct "can't tell" — not exact numbers.

## 9. Env vars and keys

| Var | Used by | Notes |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | A3 | Server only; never in the sandbox |
| `FIRMS_MAP_KEY` | M9c | Optional |
| `EARTH_IMPL` | all | `stub` / `real` |
| `SANDBOX_IMPL` | M4 | `subprocess` / `docker` |
| `DAILY_SPEND_CAP_USD` | A3 | e.g. 20 → presets-only mode |
| `PUBLIC_BASE_URL` | M6 | For share URLs |

Add each to `backend/.env.example` in the PR that introduces it.

## 10. Open, decide in Phase 0

- [ ] Alex agrees to ARCHITECTURE §4.0 (loop) and owning the run store (I4)
- [ ] Block schema lives in `backend/earth/blocks.py` (Meet), re-exported for the API
- [ ] Alex agrees to knowledge **breadth first** (~10 short event cards) and the **measure-only answer** path
- [ ] Fill the world test set (2 places each, Phase 2)
- [ ] Which Hong Kong landslide is the second preset (or drop it)
- [ ] Who sets up the VM, and when
- [ ] Sleep shifts
