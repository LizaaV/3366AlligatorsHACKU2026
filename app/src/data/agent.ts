// Scripted agent behaviour: reasoning steps, answers (with confidence ranges, caveats, routing and proof).
import { CATS, SATS, type Skill } from './catalog';
import type { Place } from './places';
import { areaHa } from './geo';

export interface Step { title: string; desc: string; tool: string; result?: string; }

export const DATES = ['Aug 14', 'Aug 19', 'Aug 24', 'Sep 3', 'Sep 8', 'Sep 18', 'Sep 23', 'Sep 28'];
export const CLOUDY = [3];
export const DRY_LV = [0.12, 0.18, 0.28, 0.2, 0.5, 0.68, 0.85, 1];

export const DRY_STEPS: Step[] = [
  { title: 'Ask', desc: "What crop, how it's watered, and when the problem started.", tool: 'Asked 3 questions' },
  { title: 'Mark the field', desc: 'Draw or upload the field outline.', tool: 'Loaded contour' },
  { title: 'Pick dates', desc: 'The last few weeks, plus the same time in past years.', tool: 'Set time window', result: 'Aug 14 – Sep 28, 2026 · same window 2023–2025' },
  { title: 'Pick the satellite', desc: 'Sentinel-2 (free). Use PlanetScope (paid) if the field is very small.', tool: 'Accessed Sentinel-2', result: 'Field is large enough → Sentinel-2 L2A, 10 m' },
  { title: 'Find clear images', desc: 'Skip cloudy ones and ones taken just after rain.', tool: 'Filtered 12 scenes', result: '7 of 12 kept · 3 cloudy, 2 after rain' },
  { title: 'Clean the images', desc: 'Cut out the field and remove clouds and shadows.', tool: 'Preparing a contour mask', result: 'Clipped to contour · cloud & shadow mask applied' },
  { title: 'Calculate indices', desc: 'NDMI (plant water), NDVI (plant health), plus temperature.', tool: 'Computed NDMI, NDVI, LST', result: 'NDMI 0.31 · NDVI 0.68 · LST 31.4 °C (field avg)' },
  { title: 'Find dry spots', desc: 'Areas much drier than the rest of the field on 2 or more dates.', tool: 'Ran dry-spot detection', result: '1 zone below field median on 5 of 7 dates' },
  { title: 'Find the cause', desc: 'Irrigation fault, poor soil, high ground, or not water at all.', tool: 'Checked elevation & soil maps', result: 'Arc follows pivot spans 5–6 → irrigation fault' },
  { title: 'Show the answer', desc: 'A map, the size of the dry area, the likely cause and what to do. Re-check every 5 days.', tool: 'Built map layers', result: '4 layers added · re-check scheduled Oct 3' },
];

export const presetSteps = (p: Skill): Step[] => [
  { title: 'Read the skill', desc: `${p.name} by ${p.dev}.`, tool: 'Loaded skill settings', result: `v${p.version} · ${p.short}` },
  { title: 'Mark the area', desc: 'Use the selected place outline.', tool: 'Loaded contour' },
  { title: 'Pick dates', desc: 'The last few weeks, plus the same time in past years.', tool: 'Set time window', result: 'Aug 14 – Sep 28, 2026 · 2023–2025 baseline' },
  { title: 'Pick the satellite', desc: p.sat + '.', tool: 'Accessed ' + p.sat.split(' · ')[0], result: `${p.res} · revisit ${p.revisit}` },
  { title: 'Find clear images', desc: 'Skip cloudy scenes and bad passes.', tool: 'Filtered scenes', result: '7 of 12 kept' },
  { title: 'Clean the images', desc: 'Cut out the area and remove clouds and shadows.', tool: 'Preparing a contour mask', result: 'Clipped to contour' },
  { title: 'Calculate indices', desc: 'Run the skill’s model on each clean image.', tool: 'Ran skill model', result: '7 dates processed' },
  { title: 'Find changes', desc: 'Compare each date with the baseline.', tool: 'Compared with baseline', result: 'Change summary ready' },
  { title: 'Explain', desc: 'Write a short summary of what changed.', tool: 'Wrote summary', result: 'Done' },
  { title: 'Show the answer', desc: 'A map, the key numbers and next steps.', tool: 'Built map layers', result: 'Layers added' },
];

