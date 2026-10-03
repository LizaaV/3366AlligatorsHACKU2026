from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Earth Agent API"
    cors_origins: list[str] = ["http://localhost:5173"]
    public_base_url: str = "http://localhost:5173"  # share links: <this>/proof/<slug>
    share_ttl_days: int = Field(30, ge=1, le=3650)  # 1 day to 10 years

    # Sandbox for agent-written scripts (BUILD-PLAN M4). docker = opt-in, see deploy/README.md.
    sandbox_impl: Literal["subprocess", "docker"] = "subprocess"
    sandbox_image: str = "earth-sandbox:latest"
    sandbox_network: str = "earth-only"  # internal Docker network: earth service only, no internet
    earth_service_url: str = "http://earth-relay:8701"  # as seen from inside the sandbox
    earth_service_host: str = "127.0.0.1"  # where the backend binds the earth service
    earth_service_port: int = 8701

    # --- Agent loop (BUILD-PLAN A3, ARCHITECTURE §4.0) -----------------------------------------
    #: Default LLM provider for agent runs ("claude"; "fake" is for tests only).
    llm_provider: str = "claude"
    #: Claude model id (exact id, no date suffix).
    claude_model: str = "claude-opus-5-5"
    #: Server-side key for the agent (env ANTHROPIC_API_KEY). Never sent to the sandbox.
    anthropic_api_key: SecretStr | None = None
    #: Opt into the server-side refusal fallback for Claude (beta); retried without on a 400.
    llm_fallbacks: bool = True
    #: Allow the scripted FakeProvider (tests set this; never in production).
    allow_fake_provider: bool = False
    #: "agent" = the tool-use loop; "preset" = the scripted Hoo Hok Wai demo run.
    agent_mode: Literal["agent", "preset"] = "agent"
    #: Spend across all runs in the last 24 h above which new agent runs are refused.
    daily_spend_cap_usd: float = 20.0
    #: Minimum seconds between two runs started by the same user.
    run_cooldown_s: float = 3.0
    #: Model turns per run, then the harness ends with a measure-only answer.
    agent_max_turns: int = 12
    #: run_code + run_skill calls per run.
    agent_max_code_runs: int = 6
    #: Wall clock per run (seconds), then a partial answer from the completed steps.
    agent_wall_clock_s: float = 150.0
    #: max_tokens per agent turn (includes adaptive thinking).
    agent_turn_max_tokens: int = 16000
    #: max_tokens for the guard call.
    guard_max_tokens: int = 4000


settings = Settings()
