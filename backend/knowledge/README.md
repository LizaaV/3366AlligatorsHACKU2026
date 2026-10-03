# Knowledge base

The agent may only name a cause that an **event card** describes, backed by the signs that
card lists. Cards keep answers grounded: what a change looks like from space, what it can be
confused with, and what we honestly cannot tell.

## Layout

```
knowledge/
├── events/<id>.md       event cards: things that happen (landslide, burn, pond_filling, ...)
├── settings/<id>.md     setting cards: kinds of place (cropland, steep_hillside, fish_ponds, ...)
├── policy/
│   ├── rules.yaml       guard rules (block / partial / redirect / ask)
│   ├── templates.yaml   reply texts used by the rules
│   └── tests.yaml       questions with the rule each one should trigger
├── schema.py            Pydantic models + allowed measures, block types, WorldCover codes
├── loader.py            load_knowledge(), KnowledgeBase, every cross-file check
└── validate.py          CLI: python -m knowledge.validate
```

A card is Markdown with a YAML header between two `---` lines. The file name is the id
(`events/landslide.md` has `id: landslide`).

## Adding a card

1. Copy a card of the same type and rename the file to the new id (snake_case).
2. Fill the header. Only measures from `schema.ALL_MEASURES` are allowed; signs using a
   planned measure (`heat`, `fire`) must be `optional: true`; at least two required
   signs must use v1 or context measures.
3. Keep `looks_like` symmetric: if A lists B, add A to B's card too.
4. Write the body sections. Events: What it is, How it shows up from space, How to tell it
   apart, Limits, Sources. Settings: What it is, What normal looks like, Pitfalls.
5. Set `status: draft` and validate.

## Validating

```bash
cd backend
uv run python -m knowledge.validate      # summary; exit code 1 on errors
uv run pytest -q tests/test_knowledge.py
```

The loader reports **every** problem at once as `path: message`. Errors block loading;
warnings (e.g. an unused template, a card with no cases) do not.

In code:

```python
from knowledge import load_knowledge

kb = load_knowledge()  # raises KnowledgeError(errors=[...])
kb.index_text()  # one line per card, for the system prompt
kb.find("山泥傾瀉 near Sai Kung")  # -> ["landslide"]
kb.lookalikes("landslide")  # cards to rule out
kb.settings_for_land_cover([10, 60])
kb.template_for("emergency_now")
```

## Status ladder

`draft` -> `tested` -> `reviewed`

- **draft**: written, passes validation.
- **tested**: its cases and controls ran through the agent with the expected results.
- **reviewed**: a person checked the physics, sources and wording.

The **server** sets status. Authors write `draft`; nobody hand-edits a card to a higher
status.

## The agent and the cards

The agent reads cards but never edits them. It may only **propose** a change
(`propose_change`), which becomes a draft for a person to review.