export const GENERAL_STEPS: Step[] = [
  { title: 'Understand', desc: 'Work out what kind of question this is.', tool: 'Read the question', result: 'General question · no place needed' },
  { title: 'Search the library', desc: 'Find skills that answer this kind of question.', tool: 'Searched 28 skills', result: '3 matching skills' },
  { title: 'Check satellites', desc: 'Which free and paid sources could answer it.', tool: 'Checked satellite catalog', result: '2 free · 1 paid option' },
  { title: 'Write the answer', desc: 'Short answer, with what it can and cannot tell you.', tool: 'Wrote answer', result: 'Done' },
];

export const CLAR = [
  { k: 'crop', label: 'What crop?', opts: ['Maize', 'Wheat', 'Soybean', 'Cotton'] },
  { k: 'water', label: 'How is it watered?', opts: ['Center pivot', 'Drip', 'Flood', 'Rain-fed'] },
  { k: 'when', label: 'When did it start?', opts: ['This week', '1–2 weeks ago', '3+ weeks ago'] },
] as const;

export interface LayerDef { id: string; name: string; src: string; color: string; on: boolean; ready: boolean; ai: boolean; }

export const LAYERS: LayerDef[] = [
  { id: 'contour', name: 'Field contour', src: 'Drawn by you', color: '#ffffff', on: true, ready: true, ai: false },
  { id: 'ndmi', name: 'NDMI · plant water', src: 'Sentinel-2 B8A / B11', color: '#14c6cb', on: false, ready: false, ai: true },
  { id: 'ndvi', name: 'NDVI · plant health', src: 'Sentinel-2 B4 / B8', color: '#00ca8e', on: false, ready: false, ai: true },
  { id: 'lst', name: 'Surface temperature', src: 'Landsat 9 TIRS', color: '#f24c53', on: false, ready: false, ai: true },
  { id: 'dry', name: 'Dry spots · 2+ dates', src: 'Agent · anomaly detection', color: '#ffcf25', on: false, ready: false, ai: true },
  { id: 'clouds', name: 'Cloud & shadow mask', src: 'Sentinel-2 SCL', color: '#656a76', on: false, ready: false, ai: true },
];

/* ---------------- answers ---------------- */

export interface RouteOption { sat: string; status: 'chosen' | 'support' | 'skipped' | 'fallback'; why: string; }
export interface ProofScene { id: string; date: string; sat: string; cloud: number; used: boolean; why?: string; }
export interface Stat { l: string; v: string; ci?: string; }

export interface Answer {
  kind: 'place' | 'general';
  color: string;
  eyebrow: string;
  title: string;
  stats: Stat[];
  confidence: { level: 'High' | 'Medium' | 'Low'; pct: number; note: string };
  l1: string; cause: string;
  l2: string; todo: string;
  caveats: string[];
  route: RouteOption[];
  proof: ProofScene[];
  hash: string;
  skillId: string;
  suggested?: string[]; // skill ids for general answers
}

