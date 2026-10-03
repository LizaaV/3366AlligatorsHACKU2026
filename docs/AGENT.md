# Earth Agent: the agent loop (A3)

**Who this is for:** judges who want to know how the answers are made, and the team (backend, frontend) who need the exact rules.
**Code:** `backend/app/services/agent/` (owner @Alex-bot16). **Status:** live with Claude Opus 5.5, measured on Sun 4 Oct (section 13).
**Related:** [API.md](API.md) (the frontend contract), [HANDOFF-BACKEND.md](HANDOFF-BACKEND.md) (the original design), `backend/ARCHITECTURE.md` §4.0 (the loop decision).

---

## 1. In one minute

A user draws an outline on the map and asks a plain question, such as "Have these ponds been filled in?". The agent answers it from free satellite data, typically in 30 to 60 seconds, with:

- the numbers it measured;
- the satellites and dates behind them;
- the causes it considered;
- what it cannot tell.

It works as a **tool-use loop**. Claude decides what to read, measure and ask next. **Code** runs every tool, enforces every rule, scores the evidence and checks the answer before anyone sees it.

| Principle | How the code enforces it |
|---|---|
| The LLM requests, code grants | Every tool call goes through a handler that can refuse it with a reason. Policy, budgets, scoring, confidence and card status are code. |
| No number the code did not produce | `finish` is rejected when the title, sentence, stats, cause, todo or caveats contain a number that is not in the run's tool results, cards, place facts or policy note (rounding allowed). |
| No cause without a knowledge card | A cause needs an event card that was registered as a hypothesis before the data, read, and named `top` by **code** scoring. Otherwise the answer is measure-only. |
| Pixels never reach the model | Scripts run in a sandbox and return small tables. Tool results are compact JSON of at most 2,000 characters. |
| Provenance everywhere | Every `earth` call is a visible step, carrying its satellite, scene and date when it read an image. The answer carries `route`, `proof`, `method` (cards with version and status, skill, script, model) and a hash. |
| Honest limits | "I can't tell between A and B" is a valid answer. Caveats are required for place answers. A run that hits a cap still ends with a measured, code-built answer. |
| Structured outputs | Seven strict tools; a strict JSON guard verdict; the answer is assembled by code from checked fields. |

## 2. Architecture

```text
Browser ── POST /api/runs ──▶ routes/runs.py
                                │  400 unknown provider · 429 cooldown or 3 runs busy
                                │  no provider / AGENT_MODE=preset / daily spend cap:
                                ├──▶ preset run (only for the Hoo Hok Wai place) or error + done{failed}
                                ▼
                    agent/loop.py · stream_agent_run
                    every event goes through run_driver.drive: stored, streamed, exactly one `done`
                                │
 1. gates + guard   policy.py: area size, military overlap (stub), injection pre-check (regex)
                    guard.py: one structured LLM call (effort low) → {scope, rule_id, reason}
                                │  block rule → limits block, done{refused}
                                │  redirect rule → limits block + fixed answer, done
                                ▼
 2. grounding       earth.describe (a visible step) · up to 2 setting cards · user memory (untrusted)
                                ▼
 3. loop            system = prompts.build_system()  (stable, cached)  +  append-only transcript
                    ┌─▶ LLMProvider.complete()   llm/claude.py  |  llm/fake.py (tests)
                    │      │ tool calls, run in order
                    │   tools.py handlers  ◀── harness.py (caps, hypotheses, compact results)
                    │      ├ read_card ............ knowledge cards and skills
                    │      ├ register_hypotheses .. expectation table (+ seasonal, look-alikes)
                    │      ├ run_code / run_skill . sandbox subprocess → earth → steps, blocks
                    │      │                        └ scoring.py: code verdicts sent back
                    │      ├ ask_user ............. memory prefill → pause (done{waiting_user})
                    │      ├ propose_change ....... draft file for human review
                    │      └ finish ............... validate.py → problems back as a tool error
                    └──────┘ all results in ONE user message, state saved after every turn
                                ▼
 4. answer          answer.py: build_answer | general_answer | build_template_answer
                    → block_ready (code-built hypotheses table) → answer → done
```

| File (`backend/app/services/`) | Job |
|---|---|
| `agent/llm/base.py` | Provider-neutral types: `Message`, `ToolSpec`, `ToolCall`, `ToolResult`, `Turn`, `Usage`, `Pricing`, `LLMProvider`, `LLMError` |
| `agent/llm/claude.py` | The Claude adapter over the Anthropic SDK |
| `agent/llm/fake.py` | `FakeProvider`: scripted turns for tests, no network |
| `agent/llm/__init__.py` | `get_provider`, `available_providers`, `set_provider_override` |
| `agent/loop.py` | A run from start to `done`, and the resume after a clarification reply |
| `agent/guard.py`, `agent/policy.py` | The guard call; code gates (cooldown, spend cap, run slots, size, military, injection pre-check) |
| `agent/prompts.py`, `agent/earth_reference.md` | The stable system prompt and the run's first message |
| `agent/tools.py` | The seven tool specs and their handlers |
| `agent/harness.py` | Caps, hypothesis registration, compact results |
| `agent/script_check.py` | Extra ban list for agent-written scripts |
| `agent/skills.py` | Skill registry: SKILL.md, param checks, findings adapter |
| `agent/scoring.py` | Code scoring of the hypotheses, ties and confidence |
| `agent/validate.py` | The checks on every `finish` |
| `agent/answer.py` | Builds the `Answer` (place, measure-only template, general) |
| `agent/state.py` | `AgentState`, the resumable run state stored at `RunRecord.params["agent"]` |
| `run_driver.py` | `drive` (store every event, exactly one `done`) and `EarthSteps` (shared with the preset run) |

