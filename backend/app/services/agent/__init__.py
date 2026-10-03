"""The agent loop (BUILD-PLAN A3, ARCHITECTURE §4.0): guard, tool-use loop, harness rules.

Modules:

- `llm`: provider-neutral LLM types (`llm.base`), the scripted test provider
  (`llm.fake`) and `get_provider`.
- `state`: `AgentState`, the resumable loop state stored at `RunRecord.params["agent"]`.

Shared run plumbing (`drive`, `EarthSteps`) lives in `app.services.run_driver`.
"""
