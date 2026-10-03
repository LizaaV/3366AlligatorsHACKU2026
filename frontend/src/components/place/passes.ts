/**
 * Pure helpers: flatten a finished answer's blocks into one list of satellite passes.
 *
 * A pass can show up in several blocks (the scene strip, the timeline, the then/now images and
 * the provenance receipts). They are merged by scene id so each pass is listed once, keeping
 * the most specific facts any block gave about it.
 */

import type { AnswerBlock } from '../../model';

export interface Pass {
  scene: string;
  /** ISO day. */
  date: string;
  /** Sensor group, e.g. "Sentinel-2". */
  satellite: string;
  /** Cloud over the area, 0..1, or null when no block said. */
  cloud: number | null;
  /** Whether the agent used this pass for its decision. */
  used: boolean;
  /** Why it was left out, when it was. */
  why: string | null;
  /** Server-rendered image for this pass, when a block carried one. */
  imageUrl: string | null;
  /** Measures a block rendered for this pass (then_now.measure, timeline.measure). */
  measures: string[];
}

/** Best-effort sensor group from a scene id such as `S2A_20260930` or `LC09_...`. */
export function satelliteFromScene(scene: string): string {
  const s = scene.toUpperCase();
  if (s.startsWith('S2')) return 'Sentinel-2';
  if (s.startsWith('S1')) return 'Sentinel-1 radar';
  if (s.startsWith('S3')) return 'Sentinel-3';
  if (s.startsWith('LC') || s.startsWith('LE') || s.startsWith('LT') || s.startsWith('LO')) return 'Landsat';
  return 'Other satellite';
}

/** "Sentinel-2A", "Sentinel-2 L2A" -> "Sentinel-2", so passes from one family group together. */
export function satelliteFamily(name: string): string {
  const n = name.trim();
  const sent = /sentinel[-\s]?(\d)/i.exec(n);
  if (sent) return sent[1] === '1' ? 'Sentinel-1 radar' : `Sentinel-${sent[1]}`;
  if (/landsat/i.test(n)) return 'Landsat';
  return n || 'Other satellite';
}

const CLEAN_ENOUGH = 0.5;

export function collectPasses(blocks: AnswerBlock[]): Pass[] {
  const map = new Map<string, Pass>();
  /** Scenes whose used/unused verdict came from a scene strip, which is authoritative. */
  const decided = new Set<string>();

  const get = (scene: string, date: string): Pass => {
    let p = map.get(scene);
    if (!p) {
      p = { scene, date, satellite: satelliteFromScene(scene), cloud: null, used: false, why: null, imageUrl: null, measures: [] };
      map.set(scene, p);
    }
    return p;
  };
  const addMeasure = (p: Pass, m: string | null | undefined) => {
    if (m && !p.measures.includes(m)) p.measures.push(m);
  };

  for (const b of blocks) {
    for (const pr of b.provenance ?? []) {
      const p = get(pr.scene, pr.date);
      p.satellite = satelliteFamily(pr.satellite);
      p.cloud ??= pr.cloud_over_area;
      if (!decided.has(pr.scene)) p.used = true;
    }
    if (b.type === 'scene_strip') {
      for (const s of b.scenes) {
        const p = get(s.scene, s.date);
        p.satellite = satelliteFamily(s.satellite);
        p.cloud = s.cloud;
        p.used = s.used;
        p.why = s.why ?? null;
        decided.add(s.scene);
      }
    } else if (b.type === 'timeline') {
      for (const pt of b.data) {
        const p = get(pt.scene, pt.date);
        p.cloud ??= 1 - Math.min(1, Math.max(0, pt.clean_px));
        // Being plotted is not the same as being trusted: only clean-enough points were used.
        if (pt.clean_px >= CLEAN_ENOUGH && !decided.has(pt.scene)) p.used = true;
        addMeasure(p, b.measure);
      }
    } else if (b.type === 'then_now') {
      for (const img of [b.before, b.after]) {
        const p = get(img.scene, img.date);
        p.imageUrl = img.url;
        if (!decided.has(img.scene)) p.used = true;
        addMeasure(p, b.measure);
      }
    } else if (b.type === 'highlight' && b.base) {
      const p = get(b.base.scene, b.base.date);
      p.imageUrl ??= b.base.url;
      p.used = true;
    }
  }

  return [...map.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export function groupBySatellite(passes: Pass[]): { satellite: string; passes: Pass[] }[] {
  const groups = new Map<string, Pass[]>();
  for (const p of passes) groups.set(p.satellite, [...(groups.get(p.satellite) ?? []), p]);
  return [...groups.entries()]
    .map(([satellite, list]) => ({ satellite, passes: list }))
    .sort((a, b) => a.satellite.localeCompare(b.satellite));
}

/** The kinds of picture offered for a pass, in plain words. `measure` null = real photo. */
export const VIEWS: { id: string; label: string; measure: string | null }[] = [
  { id: 'true', label: 'True colour', measure: null },
  { id: 'plants', label: 'Plant health', measure: 'greenness' },
  { id: 'moisture', label: 'Moisture', measure: 'moisture' },
  { id: 'heat', label: 'Heat', measure: 'heat' },
  { id: 'water', label: 'Water', measure: 'water' },
];

export const layerPngUrl = (apiBase: string, runId: string, measure: string, scene: string) =>
  `${apiBase}/layers/${encodeURIComponent(runId)}/${encodeURIComponent(measure)}/${encodeURIComponent(scene)}.png`;