## 3. Provider-agnostic design

The harness speaks only the neutral types in `llm/base.py`. A provider maps them to its API and back.

```python
class LLMProvider(Protocol):
    name: str
    model: str
    async def complete(*, system: list[str], messages: list[Message], tools: list[ToolSpec],
                       max_tokens: int, effort: Effort) -> Turn: ...
    async def complete_json(*, system: list[str], user: str, schema: dict,
                            max_tokens: int, effort: Effort) -> tuple[dict, Usage]: ...
    def cost_usd(self, usage: Usage) -> float: ...
```

- `system` is a list of **stable** parts, so a provider can cache them. Anything per run goes in `messages`.
- `Turn.stop` is one of `tool_use`, `end`, `max_tokens`, `refusal`.
- `Message.raw` is a provider-private, JSON-serialisable payload. Only the same provider replays it, unchanged. The transcript is append-only: earlier messages are never edited.
- `complete_json` returns `{"_refusal": category}` when the model declines, and raises `LLMError` (with `retryable`) on failure.

### 3.1 The Claude adapter (`llm/claude.py`)

| Concern | What it does |
|---|---|
| Client | `anthropic.AsyncAnthropic`, `max_retries=1`, 120 s timeout per request (10 s to connect) |
| Model | `claude-opus-5-5` (setting `claude_model`) |
| Thinking | `thinking: {type: adaptive}` (it cannot be turned off on Opus 5.5). Depth set with `output_config.effort`: `medium` for agent turns, `low` for the guard. No temperature, no thinking budget |
| Tools | Sent with `strict: true` and `tool_choice: {type: auto}`. Forcing a tool is a 400 on Opus 5.5, so the prompt steers and the harness checks |
| Preserved thinking | An assistant turn's content blocks (thinking included) are stored as `Turn.raw` and replayed unchanged on the next request |
| Tool results | Every result answering one assistant turn travels in one user message, tool results first |
| Refusals | `stop_reason: refusal` is checked before reading content. A refused turn carries no tool calls (a refusal can cut a call off mid-input). `stop_details.category` is kept |
| Refusal fallback | Opt-in to the server-side fallback: `betas=["server-side-fallback-2026-07-01"]`, `fallbacks="default"` (setting `llm_fallbacks`, default on). If the API answers 400 about fallbacks, the call is retried once without and fallbacks stay off for the process (logged). Usage sums every sampling attempt |
| Prompt caching | Order is tools → system → messages. The cache breakpoint is on the last system block, so tools and system are cached together; top-level `cache_control` caches the growing conversation. Nothing volatile sits before the breakpoint |
| Structured output | The guard uses `output_config.format = {type: json_schema, schema}` |
| Errors | SDK exceptions become `LLMError`: retryable for timeouts, connection errors, 408, 409, 429 and 5xx |
| Cost | $4.00 input, $20.00 output, $0.20 cache read, $5.00 cache write (5-minute), per million tokens |
| Logs | Metadata only (model, sizes, stop reason, usage, request id). Never content, never the key |

### 3.2 The fake provider (`llm/fake.py`)

`FakeProvider(turns=[...], json=[...])` replays scripted `Turn`s (or callables that build one from the transcript) and JSON answers. It records every call in `.calls` and raises `AssertionError` when it runs out of script, so a test fails loudly if the harness calls the model more often than expected. Every offline test uses it (section 15).

### 3.3 Choosing a provider

- `get_provider(name)`: `None` means `settings.llm_provider`.
- `"claude"` needs `ANTHROPIC_API_KEY`.
- `"fake"` needs `ALLOW_FAKE_PROVIDER=true` (tests only).
- Anything else raises `ProviderUnavailable`.
- A request may name a provider (`RunRequest.provider`). The server answers 400 when it is not configured.
- A run remembers its provider (`RunRecord.provider`, `RunRecord.model`), and `/reply` resumes it with the same one.

### 3.4 Adding OpenAI later

Nothing in the harness, tools, scoring, validation or answer code changes. The steps:

1. Write `llm/openai.py` with `OpenAIProvider(*, api_key, model)` implementing the protocol:
   - `complete` maps the system parts to instructions, `Message`s to input items (assistant `tool_calls` to function calls, `tool_results` to function-call outputs), and `ToolSpec`s to strict function tools. The tool schemas are already strict-compatible: every property required, `additionalProperties: false`, optional values as `anyOf [..., null]`.
   - Keep the provider's own output items (for example reasoning items) in `Turn.raw` and replay them when `msg.provider == "openai"`.
   - Map finish reasons to `tool_use`, `end`, `max_tokens` and `refusal`; `Effort` to reasoning effort; cached-token usage to `Usage.cache_read_tokens`; SDK errors to `LLMError(retryable=...)`.
2. `complete_json`: structured outputs with a strict JSON schema; a refusal returns `{"_refusal": ...}`.
3. `cost_usd`: a `Pricing(...)` with that model's prices.
4. Settings: append `openai_api_key` and `openai_model` to `app/core/config.py` and document them in `backend/.env.example`.
5. `llm/__init__.py`: add `"openai"` to `KNOWN_PROVIDERS`, plus a branch in `get_provider` and `available_providers`.
6. Contract: widen `RunRequest.provider` to `Literal["claude", "openai"]` and regenerate `contracts/openapi.json`. This is additive (an `api/` branch).
7. Tests: an adapter test with an injected HTTP transport (like `tests/test_agent_claude_adapter.py`) and one `live` test. The loop tests already run against `FakeProvider`.

A transcript written by one provider can still be read by another (assistant messages are rebuilt from `text` and `tool_calls`), but the other provider's thinking is lost. So runs stay on the provider they started with.

## 4. A run, step by step

### 4.1 Before the stream (`routes/runs.py`)

