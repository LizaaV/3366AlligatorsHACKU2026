// All backend calls go through this folder. Request/response shapes come from
// contracts/openapi.json — don't invent fields the backend doesn't return.

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) throw new Error(`GET /api${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export type HealthResponse = { status: string };

export const api = {
  health: () => get<HealthResponse>('/health'),
};
