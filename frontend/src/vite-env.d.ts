/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base path or absolute origin for API calls. Default: `/api` (proxied to the backend in dev). */
  readonly VITE_API_BASE_URL?: string;
  /**
   * Where endpoint data comes from.
   * - `fixture` (default while the backend is being built): local stand-ins in `src/api/fixtures/`
   * - `http`: real network calls. Endpoints with no live backend will fail loudly.
   */
  readonly VITE_API_SOURCE?: 'fixture' | 'http';
  /** Artificial delay for fixture responses, in ms, so loading states are exercised. Default 500. */
  readonly VITE_FIXTURE_LATENCY_MS?: string;
  /** Fraction (0..1) of fixture requests that fail, for testing error states. Default 0. */
  readonly VITE_FIXTURE_ERROR_RATE?: string;
  /** Override the basemap tile template. Tokens: {z} {x} {y}. */
  readonly VITE_TILE_URL_TEMPLATE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
