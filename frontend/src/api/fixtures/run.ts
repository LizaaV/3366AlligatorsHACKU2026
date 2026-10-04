/**
 * Stand-in run answer, in the contract's own shape.
 *
 * Taken from the captured stub run documented in `docs/API.md` §3.5 (Hoo Hok Wai ponds), so
 * fixture mode exercises exactly the structure the backend sends rather than a frontend
 * invention. It replaces the old `ask-answers.json` stand-in, which was written against the
 * frontend's pre-contract proposal.
 *
 * All seven block types are represented, so every renderer can be exercised offline.
 *
 * The two image-bearing types are the awkward ones: a real run serves their PNGs from
 * `/api/layers/{run_id}/...`, which exists only for a run the backend actually did. Rather than
 * point at a url that 404s, the stand-in inlines a clearly synthetic SVG so the comparison
 * slider and the patch overlay can be verified for real. Against a live backend the urls are
 * the server's and these are never used.
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

/** A flat two-tone SVG, inlined. Obviously not satellite imagery, which is the point. */
const placeholderImage = (from: string, to: string, caption: string) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200">` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>` +
      `</linearGradient></defs>` +
      `<rect width="320" height="200" fill="url(#g)"/>` +
      `<text x="160" y="104" font-family="sans-serif" font-size="13" fill="#fff" ` +
      `text-anchor="middle" opacity="0.85">${caption}</text></svg>`,
  );

const BOUNDS: [number, number, number, number] = [114.0856, 22.5295, 114.0956, 22.5385];

const THEN_NOW_BLOCK: S['ThenNowBlock'] = {
  type: 'then_now',
  id: 'b1',
  primary: true,
  title: 'Water, 5 Oct 2024 vs 30 Sep 2026',
  caption: 'The last clear pass before the change, and the newest one.',
  links: { time: 'cursor' },
  provenance: [PROVENANCE],
  measure: 'water',
  before: {
    layer_id: 'water-2024-10-05',
    url: placeholderImage('#1d4ed8', '#0ea5e9', 'stand-in: 5 Oct 2024'),
    bounds: BOUNDS,
    date: '2024-10-05',
    scene: 'S2A_20241005',
    label: 'Water',
  },
  after: {
    layer_id: 'water-2026-09-30',
    url: placeholderImage('#78716c', '#a8a29e', 'stand-in: 30 Sep 2026'),
    bounds: BOUNDS,
    date: '2026-09-30',
    scene: 'S2A_20260930',
    label: 'Water',
  },
  outline: null,
};

const TIMELINE_BLOCK: S['TimelineBlock'] = {
  type: 'timeline',
  id: 'b2',
  primary: false,
  title: 'Open water over two years',
  caption: 'Against the normal range for each month.',
  links: { time: 'follow' },
  provenance: [PROVENANCE],
  measure: 'water',
  unit: null,
  data: [
    { date: '2024-10-05', value: 0.1, scene: 'S2A_20241005', clean_px: 0.98 },
    { date: '2025-01-14', value: 0.08, scene: 'S2B_20250114', clean_px: 0.91 },
    { date: '2025-05-22', value: 0.02, scene: 'S2A_20250522', clean_px: 0.44 },
    { date: '2025-09-18', value: -0.06, scene: 'S2B_20250918', clean_px: 0.88 },
    { date: '2026-02-11', value: -0.14, scene: 'S2A_20260211', clean_px: 0.93 },
    { date: '2026-06-03', value: -0.21, scene: 'S2B_20260603', clean_px: 0.37 },
    { date: '2026-09-30', value: -0.25, scene: 'S2A_20260930', clean_px: 0.96 },
  ],
  band: [
    { month: 1, lo: 0.02, hi: 0.16 },
    { month: 2, lo: 0.01, hi: 0.15 },
    { month: 5, lo: -0.02, hi: 0.12 },
    { month: 6, lo: -0.03, hi: 0.11 },
    { month: 9, lo: 0.0, hi: 0.14 },
    { month: 10, lo: 0.03, hi: 0.18 },
  ],
  marks: [{ date: '2025-09-18', label: 'first dry pass' }],
  compare: [],
};

const SCENE_STRIP_BLOCK: S['SceneStripBlock'] = {
  type: 'scene_strip',
  id: 'b3',
  primary: false,
  title: 'Passes considered',
  caption: null,
  links: {},
  provenance: [PROVENANCE],
  scenes: [
    { scene: 'S2A_20260930', date: '2026-09-30', satellite: 'Sentinel-2', cloud: 0.04, used: true, why: null },
    { scene: 'S2B_20260925', date: '2026-09-25', satellite: 'Sentinel-2', cloud: 0.82, used: false, why: 'too cloudy over the area' },
    { scene: 'S2A_20260920', date: '2026-09-20', satellite: 'Sentinel-2', cloud: 0.11, used: true, why: null },
    { scene: 'S1A_20260918', date: '2026-09-18', satellite: 'Sentinel-1', cloud: 0, used: true, why: null },
    { scene: 'S2B_20260915', date: '2026-09-15', satellite: 'Sentinel-2', cloud: 0.67, used: false, why: 'partial cloud over the ponds' },
  ],
};

