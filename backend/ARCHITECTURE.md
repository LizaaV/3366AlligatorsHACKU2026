# Earth Agent · combined backend plan

Status: **proposal — needs a yes from @Alex-bot16** on §3 and §7. The agent-loop decision (§4.0) is agreed by the team.
Code freeze: **Sun 4 Oct 2026, 13:00 HKT.**

This plan merges two design sessions:

- **[`docs/HANDOFF-BACKEND.md`](../docs/HANDOFF-BACKEND.md)** (Alex): the base design. Its Part B stays the **binding detailed spec** for everything this file does not change.
- **Meet's session** (this file): chat-first UX, clarification cards prefilled from memory, place memory, dashboards, share links + PDF.

Where the two disagree, §3 records the merged decision. If this file is accepted, the A6 decisions table in the handoff gets a pointer to §3.

---

## 1. The product in one paragraph

Earth Agent is **a chat about any place on Earth, made agentic**. It is general purpose: landslides, filled ponds, construction, floods, crops. The user picks a place and asks in plain language. The agent asks what it needs with **cards** (prefilled from what it remembers about that place). It works as an **agent loop**: it reads **knowledge cards**, states what it expects before looking at data, **writes small programs** against our `earth` library in a sandbox, and changes course based on what it finds. It answers inside the chat with one plain sentence, evidence, how sure it is, what it can't tell, and **visual blocks** (then/now, timeline, highlight, ranked causes). Blocks can be **saved to a dashboard and refreshed** without the LLM, and any answer can be **shared as a link or a PDF**.

## 2. Kept from the handoff, unchanged

| Topic | Handoff section |
| --- | --- |
| Principles: LLM requests, code grants; no number the code didn't produce; no cause without a card; pixels stay on the server; provenance everywhere; honest limits; structured everything | A2 |
| `earth` library: API, plain-language measures, Sentinel-2 offset and SCL mask, providers + router, budgets, errors with hints, provenance | B1 |
| Sandbox: subprocess + AST scan first, Docker + earth service thin client second; script contract; run → check → fix ×3 | B2 |
| Model and API settings (Opus 5.5, effort, refusals, caching, no prefill); expectation table; scoring and confidence in code; answer validation. **The 3-call pipeline itself is replaced by the loop (§4.0)** | B3.1, B3.3–B3.5 |
| Knowledge cards, skills, status ladder, `propose_change`, policy rules, prompt-injection layers | B4–B8 (Alex) |
| Output blocks catalogue and linking via a shared time cursor | B9 |
| Token, latency and spend limits | B11 |
| Demo preset Hoo Hok Wai fish ponds + a Hong Kong landslide | B12 |

## 3. Reconciliation: where the two sessions differed

| Topic | Handoff (Alex) | Meet's session | **Merged decision** |
| --- | --- | --- | --- |
| Demo and scope | General purpose; Hoo Hok Wai + landslide | Kansas dry-patch example | **Handoff.** Dry-patch was only an example |
| Agent shape | Fixed pipeline, 3 structured LLM calls | Tool-use loop | **Loop (team decision)**, for better results, flexibility and analysis. The pipeline's guarantees become harness rules: separate guard, hypotheses registered before data, code scoring and validation on `finish` (§4.0) |
| Understanding the request | Guard + think outputs (hypotheses, expectation table, plan) | A separate `TaskSpec` object | **No separate `TaskSpec`.** Guard output + `register_hypotheses` + clarification answers carry the same information |
| Conversation | Single runs; follow-ups only proposed (board summary, B3.6) | Chat threads, different turn sizes | **Chat threads on top of runs** (§4.1). Uses Alex's board summary as the thread state |
| Clarification | `clarification_needed {questions: [{key, label, options}]}`, ≤ 2 questions from the guard | Form cards prefilled from memory, with source badges | **Handoff event, extended** with `value` + `source` per question (§4.2); raised by the loop's `ask_user` tool, so it can also come mid-run |
| Memory | None (places CRUD only) | Markdown per place: profile, insights, notes | **Added** (§4.3). Attached at the start of the loop next to the setting card; written by code, never by the LLM |
| Visual outputs | Typed blocks, fixed catalogue, no Vega-Lite for the hackathon | Fixed artifact kinds, no LLM HTML | **Same idea. Use the handoff's blocks**; "artifact" just means a block |
| Re-running | Direct manipulation re-runs the script without the LLM (B3.6) | Saved artifacts re-run without the LLM | **Same mechanism**, also used for dashboards (§4.4) |
| Saving | "Save as skill" | Save to dashboard, save insight to place | **All three**, each a different button on an answer |
| Sharing | Proof link `/proof/{id}` (proposal), PDF from blocks | Share links (snapshot + live), PDF | **Proof link = share link** (snapshot only). PDF real. Live links = roadmap (§4.5) |
| Notifications | Watches stub: "check now" + message preview | All connectors faked | **Agreed:** WhatsApp / Slack / email / SMS / push are faked; alerts appear only in the watch's event log |
| Knowledge | Cards + skills + policy, Alex owns | Black box owned by Alex | **Handoff.** My draft's `Knowledge` interface is dropped |
| Ownership | Meet: `earth`, providers, sandbox. Alex: agent, knowledge, policy, API contract | — | **Handoff split, plus the additions in §7** |