const S2 = (d: string, t: string) => `S2B_MSIL2A_2026${d}T172909_N0511_R055_${t}`;
const DRY_PROOF: ProofScene[] = [
  { id: S2('0814', 'T14SKG'), date: 'Aug 14', sat: 'Sentinel-2B', cloud: 2, used: true },
  { id: S2('0819', 'T14SKG'), date: 'Aug 19', sat: 'Sentinel-2A', cloud: 0, used: true },
  { id: S2('0824', 'T14SKG'), date: 'Aug 24', sat: 'Sentinel-2B', cloud: 8, used: true },
  { id: S2('0829', 'T14SKG'), date: 'Aug 29', sat: 'Sentinel-2A', cloud: 71, used: false, why: 'Cloudy' },
  { id: S2('0903', 'T14SKG'), date: 'Sep 3', sat: 'Sentinel-2B', cloud: 43, used: false, why: 'Cloudy' },
  { id: S2('0908', 'T14SKG'), date: 'Sep 8', sat: 'Sentinel-2A', cloud: 1, used: true },
  { id: S2('0913', 'T14SKG'), date: 'Sep 13', sat: 'Sentinel-2B', cloud: 4, used: false, why: '18 mm rain the day before' },
  { id: S2('0918', 'T14SKG'), date: 'Sep 18', sat: 'Sentinel-2A', cloud: 64, used: false, why: 'Cloudy' },
  { id: S2('0923', 'T14SKG'), date: 'Sep 23', sat: 'Sentinel-2B', cloud: 0, used: true },
  { id: S2('0926', 'T14SKG'), date: 'Sep 26', sat: 'Sentinel-2A', cloud: 3, used: false, why: '11 mm rain the day before' },
  { id: S2('0928', 'T14SKG'), date: 'Sep 28', sat: 'Sentinel-2A', cloud: 0, used: true },
  { id: 'LC09_L2SP_031034_20260926_02_T1', date: 'Sep 26', sat: 'Landsat 9', cloud: 5, used: true },
];

export const dryAnswer = (place: Place, ans: Record<string, string>): Answer => {
  const ha = areaHa(place.pts, place.lat);
  return {
    kind: 'place',
    color: CATS[0].color,
    eyebrow: `Agriculture · ${place.name}`,
    title: 'Dry patch of 4.6 ha in the north-east arc of the field',
    stats: [
      { l: 'Dry area', v: '4.6 ha', ci: '90% range 3.9–5.3' },
      { l: 'NDMI in zone', v: '0.12 vs 0.31', ci: '±0.03' },
      { l: 'First seen', v: 'Sep 8', ci: '± 1 pass' },
    ],
    confidence: { level: 'Medium', pct: 78, note: 'Clear signal on 5 of 7 usable passes; cause is inferred.' },
    l1: 'Likely cause: irrigation fault',
    cause: `The dry zone is a ring 260–390 m from the pivot centre, matching spans 5–6. Soil and elevation are even across it, and it got drier on 5 of 7 passes while the rest of the ${(ans.crop || 'crop').toLowerCase()} stayed steady.`,
    l2: 'What to do',
    todo: 'Check nozzles and pressure regulators on spans 5–6 and the end-gun timer. The agent will re-check every 5 days; next pass Oct 3.',
    caveats: [
      `10 m pixels blur the edge of the zone, so the area could be off by about ±0.7 ha on a ${ha} ha field.`,
      '5 of 12 passes were skipped (3 cloudy, 2 right after rain). Gaps are longest in early September.',
      'The cause is inferred from the ring shape. Pest damage or a nutrient problem can look similar — a 10-minute walk of spans 5–6 would confirm.',
      'Surface temperature comes from Landsat at 100 m, so it only supports the finding and does not size it.',
    ],
    route: [
      { sat: SATS.s2.name, status: 'chosen', why: `Free · 10 m · field is ${ha} ha, well above the 2 ha minimum` },
      { sat: SATS.l9.name, status: 'support', why: 'Free · adds surface temperature at 100 m' },
      { sat: SATS.s1.name, status: 'fallback', why: 'Free · used only if 3+ passes in a row are cloudy' },
      { sat: SATS.ps.name, status: 'skipped', why: `Paid ${SATS.ps.price} · not needed: field is large enough for 10 m` },
    ],
    proof: DRY_PROOF,
    hash: 'sha256:7f3a…c91e',
    skillId: 'dry-patch-finder',
  };
};