1. Validate the area and the thread (400 or 404).
2. Pick the provider (400 if the request names one that is not configured).
3. No provider, `AGENT_MODE=preset`, or the daily spend cap reached: serve the scripted preset run **only** when the request names no place or its outline is the Hoo Hok Wai preset (intersection over union ≥ 0.5). Any other place gets `run_started → error{kind: agent_unavailable | spend_cap} → done{failed}`. The demo answer is never shown for the wrong place.
4. Gates that answer **429** with `Retry-After`:
   - 3 agent runs already streaming in this process (`MAX_ACTIVE_RUNS`);
   - the same user started a run less than `RUN_COOLDOWN_S` (3 s) ago.

### 4.2 Inside the stream (`loop.py`)

1. **`run_started`.** The run is stored with `status: running`, `provider`, `model` and a fresh `AgentState`.
2. **Code gates, then the guard** (section 7). This produces the `guard` event, then one of:
   - block rule: `limits` block, then `done{refused}`;
   - redirect rule: `limits` block, then a fixed `general` answer, then `done`;
   - partial or ask rule: the run continues with a policy note for the model;
   - no rule: the run continues.

   If the guard call fails or takes over 30 s, the stream sends `error{kind: llm_unavailable}`, then `done{failed}`.
3. **Grounding.**
   - When the run has an area, `earth.describe` runs as a visible step ("Look up the place"). Its slope also becomes a context reading for scoring.
   - Up to two setting cards are added, for the main land-cover classes (at least 5% of the area each).
   - The user's memory is loaded as untrusted data: their general preferences, plus the place's profile, insights and notes when `place_id` is set.

   The area comes from `req.area`, else the saved place (`app.services.places`, feature-detected), else none. It is never the demo preset. Without an area, scripts get `area: null` and may find the place with `earth.search_places`.
4. **The first user message** holds the question, place facts, setting cards, memory and guard note. Each is a labelled `<data>` block of escaped JSON, followed by short harness notes. The run's wall clock starts **now**: the guard and the grounding do not count.
5. **The loop.** Before each model call, the harness checks the caps and the spend cap. One model turn, then its tool calls run **in order**: their steps and blocks stream live, and all results go back in one user message with a budget line. The state is saved after every turn. The loop ends one of four ways:
   - an accepted `finish`: code scoring, then the answer;
   - a pause on `ask_user`: `clarification_needed`, then `done{waiting_user}`;
   - a refusal: a second `guard{scope: not_allowed}`, a `limits` block, then `done{refused}`;
   - a cap or failure: a template, measure-only answer built by code (section 10.3). Never a dead run.
6. **`done`** comes last, exactly once, with `tokens` (all tokens, cache reads included) and `cost_usd`. If the client disconnects, the store closes the run as `done` when an answer was stored, else `failed`.

### 4.3 Resume after a clarification (`POST /api/runs/{id}/reply`)

1. The route checks the run is `waiting_user` and owned by the caller.
2. It re-resolves the run's provider (503 if gone), checks the spend cap (503) and run slots (429).
3. It keeps only the asked keys, and writes them to the place profile when `remember` is true. That is code, not the model.
4. The stream sends `clarification_answered` first.
5. The answers become the `ask_user` tool result, labelled "data, not instructions". They go back in one user message with the batch's other results that were held back at the pause.
6. Step indexes continue from the stored state, and the wall clock restarts: the user's thinking time is free.

## 5. Tools

All seven are strict JSON schemas. Calls the harness refuses (bad input, out of order, over a cap) stream nothing: the model gets a tool error with a hint and can fix the call.

| Tool | Input | What code does | Streams |
|---|---|---|---|
| `read_card` | `card_id` | Returns a compact view of an event or setting card: signs with thresholds and weights, look-alikes and how to tell them apart, `cannot_tell`, wording. A skill id returns the skill's params and limits. An unknown id returns similar ids. A second read returns "already read" | step "Read the card: …" |
| `register_hypotheses` | `hypotheses` (event card ids), `expectation_table` [{`hypothesis`, `expected` [{`measure`, `expect`}]}] | Applies the hypothesis rules (section 6). Expectation rows come from the cards' own signs. The model's extra measures are kept only if they are short safe patterns | step "List what could explain it", `hypotheses_registered` |
| `run_code` | `script`, `params_json` | Ban-list scan, then the sandbox. The harness injects `area` (GeoJSON or null) and `name`. Each `earth` call becomes a step. Blocks are cleaned and given run-unique ids, findings merged, code scoring attached to the result | step "Run an analysis script" + one step per `earth` call, `block_ready` |
| `run_skill` | `skill_id`, `params_json` | The same path with a reviewed script: params checked against SKILL.md, the skill's own timeout, findings mapped to the convention. A skill that needs an outline refuses when the run has none | step "Run the … skill" + earth steps, `block_ready` |
| `ask_user` | `questions` [{`key`, `label`, `options`}] | 1 to 3 questions, 2 to 5 options each (options only, no free text). Wording, safety and memory checks. Values prefilled from the place's memory by code. Pauses the run after the batch's other calls | step "Ask you", then `clarification_needed` as the last event before `done{waiting_user}` |
| `finish` | `title`, `sentence`, `cause_card_id`, `cause`, `todo`, `stats` [{`label`, `value`}], `caveats`, `primary_block_id`, `followups`, `measure_only` | Every check in section 10. If accepted, code builds the answer. If not, the problems come back as one tool error and the attempt counts | step "Check the answer" |
| `propose_change` | `target`, `diff`, `reason` | Saves a draft under `<data dir>/knowledge_proposals/<run_id>-<n>.json` for human review. Never applied. Refuses server-only fields (status, version, confidence caps, reviewed), policy and schema targets, instruction-like text and memory | step "Draft a knowledge change" |

