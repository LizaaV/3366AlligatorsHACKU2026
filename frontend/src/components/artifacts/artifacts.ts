/**
 * Artifacts: everything an answer produces that is not words.
 *
 * They are not stored anywhere of their own. They are derived, as a pure function, from the
 * conversation's turns: each turn carries the blocks of its run, and the backend already
 * persists those per run, so a reloaded thread (`threadTurns.ts`) gets the same artifacts back.
 * Ids are `${runId}:${blockId}` (plus a suffix for artifacts derived from one block), so a
 * selection survives a re-derive and a hand-off between the floating chat and the Ask page.
 */

import { layerLook } from '../place/layerNames';
import { passTimelineFrom, type AnswerBlock } from '../../model';
import type { AskTurn } from '../../ask/useAskRun';

export type ArtifactKind = 'graph' | 'image' | 'layer' | 'slider' | 'table' | 'note' | 'compare';

export interface Artifact {
  id: string;
  /** Unique within the chat; shown in the dropdown and in the references in the answer text. */
  name: string;
  kind: ArtifactKind;
  turnId: string;
  runId: string;
  /** The question of the turn that produced it. */
  question: string;
  /** The block it comes from (several artifacts can come from one block). */
  block?: AnswerBlock;
  /** All of the turn's blocks: the slider and the comparison read these. */
  blocks: AnswerBlock[];
  icon: string;
  /** For `layer`: the catalog layer id to switch on, and the date it shows if known. */
  layerId?: string;
  date?: string;
  /** True for the artifact of the answer's primary block. */
  primary: boolean;
}

export const KIND_META: Record<ArtifactKind, { label: string; icon: string }> = {
  graph: { label: 'Graphs', icon: 'show_chart' },
  image: { label: 'Images', icon: 'image' },
  layer: { label: 'Map layers', icon: 'layers' },
  slider: { label: 'Sliders', icon: 'timeline' },
  compare: { label: 'Comparisons', icon: 'compare' },
  table: { label: 'Tables', icon: 'table_chart' },
  note: { label: 'Notes', icon: 'info' },
};

export const KIND_ORDER: ArtifactKind[] = ['graph', 'image', 'layer', 'slider', 'compare', 'table', 'note'];

/** Measure names the backend uses, and the map catalog ids that draw them. */
const CATALOG_ALIAS: Record<string, string> = { greenness: 'ndvi', moisture: 'ndmi', heat: 'lst', bare: 'dry', base: 'truecolour', rgb: 'truecolour' };

/**
 * An image's `layer_id` is dated (`water-2026-09-30`), while the map's catalog ids are measure
 * names, so the layer to draw is found from the measure and the undated id.
 */
export function catalogLayerFor(layerId: string, measure: string | null | undefined, drawable?: (id: string) => boolean): string | null {
  const bare = layerId.replace(/-\d{4}-\d{2}-\d{2}$/, '');
  const candidates = [measure, bare, layerId].filter((x): x is string => !!x).flatMap((x) => [x, CATALOG_ALIAS[x]]).filter((x): x is string => !!x);
  if (!drawable) return candidates[0] ?? null;
  return candidates.find(drawable) ?? null;
}

type Draft = Omit<Artifact, 'turnId' | 'runId' | 'question' | 'blocks'>;

/**
 * `drawable` says which layer ids exist on the map (the catalog). Without it every layer id
 * a block names counts, which is what the floating chat (no map) wants for its references.
 */
export function deriveArtifacts(turns: AskTurn[], drawable?: (layerId: string) => boolean): Artifact[] {
  const out: Artifact[] = [];
  const taken = new Map<string, number>();
  const unique = (name: string) => {
    const n = (taken.get(name) ?? 0) + 1;
    taken.set(name, n);
    return n === 1 ? name : `${name} (${n})`;
  };

  for (const turn of turns) {
    if (!turn.blocks.length) continue;
    const runId = turn.runId ?? turn.id;
    const base = { turnId: turn.id, runId, question: turn.text, blocks: turn.blocks };
    // `primary` first, like the old inline rendering did.
    const ordered = [...turn.blocks].sort((a, b) => Number(b.primary) - Number(a.primary));
    const seenLayers = new Set<string>();
    const add = (d: Draft) => out.push({ ...base, ...d, name: unique(d.name) });
    const addLayer = (block: AnswerBlock, id: string, rawId: string, measure: string | null | undefined, date?: string) => {
      const layerId = catalogLayerFor(rawId, measure, drawable);
      if (!layerId || seenLayers.has(layerId)) return;
      seenLayers.add(layerId);
      const look = layerLook(layerId);
      add({ id: `${id}:layer:${layerId}`, name: `${look.label} layer`, kind: 'layer', icon: look.icon, block, layerId, date, primary: false });
    };

    for (const block of ordered) {
      const id = `${runId}:${block.id}`;
      const primary = block.primary;
      switch (block.type) {
        case 'timeline':
          add({ id, name: block.title, kind: 'graph', icon: KIND_META.graph.icon, block, primary });
          if ((passTimelineFrom([block])?.dates.length ?? 0) > 1) {
            add({ id: `${id}:passes`, name: 'Satellite passes', kind: 'slider', icon: KIND_META.slider.icon, block, primary: false });
          }
          break;
        case 'then_now':
          add({ id, name: block.title, kind: 'image', icon: KIND_META.image.icon, block, primary });
          addLayer(block, id, block.after.layer_id, block.measure, block.after.date);
          addLayer(block, id, block.before.layer_id, block.measure, block.before.date);
          break;
        case 'highlight':
          add({ id, name: block.title, kind: 'image', icon: KIND_META.image.icon, block, primary });
          if (block.base) addLayer(block, id, block.base.layer_id, block.measure, block.base.date);
          break;
        case 'scene_strip':
          add({ id, name: 'What each satellite saw', kind: 'compare', icon: KIND_META.compare.icon, block, primary });
          break;
        case 'stat':
          add({ id, name: block.title, kind: 'graph', icon: 'monitoring', block, primary });
          break;
        case 'hypotheses':
          add({ id, name: block.title, kind: 'table', icon: KIND_META.table.icon, block, primary });
          break;
        case 'limits':
          add({ id, name: block.title, kind: 'note', icon: KIND_META.note.icon, block, primary });
          break;
        default:
          break;
      }
    }
  }
  return out;
}

/** The artifact an answer's run should open with: the primary block's, else the first. */
export const primaryArtifactOf = (list: Artifact[], turnId: string): Artifact | undefined => {
  const mine = list.filter((a) => a.turnId === turnId);
  return mine.find((a) => a.primary) ?? mine[0];
};