export const skillAnswer = (place: Place, p: Skill): Answer => {
  const c = CATS[p.cat];
  const first = p.sat.split(' · ')[0];
  return {
    kind: 'place',
    color: c.color,
    eyebrow: `${c.name} · ${place.name}`,
    title: `${p.name} is ready for ${place.name}`,
    stats: [
      { l: 'Satellite', v: first },
      { l: 'Scenes used', v: '7 of 12', ci: '5 skipped: cloud / rain' },
      { l: 'Cost', v: p.cost },
    ],
    confidence: { level: p.verified ? 'Medium' : 'Low', pct: p.verified ? 74 : 55, note: p.accuracy },
    l1: 'Summary', cause: p.short,
    l2: 'Next', todo: 'Layers are on the map. Step through the timeline to compare passes, or keep watching to re-run on each pass.',
    caveats: p.limits,
    route: [
      { sat: first, status: 'chosen', why: `${p.tier === 'paid' ? 'Paid' : 'Free'} · ${p.res} · revisit ${p.revisit}` },
      ...(p.sat.includes('·') ? [{ sat: p.sat.split(' · ')[1], status: 'support' as const, why: 'Free · second source to confirm' }] : []),
      { sat: SATS.hr.name, status: 'skipped', why: `Paid ${SATS.hr.price} · only needed below ${p.res}` },
    ],
    proof: DRY_PROOF.slice(0, 8).map((s) => ({ ...s, sat: first })),
    hash: 'sha256:2b9d…04af',
    skillId: p.id,
  };
};

export const generalAnswer = (q: string): Answer => {
  const low = q.toLowerCase();
  const flood = /flood|rain|water/.test(low);
  return {
    kind: 'general',
    color: flood ? CATS[3].color : CATS[0].color,
    eyebrow: 'General question · no place selected',
    title: flood ? 'Sentinel-1 radar is the best free source for floods' : 'Sentinel-2 is the best free starting point',
    stats: flood
      ? [{ l: 'Best free source', v: 'Sentinel-1' }, { l: 'Revisit', v: '6 days' }, { l: 'Sees through cloud', v: 'Yes' }]
      : [{ l: 'Best free source', v: 'Sentinel-2' }, { l: 'Resolution', v: '10 m' }, { l: 'Revisit', v: '5 days' }],
    confidence: { level: 'High', pct: 90, note: 'Based on published sensor specs, not on a measurement.' },
    l1: 'Short answer',
    cause: flood
      ? 'Floods usually come with cloud, which optical satellites cannot see through. Sentinel-1 radar works day and night through cloud and is free. Sentinel-2 can confirm on the next clear day.'
      : 'For most land questions Sentinel-2 gives the best mix of detail (10 m), revisit (5 days) and price (free). Landsat adds temperature; paid 3 m or 30 cm imagery is only worth it for very small areas.',
    l2: 'To get a real answer',
    todo: 'Pick a place at the top of the chat, or add a new one, and ask again. The agent will run a skill on it and show proof.',
    caveats: ['This is general guidance. No images were analysed because no place is selected.'],
    route: flood
      ? [
          { sat: SATS.s1.name, status: 'chosen', why: 'Free · radar sees through cloud' },
          { sat: SATS.s2.name, status: 'support', why: 'Free · confirms on clear days' },
          { sat: SATS.hr.name, status: 'skipped', why: `Paid ${SATS.hr.price} · for street-level damage only` },
        ]
      : [
          { sat: SATS.s2.name, status: 'chosen', why: 'Free · 10 m · 5-day revisit' },
          { sat: SATS.l9.name, status: 'support', why: 'Free · thermal band' },
          { sat: SATS.ps.name, status: 'skipped', why: `Paid ${SATS.ps.price} · for fields under 2 ha` },
        ],
    proof: [],
    hash: '',
    skillId: flood ? 'flood-extent' : 'weekly-crop-health',
    suggested: flood ? ['flood-extent', 'active-fire-map', 'ground-sinking'] : ['weekly-crop-health', 'dry-patch-finder', 'small-field-stress-3-m'],
  };
};

