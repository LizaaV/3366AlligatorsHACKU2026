/**
 * Stand-in run answer, in the contract's own shape.
 *
 * Taken from the captured stub run documented in `docs/API.md` §3.5 (Hoo Hok Wai ponds), so
 * fixture mode exercises exactly the structure the backend sends rather than a frontend
 * invention. It replaces the old `ask-answers.json` stand-in, which was written against the
 * frontend's pre-contract proposal.
 *
 * Deliberately omitted: `then_now`, `timeline` and `scene_strip` blocks. Those carry
 * server-rendered PNG urls under `/api/layers/{run_id}/...`, which only exist for a real run —
 * a fixture cannot fabricate them, and a broken image is worse than an absent block. The
 * `stat` block needs no imagery, so it is included and does render.
 */

import type { components } from '../schema';

type S = components['schemas'];

const PROVENANCE: S['Provenance'] = {
  provider: 'Microsoft Planetary Computer',
  satellite: 'Sentinel-2',
  scene: 'S2A_MSIL2A_20260930T025551',
  date: '2026-09-30',
  cloud_over_area: 0.04,
  resolution_m: 10,
  method: 'NDWI, McFeeters 1996',
};

const STAT_BLOCK: S['StatBlock'] = {
  type: 'stat',
  id: 'b4',
  primary: true,
  title: 'Area without open water',
  caption: 'Change between 5 Oct 2024 and 30 Sep 2026.',
  links: {},
  provenance: [PROVENANCE],
  label: 'Area without open water',
  value: 32.7,
  unit: 'ha',
  lo: 29.1,
  hi: 36.4,
};

export const FIXTURE_RUN_ANSWER: S['Answer'] = {
  kind: 'place',
  title: 'About 32.7 ha of the ponds no longer show open water',
  eyebrow: 'Hoo Hok Wai ponds',
  color: '#3b82f6',
  sentence:
    'About 32.7 ha of the ponds no longer show open water: the water index fell from 0.10 to -0.25 between 5 Oct 2024 and 30 Sep 2026.',
  l1: 'Likely cause',
  cause: 'consistent with the ponds being filled in',
  l2: 'What to do',
  todo: 'Check later images after heavy rain, or the site itself, before relying on this.',
  stats: [
    { l: 'Area without open water', v: '32.7 ha', ci: null },
    { l: 'Water index', v: '0.10 → -0.25', ci: null },
    { l: 'Clear passes', v: '99 of 148', ci: null },
  ],
  confidence: {
    level: 'Low',
    pct: 40,
    note: 'The knowledge cards behind this are drafts, not yet tested on known cases.',
  },
  caveats: [
    'Who did the filling, why, and whether it was permitted cannot be known from satellite images.',
    'Open water can also disappear in a dry spell; a later pass after heavy rain would separate the two.',
  ],
  route: [
    { sat: 'Sentinel-2', status: 'chosen', why: '10 m optical, 99 clear passes over the window' },
    { sat: 'Sentinel-1', status: 'support', why: 'radar, used to confirm through cloud' },
    { sat: 'Landsat 8/9', status: 'skipped', why: '30 m is too coarse for ponds this size' },
  ],
  proof: [
    { id: 'S2A_20241005', date: '2024-10-05', sat: 'Sentinel-2', cloud: 0.02, used: true, why: null },
    { id: 'S2A_20260930', date: '2026-09-30', sat: 'Sentinel-2', cloud: 0.04, used: true, why: null },
    { id: 'S2B_20260820', date: '2026-08-20', sat: 'Sentinel-2', cloud: 0.71, used: false, why: 'too cloudy over the area' },
  ],
  blocks: [STAT_BLOCK],
  followups: [
    'Has the water come back since?',
    'How much of the original pond area is left?',
    'What was here before the ponds?',
  ],
  method: {
    cards: [
      { id: 'pond_filling', version: 1, status: 'draft' },
      { id: 'water_loss', version: 1, status: 'draft' },
      { id: 'seasonal', version: 1, status: 'draft' },
    ],
    skill: null,
    code_ref: null,
  },
  skill_id: null,
  suggested_skills: [],
  measure_only: false,
  // The real stub run sets this too: it marks the answer as demo data in the UI.
  preset: true,
  hash: 'f4c1a9e2d7b30586',
};

/**
 * Clarifying questions for the synthesised fixture run, in the contract's own shape.
 *
 * Only reachable with `VITE_FIXTURE_CLARIFY=1` — the stub backend never asks (§4). The first
 * question carries a `value` and a `memory` source so the "From memory" badge has something to
 * render; the others are unanswered, which is the normal case.
 */
export const FIXTURE_CLARIFICATION: S['ClarificationQuestion'][] = [
  {
    key: 'use',
    label: 'What is this land used for?',
    options: ['Fish ponds', 'Cropland', 'Building site', 'Not sure'],
    value: 'Fish ponds',
    source: { from: 'memory', saved: '12 Sep' },
  },
  {
    key: 'since',
    label: 'Since when have you noticed the change?',
    options: ['This month', 'This year', 'Longer ago', 'Not sure'],
    value: null,
    source: null,
  },
];
