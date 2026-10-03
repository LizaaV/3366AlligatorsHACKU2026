/**
 * Answer blocks — the visuals a run produces.
 *
 * Blocks arrive as `block_ready` events while the run streams and again on the finished
 * `answer` (`docs/API.md` §6). This renders whichever types are present, in the order the
 * server sent them, with the `primary` one first — at most one block is primary, and it is the
 * one the answer is really about.
 *
 * The dispatch is exhaustive on `type`: a block type added to the contract later will fail the
 * type-check here rather than silently disappearing from the page.
 */

import { ThenNowBlock } from './ThenNowBlock';
import { TimelineBlock } from './TimelineBlock';
import { SceneStripBlock } from './SceneStripBlock';
import { HighlightBlock } from './HighlightBlock';
import { HypothesesBlock } from './HypothesesBlock';
import { StatBlock } from './StatBlock';
import { LimitsBlock } from './LimitsBlock';
import type { AnswerBlock } from '../../model';

export function AnswerBlocks({
  blocks,
  onPickScene,
  onShowOnMap,
}: {
  blocks: AnswerBlock[];
  /** Move the shared time cursor; wired by whoever owns the map. */
  onPickScene?: (scene: string) => void;
  /** Put a block's rendered layer on the map (by measure / layer key); only where a map exists. */
  onShowOnMap?: (layerKey: string) => void;
}) {
  if (!blocks.length) return null;
  // `primary` first, otherwise server order — which is the order they were produced in.
  const ordered = [...blocks].sort((a, b) => Number(b.primary) - Number(a.primary));
  return (
    <div className="col" style={{ gap: 10 }}>
      {ordered.map((block) => (
        <Block key={block.id} block={block} onPickScene={onPickScene} onShowOnMap={onShowOnMap} />
      ))}
    </div>
  );
}

function Block({ block, onPickScene, onShowOnMap }: { block: AnswerBlock; onPickScene?: (scene: string) => void; onShowOnMap?: (layerKey: string) => void }) {
  switch (block.type) {
    case 'then_now':
      return <ThenNowBlock block={block} onShowOnMap={onShowOnMap} />;
    case 'timeline':
      return <TimelineBlock block={block} onPickScene={onPickScene} />;
    case 'scene_strip':
      return <SceneStripBlock block={block} />;
    case 'highlight':
      return <HighlightBlock block={block} />;
    case 'hypotheses':
      return <HypothesesBlock block={block} />;
    case 'stat':
      return <StatBlock block={block} />;
    case 'limits':
      return <LimitsBlock block={block} />;
    default:
      return assertNever(block);
  }
}

/** Compile-time proof that every block type in the contract is handled. */
function assertNever(block: never): null {
  void block;
  return null;
}
