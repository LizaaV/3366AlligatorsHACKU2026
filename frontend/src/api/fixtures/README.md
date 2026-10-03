# Fixtures — temporary, delete as endpoints land

Local stand-ins for endpoints the backend has not built yet. They exist so the frontend can be
developed, demoed and tested before the API is live.

**None of this is application logic.** It is a stand-in server, quarantined in this folder. No
component imports from here — everything goes through `../endpoints/`, so a component cannot
tell a fixture from a real response.

## How to put an endpoint live

1. Delete the `fixture:` property from that endpoint in `../endpoints/<area>.ts`.
2. Delete the matching JSON file here.
3. Run `npm run build`. Any shape mismatch with the real contract becomes a type error.

That's it — no call sites change, no loading states change.

## Why there is an artificial delay

`VITE_FIXTURE_LATENCY_MS` (default 500 ms) makes fixtures resolve asynchronously, so skeletons
and spinners are exercised in development instead of flashing for a single frame. Set
`VITE_FIXTURE_ERROR_RATE=0.3` to make 30% of requests fail and check the error states.

## What is NOT faked

Writes are held in memory for the session only, so adding a place and refreshing loses it. That
is correct for a stand-in — real persistence arrives with the real backend, not with a
`localStorage` workaround here.

## Relationship to `docs/data/`

`docs/data/` is the canonical handoff for the backend team and is wired to nothing. These files
are the same records reshaped into the proposed API contract (GeoJSON geometry, ISO timestamps,
category keys). They are generated from `docs/data/` and deleted endpoint by endpoint, so there
is no long-lived second source of truth.