**FINDINGS CONVENTION** (scripts and skills): `findings["observed"][measure] = {value, before, after, delta, inside_band, local, persistent, sudden, date}`, with null when unknown. The measures are the knowledge measures: greenness, moisture, water, bare, burn, roughness, slope_deg, elevation_m, rain_mm, heat, fire, land_cover. **Scoring reads only `findings["observed"]`.** Later readings merge field by field. `before`, `after` and `delta` move together, so a delta never mixes two definitions of "before". The tool result lists any value a re-look replaced.

## 6. Harness rules (complete list)

**Order and hypotheses**

1. `run_code` and `run_skill` are refused until `register_hypotheses` has been called. `[]` is allowed and leads to a measure-only answer.
2. Code always adds `seasonal`, the null hypothesis. It also attaches the look-alikes of every event the model names, and tells the model what it added. At most 8 hypotheses per run.
3. Hypotheses added after a script got past the scan are `post_hoc`. Their confidence is capped at Low, and the "What else could it be" table says "Added after the data was seen".
4. Ids must be event cards. If any id is wrong, nothing is registered, so the model can fix the call without losing its pre-registration.

**Data**

5. A `run_code` script that read no data counts for nothing: no findings, notes, evidence or blocks. "Read data" means a successful `scenes`, `load`, `index`, `measure`, `series`, `compare`, `surroundings` or `weather` call. Values the model typed into a script cannot become "measured".
6. Script-made `hypotheses` tables are dropped. The table and the verdicts are code's (scoring).
7. Everything a script returns is redacted (key-shaped strings and the configured key) and size-capped:
   - 30,000-character scripts, 20,000-character params;
   - 12 blocks per script and 30 per run;
   - 200 evidence items of up to 2,000 characters each;
   - 60 notes.
8. Block texts are checked at every depth: blame and avoid wording, links, keys, instruction-like text, memory. A failing text is blanked or replaced. An image whose URL is not a layer this run rendered (`/api/layers/<this run>/...png`) drops the block.
9. Each successful script with blocks is saved on the record (`script`, plus `params.script_params` without private answers), so a dashboard can re-run it without the LLM.

**Model behaviour**

10. Tool calls run in order. After an accepted `finish`, nothing else in the batch runs.
11. An `ask_user` in a batch pauses after the other calls run. Their results are kept in `pending_results` and sent with the answers. Only one `ask_user` can be pending. It is refused on the last turn, when no turn would be left to use the answer.
12. A turn cut off at `max_tokens`: every call in it gets a "not run" error and the model is asked to reply more briefly, once. A second cut-off ends the run with a template answer.
13. A turn with text but no tool call is nudged once ("text outside a tool call is not shown"). A second one ends the run with a template answer.
14. Every batch of results carries a budget line, for example "Budget left: 9 of 12 turns, 5 of 6 code runs, about 110 s". On the last turn it adds "call finish now".
15. Tool results are compact JSON of at most 2,000 characters. The least important keys are shrunk and then dropped, with a `_truncated` note. Card views may use 7,000 characters, skill views 4,000, and lists of finish problems 3,500.

**Caps.** Turns, wall clock and finish attempts end the run with a template answer (never a dead run). The other caps refuse the call, and the model is told to finish with what it has.

| Cap | Value | Setting |
|---|---|---|
| Model turns | 12 | `AGENT_MAX_TURNS` |
| `run_code` + `run_skill` calls | 6 | `AGENT_MAX_CODE_RUNS` |
| Wall clock of the loop | 150 s (restarts after a clarification reply) | `AGENT_WALL_CLOCK_S` |
| `ask_user` calls | 2 per run, 3 questions each | fixed |
| `finish` attempts | 3 | fixed |
| `propose_change` | 3 per run | fixed |
| Script time | 60 s for `run_code`; a skill's own `timeout_s` (pond-filling-check: 120 s). Always capped by the time left | fixed / SKILL.md |
| `max_tokens` per turn | 16,000 (thinking included) | `AGENT_TURN_MAX_TOKENS` |
| Guard `max_tokens` | 4,000, 30 s timeout | `GUARD_MAX_TOKENS` |
| A model call | the time left plus 20 s grace (at least 15 s) | fixed |
| `earth` per script | 30 calls, 60 scenes per series, 25 km², about 2.5 M pixels per read | `earth` budgets |

## 7. Guard and code gates

**The guard** is one structured call (effort `low`) before the loop.

- It sees **only** the question and code facts about the area (name and size), as JSON inside `<request_data>` with `<` escaped. It never sees memory, profile text or tool outputs.
- Its system prompt is the policy rules from `knowledge/policy/rules.yaml`, in priority order with examples and "fine" counter-examples. It is stable, so it is cached.
- It returns `{scope, rule_id, reason}`, with `rule_id` limited to the known rule ids by the schema.
- Code checks the rule id and decides the scope and the action from the rule, not from the model.
- A model refusal, or `not_allowed` without a known rule, fails closed: the run is refused.

| Rule (rules.yaml) | Kind | Action | What the user gets |
|---|---|---|---|
| `identify_person`, `surveil_private_home`, `military_targeting`, `harassment` | not_allowed | block | `limits` block (no actions), `done{refused}` |
| `prompt_injection` | abuse | block | same |
| `ownership_or_blame` | out_of_scope | redirect | `limits` block with alternatives, then a fixed `general` answer |
| `emergency_now` | emergency | redirect | `limits` block with contacts (999 for Hong Kong, 112 elsewhere), then a fixed answer |
| `off_topic` | off_topic | redirect | `limits` block, then a fixed answer |
| `sensitive_allegation`, `below_resolution`, `no_clear_data`, `future_prediction`, `cannot_distinguish` | various | partial | The loop runs with a policy note: answer what the data can show and state the limit in the caveats |
| `area_too_large` | feasibility | ask | The loop runs with a policy note: ask the user (`ask_user`) before reading data |