const HIGHLIGHT_BLOCK: S['HighlightBlock'] = {
  type: 'highlight',
  id: 'b4',
  primary: false,
  title: 'Where the water went',
  caption: null,
  links: {},
  provenance: [PROVENANCE],
  measure: 'water',
  total_ha: 32.7,
  base: {
    layer_id: 'base-2026-09-30',
    url: placeholderImage('#292524', '#57534e', 'stand-in base image'),
    bounds: BOUNDS,
    date: '2026-09-30',
    scene: 'S2A_20260930',
    label: 'True colour',
  },
  patches: [
    {
      ha: 18.4,
      centroid: [114.0889, 22.5338],
      geojson: { type: 'Polygon', coordinates: [[[114.0866, 22.5312], [114.0912, 22.5312], [114.0912, 22.5356], [114.0866, 22.5356], [114.0866, 22.5312]]] },
    },
    {
      ha: 9.8,
      centroid: [114.0931, 22.5361],
      geojson: { type: 'Polygon', coordinates: [[[114.0916, 22.5344], [114.0947, 22.5344], [114.0947, 22.5374], [114.0916, 22.5374], [114.0916, 22.5344]]] },
    },
    {
      ha: 4.5,
      centroid: [114.0874, 22.5369],
      geojson: { type: 'Polygon', coordinates: [[[114.0862, 22.5359], [114.0886, 22.5359], [114.0886, 22.5378], [114.0862, 22.5378], [114.0862, 22.5359]]] },
    },
  ],
};

const HYPOTHESES_BLOCK: S['HypothesesBlock'] = {
  type: 'hypotheses',
  id: 'b5',
  primary: false,
  title: 'What else could it be',
  caption: null,
  links: {},
  provenance: [PROVENANCE],
  post_hoc: false,
  rows: [
    {
      card_id: 'pond_filling',
      label: 'The ponds were filled in',
      expected: { water: '↓ by > 0.2', roughness: '↑ by > 6', bare: '> 0' },
      observed: { water: '↓ 0.35', roughness: '↑ 8.1', bare: '0.14' },
      verdict: 'supported',
      reason: 'Every expected signal moved in the expected direction.',
      score: 0.81,
    },
    {
      card_id: 'seasonal',
      label: 'A normal dry season',
      expected: { water: 'within the monthly range' },
      observed: { water: '0.11 below the monthly low' },
      verdict: 'contradicted',
      reason: 'The drop is outside the normal range for September.',
      score: 0.12,
    },
    {
      card_id: 'water_loss',
      label: 'Water drawn off for use',
      expected: { water: '↓ gradually', roughness: 'unchanged' },
      observed: { water: '↓ 0.35', roughness: '↑ 8.1' },
      verdict: 'unclear',
      reason: 'The surface also roughened, which drawing water off would not explain.',
      score: 0.34,
    },
  ],
};

const LIMITS_BLOCK: S['LimitsBlock'] = {
  type: 'limits',
  id: 'b6',
  primary: false,
  title: 'What this cannot tell you',
  caption: null,
  links: {},
  provenance: [],
  cant_tell:
    'Satellite imagery shows that the open water is gone. It cannot show who did it, under what permission, or whether the work is finished.',
  actions: [
    { label: 'A radar pass would confirm the surface through cloud', kind: 'radar' },
    { label: 'Wait for a pass after heavy rain to rule out a dry spell', kind: 'wait' },
    { label: 'Ask an expert to review the site history', kind: 'expert' },
  ],
  contacts: ['The local planning authority', 'The site owner or operator'],
  rule_id: null,
};

const STAT_BLOCK: S['StatBlock'] = {
  type: 'stat',
  id: 'b7',
  // §6: at most one block per answer is primary, and here that is the then/now comparison.
  primary: false,
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
  // ProofScene.cloud is PERCENT, unlike StripScene.cloud and Provenance.cloud_over_area
  // which are 0..1. See lib/format.ts. docs/API.md §3.5's example still shows fractions.
  proof: [
    { id: 'S2A_20241005', date: '2024-10-05', sat: 'Sentinel-2', cloud: 2, used: true, why: null },
    { id: 'S2A_20260930', date: '2026-09-30', sat: 'Sentinel-2', cloud: 4, used: true, why: null },
    { id: 'S2B_20260820', date: '2026-08-20', sat: 'Sentinel-2', cloud: 71, used: false, why: 'too cloudy over the area' },
  ],
  blocks: [THEN_NOW_BLOCK, TIMELINE_BLOCK, SCENE_STRIP_BLOCK, HIGHLIGHT_BLOCK, HYPOTHESES_BLOCK, STAT_BLOCK, LIMITS_BLOCK],
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
