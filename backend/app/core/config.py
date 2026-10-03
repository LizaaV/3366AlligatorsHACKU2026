from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Earth Agent API"
    cors_origins: list[str] = ["http://localhost:5173"]
    public_base_url: str = "http://localhost:5173"  # share links: <this>/proof/<slug>
    share_ttl_days: int = 30


settings = Settings()