/** Watch builder feasibility check — "can the agent actually watch this?" */
export interface Feasibility {
  ok: boolean;
  partial?: boolean;
  title: string;
  skillId: string;
  cat: number;
  metric: string;
  condition: string;
  sat: string;
  cadence: string;
  tier: 'free' | 'paid';
  cost: string;
  confidence: 'High' | 'Medium' | 'Low';
  notes: string[];
  alternative?: string;
}

export const checkFeasibility = (text: string): Feasibility => {
  const low = text.toLowerCase();
  if (/car|people|person|license|face|count.*(cow|cattle)|individual/.test(low))
    return {
      ok: false, title: 'Not possible with satellites', skillId: '', cat: 8, metric: '', condition: '', sat: '—', cadence: '—', tier: 'free', cost: '—', confidence: 'Low',
      notes: ['Free satellites see 10 m pixels — a car or a person is smaller than one pixel.', 'Even 30 cm paid imagery cannot identify individuals, and we would not offer it.'],
      alternative: 'Watch for new buildings, roads or cleared land at this place instead',
    };
  if (/fire|smoke|burn/.test(low))
    return { ok: true, title: 'Fire near my places', skillId: 'active-fire-map', cat: 3, metric: 'Hotspots within 10 km', condition: 'Any VIIRS hotspot within 10 km', sat: 'VIIRS / FIRMS', cadence: 'Every ~12 hours', tier: 'free', cost: 'Free', confidence: 'High', notes: ['Small fires under ~1,000 m² may not be detected.', 'Alerts arrive 3–5 hours after the pass.'] };
  if (/flood/.test(low))
    return { ok: true, title: 'Flooding on my place', skillId: 'flood-extent', cat: 3, metric: 'Flooded area', condition: 'New open water above 1 ha', sat: 'Sentinel-1', cadence: 'Every 6 days', tier: 'free', cost: 'Free', confidence: 'Medium', notes: ['Radar passes every 6 days, so a short flood can be missed.', 'Wet soil after heavy rain can look like shallow water.'] };
  if (/forest|clear|deforest|tree/.test(low))
    return { ok: true, title: 'New forest clearing', skillId: 'deforestation-alerts', cat: 2, metric: 'New clearing', condition: 'Clearing above 0.5 ha', sat: 'Sentinel-1 · Sentinel-2', cadence: 'Every 6 days', tier: 'free', cost: 'Free', confidence: 'High', notes: ['Selective logging of single trees is below 10 m and usually not seen.'] };
  if (/algae|bloom|chlorophyll/.test(low))
    return { ok: true, title: 'Algae bloom near intake', skillId: 'algae-red-tide-alert', cat: 1, metric: 'Chlorophyll-a', condition: 'Bloom within 5 km', sat: 'Sentinel-3 OLCI', cadence: 'Daily', tier: 'free', cost: 'Free', confidence: 'Low', notes: ['300 m pixels — fine near open water, unreliable within ~600 m of the shore.'] };
  if (/small|garden|plot|backyard|tiny/.test(low))
    return { ok: true, partial: true, title: 'Crop stress on a small plot', skillId: 'small-field-stress-3-m', cat: 0, metric: 'Stressed area', condition: 'Stress on more than 10% of plot', sat: 'PlanetScope 3 m', cadence: 'Daily', tier: 'paid', cost: '$1.80 / km² · ~$0.40 / month', confidence: 'Medium', notes: ['Your plot is small for free 10 m data. We can watch it with free Sentinel-2 at low confidence, or with paid 3 m imagery.'] };
  return {
    ok: true, title: 'Dry patches on my field', skillId: 'dry-patch-finder', cat: 0, metric: 'Dry area', condition: 'Dry area larger than 5 ha', sat: 'Sentinel-2 · Landsat 9', cadence: 'Every Sentinel-2 pass (~5 days)', tier: 'free', cost: 'Free', confidence: 'Medium',
    notes: ['Cloudy passes are skipped; in a wet week you may wait 10+ days for an update.', 'Areas under ~0.3 ha are below what 10 m pixels can size reliably.'],
  };
};