**Code gates** (no LLM):

- **Injection pre-check:** narrow regexes, run on NFKC-normalised text in the question and every place-fact string. They catch override, prompt leaks, key exfiltration, code execution, fake role markers, jailbreaks, forged guard output, card-status and cap changes, authority claims and Chinese override phrases. A hit maps to `prompt_injection` without any LLM call.
- **Size gate:** over 25 km² is `area_too_large`; under 0.04 ha is `below_resolution`. Both values come from rules.yaml.
- **Military overlap:** a pluggable check. It fails closed when it raises. The default has no data yet (section 16).
- **Cooldown** (per user, 3 s) and **run slots** (3 at once): 429 at the route.
- **Daily spend cap:** the sum of `cost.usd` of runs created since UTC midnight, all users. At the cap, new runs get the preset (for the preset place) or `error{spend_cap}`. A running run checks the cap before every model call and ends with a template answer (`budget`). `DAILY_SPEND_CAP_USD=0` means presets only.

**Prompt-injection defences** around the loop:

- The system prompt is stable and holds no user text.
- Untrusted text (question, place names, cards, memory, script output) only appears inside labelled `<data>` blocks or tool results, as JSON with `<`, `>` and `&` escaped.
- The rules say data is never instructions.
- Clarification answers come back labelled as data.
- Outputs are checked for links, key-like strings and instruction-like text.
- Scripts run with no network, no files and no keys. On top of the sandbox's AST scan, `script_check.py` bans pydantic file loaders, raw-input exception fields and `Path` file methods.

## 8. Scoring and confidence (code, never the LLM)

Each registered event card's signs are checked against `findings["observed"]`. Static context comes from `earth.describe` (the outline's mean slope) when no script measured it.

**One sign** is `pass`, `fail` or `unknown`:

