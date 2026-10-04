/**
 * Turn the agent's raw steps into a few plain stages for people.
 *
 * A run reads like "index, measure, index, measure, index, render, index, render…": accurate,
 * but repetitive and full of tool names. People want to know what is being done, not how many
 * times. Steps are grouped into at most six stages in a fixed order, repeated work is merged
 * (four `index` steps become "Measured greenness, water, bare ground and moisture"), and
 * wrapper steps (`run_code`, `run_skill`) are not shown at all. The raw list stays available
 * behind "Technical details".
 */

import type { RunStep } from '../model';

export interface Stage {
  key: StageKey;
  icon: string;
  /** What is being done (while running) or was done (when finished). */
  label: string;
  /** One short line of what came out, when there is something worth saying. */
  detail: string | null;
  done: boolean;
  error: boolean;
}

type StageKey = 'place' | 'causes' | 'passes' | 'measure' | 'maps' | 'check';

const STAGE_OF: Record<string, StageKey | null> = {
  describe: 'place',
  lookup_place: 'place',
  weather: 'place',
  read_card: 'causes',
  register_hypotheses: 'causes',
  scenes: 'passes',
  load: 'measure',
  index: 'measure',
  measure: 'measure',
  series: 'measure',
  compare: 'measure',
  surroundings: 'measure',
  fires: 'measure',
  render: 'maps',
  finish: 'check',
  ask_user: 'check',
  run_code: null, // wrappers: their inner steps are what matter
  run_skill: null,
};

const META: Record<StageKey, { icon: string; doing: string; done: string }> = {
  place: { icon: 'location_on', doing: 'Looking at the place', done: 'Looked at the place' },
  causes: { icon: 'lightbulb', doing: 'Listing what could explain it', done: 'Listed what could explain it' },
  passes: { icon: 'satellite_alt', doing: 'Finding clear satellite passes', done: 'Found clear satellite passes' },
  measure: { icon: 'query_stats', doing: 'Measuring', done: 'Measured' },
  maps: { icon: 'map', doing: 'Drawing maps', done: 'Drew maps' },
  check: { icon: 'verified', doing: 'Checking the answer', done: 'Checked the answer' },
};
const ORDER: StageKey[] = ['place', 'causes', 'passes', 'measure', 'maps', 'check'];

const MEASURE_WORDS: Record<string, string> = {
  greenness: 'greenness',
  moisture: 'moisture',
  water: 'water',
  bare: 'bare ground',
  burn: 'burn scars',
  roughness: 'surface roughness',
  heat: 'surface heat',
};

const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** The tool a step ran. Steps carry it as `tool` (falling back to the title). */
const toolOf = (s: RunStep) => (s.tool || '').toLowerCase();

export function stagesFrom(steps: RunStep[], running: boolean): Stage[] {
  const groups = new Map<StageKey, RunStep[]>();
  for (const s of steps) {
    const k = STAGE_OF[toolOf(s)];
    if (k === null) continue;
    const key = k ?? 'measure'; // unknown earth calls are measurements of some kind
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return ORDER.filter((k) => groups.has(k)).map((k) => {
    const g = groups.get(k)!;
    const done = g.every((s) => s.done) && !(running && k === lastKey(steps));
    const error = g.some((s) => !!s.error);
    let label = done ? META[k].done : META[k].doing;
    let detail: string | null = null;
    if (k === 'measure') {
      const found = new Set<string>();
      for (const s of g) {
        const m = /(greenness|moisture|water|bare|burn|roughness|heat)/i.exec(`${s.result ?? ''} ${s.title}`);
        if (m) found.add(MEASURE_WORDS[m[1].toLowerCase()]);
      }
      if (found.size) label = `${done ? 'Measured' : 'Measuring'} ${list([...found])}`;
      const series = g.find((s) => toolOf(s) === 'series' && s.result);
      if (series) detail = series.result;
    } else if (k === 'passes') {
      detail = g.map((s) => s.result).filter(Boolean).pop() ?? null;
    } else if (k === 'place') {
      detail = g.find((s) => toolOf(s) === 'describe')?.result ?? null;
    } else if (k === 'maps') {
      const n = g.filter((s) => s.done).length;
      if (n > 1) detail = `${n} maps`;
    } else if (k === 'check' && error) {
      detail = 'Some wording was corrected before the answer was shown.';
    }
    return { key: k, icon: META[k].icon, label, detail, done, error: error && k !== 'check' };
  });
}

/** The stage of the newest step: the one in progress while the run streams. */
function lastKey(steps: RunStep[]): StageKey | null {
  for (let i = steps.length - 1; i >= 0; i--) {
    const k = STAGE_OF[toolOf(steps[i])];
    if (k === null) continue;
    return k ?? 'measure';
  }
  return null;
}