## 4. Additions to the handoff

### 4.0 The agent loop (replaces the handoff's 3-call pipeline)

**Team decision:** the agent runs as a **tool-use loop**, for better results, flexibility and deeper analysis. The model decides what to read, measure and ask next, and can change course after seeing data. The handoff's principles (A2) still hold; the stages that used to guarantee them become **harness rules** enforced in code.

```text
code gates → GUARD (separate call) → LOOP: model ⇄ tools … → finish → code scoring + validation → answer
                                       ▲                         │ fails? reasons go back into the loop
                                       └─────────────────────────┘
```

**Guard stays a separate call before the loop.** It sees only the question, the place Profile and the policy summary, never tool outputs (B8 layer 4). It returns `{scope, rule_id, reason}`. Block rules stop here; the rest go to the loop.

**Tools** (all `strict: true`; outputs are small tables, never pixel arrays):

| Tool | Does | Harness rule |
| --- | --- | --- |
| `read_card(id)` | Full knowledge card or skill (Alex's knowledge base); the card index is in the cached prompt | Every read is logged and shown under "Method" |
| `register_hypotheses(hypotheses, expectation_table)` | Records the candidate causes from cards and the expected sign per measure | **Must be called before the first data read.** Can be called again later; anything added after data was seen is marked `post_hoc` and its confidence is capped at low |
| `run_code(script, params)` | Runs a script against `earth` in the sandbox (AST scan first); returns findings, evidence, blocks, notes (B2.3) and streams each `earth` call as a step | `earth` budgets (B1.6) apply; errors come back with hints |
| `ask_user(questions)` | Clarification card (§4.2), **now possible mid-run** ("I see two patches, which one?") | Max 2 per run. Code fills `value` and `source` from memory before sending |
| `finish(sentence, todo, caveats, primary_block)` | Ends the loop | Code then scores the expectation table, computes confidence, runs the answer checks (B3.4, B3.5). Failures (unknown number, cause without a card, missing caveat) go back to the loop as a tool error. **No matching card is not a failure:** the answer reports what was measured and says the cause is unknown (measure-only answer) |
| `propose_change(target, diff, reason)` | Knowledge drafts (B6) | Unchanged |

**Loop limits (hackathon):**

| Limit | Value |
| --- | --- |
| Model turns per run | 12, then `finish` is required |
| `run_code` calls per run | 6 |
| Wall clock | 150 s, then a partial answer from completed steps |
| `earth` budgets | B1.6, unchanged |
| Per-turn `max_tokens` / effort | ~4 000 / `medium`; guard 300 / `low` |

**Keeping latency and cost down:**

- **Skill match first.** If a reviewed or tested skill matches, the model fills its params and runs its `run.py`. The loop is then 2–4 turns.
- **Prompt caching** for tools → system rules → policy summary → card index → `earth` API reference (as in B3.1). Per-run content goes after the cache breakpoint.
- **Small tool results** keep the growing context cheap; long threads get the board summary (B3.6) instead of the full history.
- Expect roughly 2–4× the pipeline's cost per new question (about $0.25–0.60). The daily spend cap (B11.2) and presets-only fallback stay.

**How each turn type now works** (the model decides, no `turn` field needed):

| User message | Loop behaviour |
| --- | --- |
| New question | Full loop |
| Follow-up ("since when?") | Loop starts with the board summary and existing results; usually 1–2 `run_code` calls |
| Explanation ("what is greenness?") | `read_card` + `finish`, no data |
| Direct manipulation (dragging the timeline) | **Not a chat turn:** the script is re-run with new params, no LLM, template caption (B3.6) |

### 4.1 Chat threads

The frontend shows a chat. A **thread** holds the turns and Alex's **board summary** (B3.6: area, layers available, last verdict, cards and versions, last expectation table). Each agent reply streams the handoff's events, rendered in the chat as text, step groups, cards and blocks.

Turns of different sizes are handled by the loop itself (§4.0).

`RunRequest` gets an optional `thread_id`. No `thread_id` → a new thread is created and returned in `run_started`.

### 4.2 Clarification cards with memory prefill

The handoff's `clarification_needed` event stays, with two extra fields per question:

```json
{
  "questions": [
    {
      "key": "use",
      "label": "What is this place used for?",
      "options": ["Fish ponds", "Farmland", "Wetland reserve", "Construction site"],
      "value": "Fish ponds",
      "source": { "from": "memory", "saved": "2026-09-12" }
    },
    {
      "key": "since",
      "label": "When did you first notice the change?",
      "options": ["This month", "This year", "Over several years"],
      "value": null,
      "source": null
    }
  ],
  "remember": true
}
```

- `source.from`: `memory` (badge "From memory · 12 Sep"), `inferred` (from the question or `earth.describe`), or `null`.
- If memory already answers everything, the loop doesn't call `ask_user` and the stream shows one confirmation line instead ("Using: fish ponds · watching for filling. Change?").
- `POST /api/runs/{id}/reply` gets `remember: bool`. Code writes the answered values to the place profile (§4.3).

### 4.3 Place memory

One markdown file per place, loaded **only when that place is in the question**. Profile facts change rarely; insights and notes add up over time.

```text
backend/data/memory/<user_id>/          git-ignored
├── me.md                               language, units, alert preferences
└── places/<place_id>.md
```

```markdown
# Hoo Hok Wai ponds (pl_hhw) · 38 ha · Yuen Long, HK

## Profile
- use: fish ponds, inside a conservation area · 2026-09-12
- watching for: filling, dumping · 2026-09-12

## Insights
- 2026-09-30 · Greenness fell from ~0.45 to ~0.0 since 2024, change is local not regional · confidence medium · run r_8f2a · confirmed

## Notes
- 2026-09-20 · NGO site visit reported fresh fill on the north side
```

| Section | Holds | Written by |
| --- | --- | --- |
| Profile | Stable facts about the place (use, what we watch for, ownership type) | Code, from clarification answers with `remember: true`. Latest wins |
| Insights | Conclusions the user chose to keep | Code, when the user clicks **Save to place** on an answer |
| Notes | Things the user saw or did | The user, from the Places page |

Rules:

- **The LLM never writes memory.** It only reads it. This follows A2: the LLM requests, code grants.
- **Memory is untrusted text.** It goes into the prompt as a labelled data field, never into the system prompt (B8 layer 2). The guard sees only the Profile.
- Loaded at the start of the loop (with `earth.describe` and the setting card): Profile + Notes + the latest ~10 Insights.
- **Visible and editable** on the Places page (`Place.details` = Profile; Insights + Notes = a timeline).
- **Private**: never in shared links, never sent to `propose_change` or the knowledge base.

### 4.4 Dashboards

- A **dashboard** is an ordered list of saved blocks: `{block, run_id, script_ref, params, saved_at}`.
- **Save to dashboard** stores the block as it was rendered (a snapshot) plus the script and params that produced it.
- **Refresh** re-runs the script with the same params in the sandbox **without the LLM** (the B3.6 mechanism) and swaps in the new block with a template caption. Relative time params (`last="60d"`) move forward; fixed dates stay fixed.
- Cards show "updated 2 days ago" while a refresh is running. A real scheduler is roadmap; for the hackathon, refresh is manual.
- The frontend team builds the dashboard page (agreed).

### 4.5 Share links and PDF

- **Share link = the handoff's proof link.** `POST /api/runs/{id}/share` → `{slug, url}`. The link is unguessable, has an optional expiry, can be revoked, and needs no login. It shows the answer, blocks, provenance, cards and skills with versions, and the code (B9.6). It is always a **snapshot**; live links are roadmap.
- Never shown on a shared page: place memory, the owner's other places, the owner's identity.
- **PDF:** `GET /api/runs/{id}/report.pdf?lang=` renders the same snapshot server-side from an HTML template. Charts are drawn in Python; then/now uses the cached layer PNGs. Text only, no new LLM call. The run hash and scene IDs are printed for reproducibility.
- The modal's "team / invited" access and the data-file downloads (GeoJSON, CSV, GeoTIFF) stay mocked.

### 4.6 Faked

- Notification connectors: WhatsApp, Slack, email, SMS, push.
- Paid imagery ordering, expert review, team/invited sharing, data-file export.

## 5. Architecture, updated

```text
 Frontend (chat · map · blocks · Places · Library · Watches · Dashboards)
     │  thread_id? + area + question                ◄── streamed events → chat
     ▼
 ┌─ Backend (FastAPI) ────────────────────────────────────────────────────────────┐
 │  API ── threads ── guard ──► AGENT LOOP (Opus 5.5, tools, §4.0)                │
 │           │        model ⇄ tools … → finish → code scoring + checks            │
 │           │          ▲ reads            │ code                                 │
 │           │   KNOWLEDGE (cards, skills, │                                      │
 │           │   policy — Alex)            ▼                                      │
 │   PLACE MEMORY (.md) ──► GROUND     SANDBOX ──► EARTH SERVICE ──► data sources │
 │   (read by the LLM,                                  ▲                         │
 │    written by code)                                  │ re-run, no LLM          │
 │                                     DASHBOARDS · SHARE/PROOF · PDF (§4.4–4.5)  │
 └────────────────────────────────────────────────────────────────────────────────┘
```

## 6. Contract changes on top of the handoff's B10

| Change | Where |
| --- | --- |
| `RunRequest.thread_id?`; `run_started` returns `thread_id` | B10.1 / B10.2 |
| `GET /api/threads`, `GET /api/threads/{id}` (turns + blocks, so a thread reloads exactly) | new |
| Stream events `plan` → `hypotheses_registered` (may repeat, `post_hoc` flag); `clarification_needed` may arrive mid-run | B10.2 |
| `clarification_needed` questions: `+ value, source`; event `+ remember` | B10.2 |
| `POST /api/runs/{id}/reply`: `+ remember` | B10.1 |
| `GET/PATCH /api/places/{id}/memory`, `POST /api/runs/{id}/insight`, `GET/PATCH /api/me/memory` | new |
| `CRUD /api/dashboards`, `POST /api/dashboards/{id}/blocks/{block_id}/refresh` | new |
| `POST /api/runs/{id}/share`, `DELETE /api/shares/{slug}`, `GET /api/shares/{slug}`, `GET /api/runs/{id}/report.pdf` | new (B9.6 made concrete) |

As always: Pydantic schemas first, regenerate `contracts/openapi.json` in the same PR (COLLABORATION.md §6).

## 7. Ownership and build order to the freeze

Alex's steps from A7 stay as they are. The additions are split by who already owns the code they touch:

| # | What | Owner | Time | Done when |
| --- | --- | --- | --- | --- |
| 1 | API contract incl. §6 additions | Alex | ~1.5 h | Frontend can render the preset from `/api/runs` |
| 2 | **`earth` v1** (critical path) | Meet | ~4 h | `earth.series(hoo_hok_wai, "greenness", years=4)` shows the drop (B12.2) |
| 3 | Knowledge seed | Alex | ~2 h | Loader validates |
| 4 | **Agent loop** (§4.0): guard, tools, harness rules, limits, memory at loop start, `remember` on reply | Alex | ~5 h | One real question end to end, hypotheses registered before data |
| 5 | **Place memory store** + its endpoints | Meet | ~1 h | Profile prefill appears in the clarification event |
| 6 | Docker sandbox | Meet | ~2 h | Same question works with the network off |
| 7 | **Share link + PDF** | Meet | ~2 h | Link opens without login; PDF downloads for the preset |
| 8 | **Dashboards**: save + manual refresh | Meet | ~1.5 h | Refreshed block re-renders without an LLM call |
| 9 | Threads: `thread_id`, board summary, `GET /api/threads` | Alex | ~1 h | "Since when?" works as a follow-up in the loop |
| 10 | Two skills + cached presets | both | ~2 h | Demo works offline |
| 11 | Deploy, rehearse, video | all | Sun AM | Submitted before 13:00 |

**Cut order if time runs out** (first cut first): Docker sandbox (keep the subprocess) → dashboard refresh (keep save) → PDF (keep the share link) → second skill → threads beyond one follow-up → radar and rain. Never cut: `earth` v1, the pipeline, one clarification card with a memory prefill, the share link.

## 8. Dropped from Meet's earlier draft

So nobody builds them: the `TaskSpec` object, the earlier tool list (`read_kb`, `run_python`, `remember`; replaced by §4.0), the guard `turn` field, a separate Feasibility module (now guard + `earth` errors with hints), the `Knowledge` protocol, LLM-written memory (`remember` tool), the Kansas dry-patch demo, live share links, and the six-kind artifact catalogue (replaced by the handoff's blocks).

## 9. Questions for Alex

1. OK with the loop spec in §4.0 (tools, harness rules, limits) replacing A5/B3.2, and the extra `clarification_needed` fields?
2. Who wires memory into the loop start: you (agent) with my store behind it, as in §7 step 4?
3. Proof link and share link as one thing: snapshot only?
4. Is there budget for steps 5, 7 and 8 on my side after `earth` v1 and the sandbox, or should the dashboard move to the roadmap?