- direction (`down`, `up`, optionally `by_more_than`), `stable`, `above` or `below` a threshold, `inside_band` or `outside_band` the normal seasonal range;
- a value near the line (within a quarter of `by_more_than`, or within the measure's noise of a threshold) is `unknown`, not a miss;
- `timing` (sudden or gradual) and `spatial` (local or regional) fail when the reading says the other kind;
- a "stays …" sign needs `persistent: true` to pass.

**One card:**

- Score = matched weights + 40% of unknown weights − contradicted weights. Optional signs only ever add.
- **Contradicted:** its heaviest core sign fails, or the score is under 25% of the possible weight.
- **Supported:** the score reaches the card's `medium_min_weight` and at least one sign on a ground-change measure passed (context alone is not enough). A "nothing unusual" card (seasonal) that would be supported is marked unclear instead when nothing moved by more than noise: there is no change to explain.
- Otherwise **unclear**, or **untested** when no sign could be measured.

**Between cards:**

1. A supported card whose registered look-alike fits more than 15% better is demoted to unclear.
2. When the top two are within 15%, code first tries the before-state checks the cards name (`TIE_RULES`):
   - pond filling needs open water before the change (water above 0);
   - vegetation loss keeps greenness above about 0.2, while new bare ground drops near zero with a bare-ground rise over 0.15.
3. Then it compares the cards on their `discriminating_measures`.
4. If neither separates them, the answer is "can't tell between A and B", with the card's `tell_apart_by` as what would settle it.

`top` is the one supported card left, if any.

**Confidence:**

1. The base level comes from the top card's weight thresholds (`high_min_weight`, `medium_min_weight`).
2. It is capped to Low for post-hoc hypotheses, and by card status: draft → Low, tested → Medium, reviewed → High.
3. It goes down one level per data problem: fewer than 50 clean pixels, a single scene, an area under 1 ha.
4. The percent is the score ratio, clamped to the level's range: High 80–95, Medium 55–79, Low 20–50.

| Situation | Confidence |
|---|---|
| A tie between two cards | Low 35 |
| No supported cause | Low 25 |
| No data read | Low 20 |
| Measure-only answer | Never above scoring's own confidence |
| Explanation-only answer | From the status of the cards read: all reviewed High 85, none draft Medium 65, else Low 40 |

All 11 event cards are drafts today, so a named cause is at most **Low**.

After every script, the model gets code's verdicts, `top` and a plain `decision`, for example "You may name 'pond_filling' as the cause (and no other card)" or "No cause may be named: code cannot tell 'A' from 'B'. Finish measure-only …". The model never scores.

## 9. Skills

A skill is a reviewed folder `backend/skills/<id>/`: `SKILL.md` (header with params, limits, `timeout_s`), `run.py` (a sandbox script) and `tests.yaml`. The index is in the cached system prompt. The model fills only the params the skill exposes. Code:

- checks types and ranges;
- injects `area` and `name`;
- refuses when the skill needs an outline the run lacks;
- maps the skill's findings to the FINDINGS CONVENTION.

Today there is one skill, `pond-filling-check` (draft): monthly water, bare ground and greenness history plus a before/after comparison, inside the outline and in a ring around it. A request's `skill_id` is passed to the model as "the user picked this skill: use it if it fits".

## 10. Finish validation and the answer

### 10.1 Checks on every `finish` (`validate.py`)

Every problem comes back to the model in one tool error, written so it can fix it. After 3 rejected attempts the run ends with a template answer.

- **Numbers.** Every number in the title, sentence, cause, todo, stats and caveats must match a number the run produced or was given by code, with rounding to the decimals written, or as a percent of a fraction. The sources are:
  - successful `run_code` and `run_skill` results, merged findings, evidence, notes;
  - the run's blocks and earth call summaries;
  - the place facts;
  - the quotable numbers of the cards in play (sign thresholds, normal ranges, numbers in `cannot_tell` and `tell_apart_by`);
  - the guard rule's policy note;
  - scoring.

  Free numbers: dates, years and small integers (0–12). Spelled-out numbers and decimal commas are rejected, so nothing dodges the check. Each rejected number names the closest number the run produced. Rejected numbers echoed in a finish error never become sources.
- **Cause.** With no data read, or `measure_only`, there is no cause and no causal wording ("filled in", "dumped", "for a building site", "was cleared"). The only exception is a hedge ("can't tell whether …"). A named cause must be:
  - an event card, registered and read;
  - marked `supported` by code scoring and allowed by it (`top`, no tie);
  - described with that card's `wording.use`, name or alias, without naming another event card.
- **Wording.** No avoid-list phrases of the cards in play. No blame: "illegal", "responsible", "culprit", "dumped by", "filled by the owner", "the developer cleared …" and similar are rejected; hedges such as "whether people filled it" are fine. No links, no key-like strings, no instruction-like text.
- **Memory.** No remembered value may appear in any text (section 11).
- **Shape:**
  - length limits: title 120, sentence 400, cause and todo 300, at most 4 stats (label and value 40 each), 6 caveats of 300, 3 follow-ups of 120;
  - every text on one plain line: line breaks and control characters are rejected, and literal `\uXXXX` escapes are decoded;
  - caveats are required when data was read;
  - `primary_block_id` must be a block of this run.

### 10.2 The answer (`answer.py`)

The model writes the text fields. Code fills in everything else:

- `kind`, `eyebrow`, colour, confidence;
- `route` and `proof` from the provenance;
- `blocks`, plus the code-built "What else could it be" table;
- `method`: cards with version and status, skill, script reference, model;
- `hash`.

The cause is kept only when scoring allows it. Caveats mix the model's first four, code's own (the tie and what would settle it, or why no cause is named) and the cause card's `cannot_tell` lines, at most six. Answers with no data read are `general`, and scoring is skipped.

### 10.3 Template answer (caps and failures)

`build_template_answer` makes a measure-only answer from the readings so far, for example "Measured so far: water index 0.11 → -0.25 (-0.36); …". It is always:

- Low confidence (30%, or 15% when nothing was measured);
- a plain reason (turns, code runs, time, rejected drafts, error, budget);
- no cause and no model text;
- every number a reading.

## 11. Memory rules

- **The LLM never writes memory.** No tool writes it. Only `/reply` with `remember: true` saves the answered keys to the place profile, through code (`memory.write_profile`).
- **Memory is untrusted data.** It enters the first user message as one `<data name="memory" source="user memory, untrusted">` block, never the system prompt, and never the guard.
- **Memory values never appear in agent text.** Share links publish the answer, steps and blocks, so the harness keeps a private list of remembered values (`AgentState.memory_values`). The list holds:
  - the user's general preferences, and the place's title, profile values, insights and notes;
  - values prefilled into a clarification card;
  - the user's own typed answers, except an answer that is exactly an option the model offered.

  Any text that repeats one of them is rejected or blanked. Values of 4 characters or more are checked; values that also appear in the cards or the place facts are exempt. The check covers:
  - `finish` texts;
  - `ask_user` labels and options;
  - expectation texts;
  - block texts;
  - step result summaries;
  - `propose_change`;
  - the params saved for dashboard refresh.
- **Private state stays private.** `GET /api/runs/{id}` strips `params.agent` (transcript, thinking blocks, memory values) and `params.agent_loop`.

## 12. Events the agent streams

| Event | From the agent |
|---|---|
| `run_started` | First |
| `guard` | Second (the verdict). A second `guard{scope: not_allowed, rule_id: null}` comes only if the model declines mid-run |
| `step_started` / `step_finished` | One pair per accepted tool call and one per `earth` call inside a script, plus "Look up the place". Indexes increase across the whole run, including after a reply. A rejected draft shows as a "Check the answer" step with "N problem(s) found; revising the answer" |
| `hypotheses_registered` | Each time hypotheses are added (`post_hoc: true` after data) |
| `block_ready` | Every block, ids unique per run (`s<script>_<id>` on a clash; `limits`, `hypotheses` from code). At most one `primary` |
| `clarification_needed` | Last event before `done{waiting_user}` |
| `clarification_answered` | First event of the reply stream |
| `answer` | Once, after the answer's new blocks |
| `error` | Followed by `done{failed}`. Kinds: `llm_unavailable`, `agent_unavailable`, `spend_cap`, or an `earth` error kind |
| `done` | Always last, exactly once. `status` is `done`, `waiting_user`, `failed` or `refused`, with `tokens` and `cost_usd` filled |

## 13. Limits and costs, measured

### 13.1 Live runs (Sun 4 Oct, `claude-opus-5-5`, effort medium, `EARTH_IMPL=stub` unless noted)

| Case | Run | What happened | Tokens | Cost (USD) | Time |
|---|---|---|---|---|---|
| a. Pond question with outline | `r_815652fe51c2` | Grounding (describe, `pond_filling` card, skill) → hypotheses (seasonal and look-alikes added by code) → skill. The first finish named pond_filling and was rejected: code could not tell new_bare_or_built from vegetation_loss. The second was measure-only: water 0.106 to -0.25, bare -0.344 to 0.12, 32.66 ha since 2025-09-14. 25 steps, 6 blocks. All 23 numbers trace to tool outputs | 140,078 | 0.222 | 57 s |
| a. re-run after fixes 1, 2, 4 | `r_5d0b6cc6e81b` | One extra radar/water look. The first finish was accepted, naming new_bare_or_built, the only cause code allowed, at Low 50%. The hypotheses block now shows slope 1.20 | 173,334 | 0.266 | 39 s |
| b. Explanation, no area | `r_79270017cd57` | Guard answerable. Read 2 cards, ran no code, `general` answer Low 40%. The first finish was rejected for length (434-character sentence, 7 caveats). All 14 numbers come from the cards | 69,378 | 0.086 | 26 s |
| c. Identify a person | `r_194bb8805786` | Guard `identify_person` → `limits` block → `done{refused}`. No loop call | 4,399 | 0.0024 | 7 s |
| d. Emergency | `r_6566824a96f4` | Guard `emergency_now` → `limits` with 999 / 112 → fixed answer → `done` | 4,389 | 0.0024 | 8 s |
| e. Pond question, skill | `r_7aa1fde006d8` | 2 cards, skill (18 earth steps, 5 blocks), 27 steps. The first finish was rejected (tie); the second was measure-only. All 19 numbers sourced | 181,574 | 0.167 | 38 s |
| f. Follow-up "Since when?" | `r_e0ee5d9fab18` | Same thread accepted; the run re-ran the skill. Change began around 2025-09-14; "I can't tell" pond filling vs other new bare ground. All 23 numbers sourced | 174,142 | 0.133 | 43 s |
| g. "Should I be worried …?" | `r_90c74786a8ff` | No clarification asked; measured with the skill and answered | 141,314 | 0.141 | 35 s |
| h. Whole Amazon basin | `r_1e8f155ccf6d` | Guard `area_too_large` (ask) → `ask_user` → `done{waiting_user}`. The reply streamed `clarification_answered` first, steps continued at 2, then a `general` answer. The finish was rejected 3 times for quoting "25" km² from the policy note (fix 3) | 60,907 | 0.053 | 7 + 17 s |
| h. re-run after fix 3 | `r_36fafd5d97f7` | Finish accepted first try ("about 25 km²"); 17,810 tokens read from cache on turn 1 | 41,050 | 0.026 | 7 + 8 s |
| a. with real satellite data | `r_c8aa12b902d5` | `EARTH_IMPL=real`: describe 16 s. The skill hit the then-60 s script cap (6 series calls of 12–20 s). The model wrote its own script (2 compare calls, 12.6 s, 2 blocks) and finished measure-only (water -0.08 to -0.10, moisture 0.20 to 0.11, 7.44 ha) with a caveat that the full check ran out of time. All 14 numbers sourced | 112,704 | 0.094 | 119 s |

**Event order** was correct in every case: `done` was last and exactly once, and step indexes increased across the resume.

**What it costs:**

- A place question with the skill: **$0.13–0.27** and **35–57 s** on stub earth.
- An explanation: **$0.09**.
- A guard-only ending: about **$0.002** and 7–8 s.
- A clarification round trip: about **$0.03–0.05**.

That is below the $0.25–0.60 estimated in ARCHITECTURE §4.0. Most tokens are cache reads at $0.20 per million.

**Caching works:**

- In the case a re-run, turn 1 wrote 23,033 tokens to the cache (the prompt had just changed). Turns 2–6 read 23,033, 26,494, 26,929, 27,918 and 29,627 tokens.
- With real data, turns read 17,286 to 22,056 tokens.
- The stable prefix (tools and system) is about 17,000–18,000 tokens. Case h's re-run read 17,810 tokens from the cache on its first turn.

**Total spend for the whole live phase: about $1.43.** That is $0.166 for live tests, $1.169 for 11 stub-earth runs (re-runs and one disconnected run at $0.069 included) and $0.094 for the real-data run, against a $5 budget. At the $20 daily cap, that is roughly 75–150 place questions per UTC day.

### 13.2 Guard accuracy and adapter check

- **Guard:** 28/30 = **93%** on actions (`POLICY_SAMPLE=30`, seed 0, `claude-opus-5-5`; 27 cases went to the model, 3 were settled by the pre-check).
  - Every rule case matched its expected rule, including all 3 prompt-injection cases.
  - The 2 misses were both over-cautious: allow cases came back as `partial`. One was an insurance flood question (`no_clear_data`); the other was "How many cars are in this big public car park?" (`below_resolution`). So 7 of 9 allow cases were correct.
  - The eval used 123,475 tokens (101,760 from cache) and cost $0.153.
- **Adapter:**
  - Turn 1 stopped on a strict tool call with args `{a: 17, b: 25}` and wrote 2,000 tokens to the cache.
  - Turn 2 replayed the raw content blocks (thinking included) and read those 2,000 tokens back from the cache.
  - The API accepted the refusal-fallback opt-in (no 400).
  - It cost $0.0123, plus $0.0011 for the structured-output call.
- Both live test files passed: 3 passed in 35 s.

### 13.3 What the live runs found, and what changed

| # | Found | Fix |
|---|---|---|
| 1 | The model never saw `top` when it was null (compact JSON drops nulls), so it named an unsupported cause | Every script result now carries `scoring.decision` in words |
| 2 | `landslide` was "supported" on flat ponds: the describe slope (1.2°) was never scored | `earth.describe`'s mean slope is now a context reading for scoring |
| 3 | A finish quoting "25 km²" was rejected 3 times: the number came from the code-built policy note, which was not a source | The guard rule's policy note is a number source |
| 4 | Garbled re-drafts: a line break where a dash should be ("0.8\no0.9", "before\ndash now"), literal `\u2192` escapes in place of an arrow | Literal escapes are decoded, control characters rejected, and the prompt asks for "to" instead of arrows or dashes |

Since then:

- The pond_filling vs new_bare_or_built ties of cases a, e and f are settled by the before-state rule (section 8). An offline test pins that the stub skill's readings now name `pond_filling`.
- Measure-only answers no longer show more confidence than scoring: cases a, e and the real-data run showed Medium 60%; that is now at most scoring's own Low.
- `pond-filling-check` declares `timeout_s: 120`.

## 14. How to run it

```bash
cd backend
uv sync
cp .env.example .env          # then put your key in .env: ANTHROPIC_API_KEY=...  (never commit it)
uv run uvicorn app.main:app --reload

curl -N -X POST localhost:8000/api/runs -H 'content-type: application/json' -d '{
  "question": "Have these ponds been filled in?",
  "area": {"point": {"lat": 22.534, "lon": 114.0906, "radius_m": 350}, "name": "Hoo Hok Wai ponds"}
}'
```

| Variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | unset | Server only, never sent to the sandbox. Unset: no agent (presets only) |
| `LLM_PROVIDER` | `claude` | Default provider (`fake` is for tests) |
| `CLAUDE_MODEL` | `claude-opus-5-5` | Exact model id |
| `LLM_FALLBACKS` | `true` | Server-side refusal fallback (beta); retried once without if rejected |
| `ALLOW_FAKE_PROVIDER` | `false` | Tests only |
| `AGENT_MODE` | `agent` | `preset` serves only the scripted Hoo Hok Wai run, with no LLM |
| `DAILY_SPEND_CAP_USD` | `20` | Spend since UTC midnight above which new agent runs are refused; `0` means presets only |
| `RUN_COOLDOWN_S` | `3` | Minimum seconds between two runs by the same user |
| `AGENT_MAX_TURNS`, `AGENT_MAX_CODE_RUNS`, `AGENT_WALL_CLOCK_S` | `12`, `6`, `150` | Loop caps |
| `AGENT_TURN_MAX_TOKENS`, `GUARD_MAX_TOKENS` | `16000`, `4000` | `max_tokens` per agent turn and for the guard |
| `EARTH_IMPL` | `stub` | `stub` (Hoo Hok Wai data, offline) or `real` (network) |
| `SANDBOX_IMPL` | `subprocess` | Sandbox for scripts |

## 15. How to test it

| Command | What it does | Cost |
|---|---|---|
| `uv run pytest -q` | The whole offline suite: 870 passed, 44 skipped. For every non-live test, conftest forces `LLM_PROVIDER=fake`, allows the fake and removes any API key, so nothing can reach the real API | free |
| `uv run pytest -q tests/test_agent_*.py` | The agent tests only: 521 passed, 3 skipped (the live ones) | free |
| `uv run pytest -m live tests/test_agent_claude_live.py tests/test_policy_live.py -s` | Real Claude calls: adapter shape, raw replay and caching, structured output, guard accuracy (`POLICY_SAMPLE`, `POLICY_SEED`; asserts ≥ 80%). Needs `ANTHROPIC_API_KEY` | about $0.17 |
| `curl` as in section 14 | End to end on stub earth (or `EARTH_IMPL=real`) | $0.1–0.3 per place question |

| Test file | Covers |
|---|---|
| `test_agent_foundation.py` | LLM types, `FakeProvider`, provider selection, `AgentState`, run store helpers, `drive` |
| `test_agent_claude_adapter.py` | Request shape, response mapping, raw replay, fallback retry, errors (injected HTTP, offline) |
| `test_agent_guard.py` | Guard verdict checks, outcomes, limits blocks, injection pre-check, gates |
| `test_agent_prompts.py` | Stable system parts, data blocks, escaping |
| `test_agent_tools.py` | Every tool handler and harness rule, caps, block cleaning |
| `test_agent_scoring.py` | Sign checks, verdicts, ties, confidence caps |
| `test_agent_validate.py` | Numbers, cause, wording, memory, shape |
| `test_agent_answer.py` | Place, measure-only, template and general answers |
| `test_agent_loop.py` | Whole runs through the HTTP API: happy path, rejected finish, caps, ask and reply, refusals, 429, preset fallback, concurrency |
| `test_agent_review_fixes.py` | Regression tests for the review and live-run findings |
| `test_skills.py` | Skill registry, params, findings adapter |

## 16. Known limits and TODOs

- **Slow real data.** With `EARTH_IMPL=real`, `describe` took 16 s and a monthly series 12–20 s per call, so the pond skill needs most of its 120 s. The live real-data run took 119 s. Use stub data or cached presets for the demo. Parallel reads and coarser history (HANDOFF B11.3) are not done yet.
- **Follow-ups start fresh.** A follow-up in the same thread is accepted, but the loop does not get a board summary of earlier runs yet (A4). Case f re-ran the skill.
- **Saved places.** `place_id` alone gives the agent an outline only once the places service (`app.services.places`) is installed. Until then, send `area` too. The agent never falls back to the demo place.
- **Military check.** `military_overlap` has no OSM data yet; the guard LLM is the only military check.
- **The guard is a little over-cautious.** 2 of 9 allow cases came back `partial`. The run still continues in that case, with an extra caveat.
- **Draft cards.** Every event card is a draft, so named causes are capped at Low. Promoting cards needs reviewed test cases (HANDOFF B6).
- **English only.** Non-English questions get English answers with the caveat "Answers are in English for now."
- **One process.** Cooldowns, run slots and the earth lock live in memory. The spend cap counts only cost already saved (bounded by 3 concurrent runs).
- **Spend-cap window.** The cap resets at UTC midnight (08:00 HKT). The settings comment in `app/core/config.py` and `.env.example` says "last 24 h"; the code is the reference.
- **No streaming of model text.** Users see steps, blocks and the final answer, not the model's prose.
- **`propose_change`** only writes draft files. There is no review screen yet.
- **The model may skip `ask_user`** when it could have asked (case g). Asking is steered by the prompt, not forced.
