from typing import Literal

from pydantic import Field
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


settings = Settings()
