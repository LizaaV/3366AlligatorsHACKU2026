# pond-filling-check

`run.py` is the skill's script (HANDOFF B5): `run(area=..., name=None, years=4, before=None, after=None, answers=None)`.
It runs in the sandbox like any agent script (public `earth` calls only, under 300 lines) and returns
`{findings, evidence, blocks, notes}`.

`SKILL.md` and `tests.yaml` are written by Alex (@Alex-bot16) and are not part of this folder yet.

Expectation table: `pond_filling` signs and weights come from `knowledge/events/pond_filling.md`
(`water` down > 0.2 and below 0, persistence, `roughness`, `moisture` <= -0.05, `bare` > 0, `greenness` < 0.25;
confidence `medium_min_weight` 8 / `high_min_weight` 11). Look-alikes are `looks_like`: `seasonal`, `water_loss`,
`construction`, `new_bare_or_built`, scored from their own cards plus the `tell_apart_by` text.
Radar (`roughness`) is not used yet, so it counts as unknown (40% of its weight).
