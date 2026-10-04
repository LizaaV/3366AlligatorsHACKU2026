/**
 * Suggested questions that fit the place in focus.
 *
 * Built from what is actually there: the place's own tags and category (what the person said
 * it is), then the land cover the backend measured under the outline (ESA WorldCover shares
 * from `POST /api/areas/context`). A park gets park questions, ponds get pond questions, a
 * city block gets construction and heat questions. Every suggestion is something the agent
 * can answer from free satellite data.
 */

export interface Suggestion {
  icon: string;
  text: string;
  /** The skill that answers it directly, when one exists. */
  skillId?: string;
}

/** What a place is, as far as the suggestions are concerned. */
type Kind = 'ponds' | 'water' | 'park' | 'forest' | 'farm' | 'built' | 'bare' | 'mixed';

const QUESTIONS: Record<Kind, Suggestion[]> = {
  ponds: [
    { icon: 'water', text: 'Have these ponds been filled in?', skillId: 'pond-filling-check' },
    { icon: 'water_drop', text: 'Is there less open water here than last year?' },
    { icon: 'history', text: 'When did the water start to change?' },
  ],
  water: [
    { icon: 'water_drop', text: 'Is there less open water here than last year?' },
    { icon: 'waves', text: 'Is the water level normal for this time of year?' },
    { icon: 'history', text: 'Has the shoreline changed since 2022?' },
  ],
  park: [
    { icon: 'park', text: 'Is this park as green as it was last summer?' },
    { icon: 'forest', text: 'Has any tree cover been lost here since 2022?' },
    { icon: 'water_drop', text: 'Is the grass drier than usual for this time of year?' },
  ],
  forest: [
    { icon: 'forest', text: 'Has any forest been cleared here since 2022?' },
    { icon: 'local_fire_department', text: 'Are there any burn scars here?' },
    { icon: 'eco', text: 'Is the canopy as green as it was last year?' },
  ],
  farm: [
    { icon: 'agriculture', text: 'How healthy are the crops this season?' },
    { icon: 'water_drop', text: 'Is any part of this field drier than the rest?' },
    { icon: 'history', text: 'Has this land been farmed every year since 2020?' },
  ],
  built: [
    { icon: 'apartment', text: 'Has anything new been built here since 2022?' },
    { icon: 'park', text: 'Has green space been lost here in the last few years?' },
    { icon: 'thermostat', text: 'Is this area hotter than its surroundings?' },
  ],
  bare: [
    { icon: 'construction', text: 'Is this land being cleared or built on?' },
    { icon: 'history', text: 'When did the ground here become bare?' },
    { icon: 'eco', text: 'Is any vegetation coming back?' },
  ],
  mixed: [
    { icon: 'history', text: 'What has changed here in the last year?' },
    { icon: 'apartment', text: 'Has anything been built here since 2022?' },
    { icon: 'water_drop', text: 'Is there less water or greenery here than last year?' },
  ],
};

/** While nothing is known yet: questions that make sense anywhere. */
export const GENERAL: Suggestion[] = QUESTIONS.mixed;

const has = (tags: string[], ...words: string[]) => tags.some((t) => words.some((w) => t.toLowerCase().includes(w)));

/** What the words say the place is, if anything. */
function kindFromWords(words: string[]): Kind | null {
  if (has(words, 'pond', 'fishpond', 'wetland')) return 'ponds';
  if (has(words, 'building site', 'construction')) return 'built';
  if (has(words, 'park', 'garden', 'common')) return 'park';
  if (has(words, 'forest', 'wood')) return 'forest';
  if (has(words, 'field', 'farm', 'crop', 'plot', 'pivot')) return 'farm';
  if (has(words, 'site')) return 'built';
  return null;
}

/** The best-fitting kind: the person's own tags first, then the name (a tag says what the place
 * is, while a name can mislead: "Kai Tak Sports Park" is a building site), then the measured
 * land cover. */
export function kindOf(input: { name?: string; categoryKey?: string; tags?: string[]; landCover?: Record<string, number> | null }): Kind {
  const worded = kindFromWords(input.tags ?? []) ?? kindFromWords([input.name ?? '']);
  if (worded) return worded;

  const lc = input.landCover ?? {};
  const v = (k: string) => lc[k] ?? 0;
  const green = v('trees') + v('grassland') + v('shrubland');
  const water = v('water') + v('wetland') + v('mangroves');
  if (Object.keys(lc).length) {
    if (water >= 0.3) return v('wetland') >= 0.1 || input.categoryKey === 'water' ? 'ponds' : 'water';
    if (v('cropland') >= 0.35) return 'farm';
    if (v('trees') >= 0.6 && v('built') < 0.1) return 'forest';
    if (green >= 0.5) return v('built') >= 0.05 ? 'park' : 'forest';
    if (v('built') >= 0.4) return 'built';
    if (v('bare') >= 0.3) return 'bare';
    return 'mixed';
  }
  switch (input.categoryKey) {
    case 'water':
      return 'water';
    case 'forests':
      return 'forest';
    case 'agriculture':
      return 'farm';
    case 'urban':
      return 'built';
    default:
      return 'mixed';
  }
}

export function suggestionsFor(input: Parameters<typeof kindOf>[0]): Suggestion[] {
  return QUESTIONS[kindOf(input)];
}

/** "55% trees · 25% grassland · 12% built": the top land-cover shares, in plain words. */
export function landCoverLine(lc: Record<string, number> | null | undefined, n = 3): string | null {
  const words: Record<string, string> = { snow_ice: 'snow and ice', moss_lichen: 'moss', bare: 'bare ground' };
  const top = Object.entries(lc ?? {})
    .filter(([, v]) => v >= 0.03)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
  return top.length ? top.map(([k, v]) => `${Math.round(v * 100)}% ${words[k] ?? k}`).join(' · ') : null;
}
