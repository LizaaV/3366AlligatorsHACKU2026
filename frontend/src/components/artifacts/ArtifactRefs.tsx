/** Reference chips and in-text references: how the words-only chat points at its artifacts. */

import { Fragment, type ReactNode } from 'react';
import { Ms } from '../ui';
import { useArtifacts } from './ArtifactsContext';
import type { Artifact } from './artifacts';

export function ArtifactChip({ artifact }: { artifact: Artifact }) {
  const { select, selectedId } = useArtifacts();
  return (
    <button
      type="button"
      className={`chip artifact-chip${selectedId === artifact.id ? ' on' : ''}`}
      onClick={() => select(artifact.id)}
      title={`Show “${artifact.name}”`}
    >
      <Ms n={artifact.icon} />
      {artifact.name}
    </button>
  );
}

/** "See: " and one chip per artifact the turn produced. */
export function ArtifactRefs({ turnId }: { turnId: string }) {
  const { artifacts } = useArtifacts();
  const mine = artifacts.filter((a) => a.turnId === turnId);
  if (!mine.length) return null;
  return (
    <div className="row wrap" style={{ gap: 6 }}>
      <span className="eyebrow">See:</span>
      {mine.map((a) => <ArtifactChip key={a.id} artifact={a} />)}
    </div>
  );
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Text in which an artifact's name, if it appears verbatim, becomes a clickable reference. */
export function LinkedText({ text, turnId }: { text: string; turnId: string }): ReactNode {
  const { artifacts, select } = useArtifacts();
  const mine = artifacts.filter((a) => a.turnId === turnId).sort((a, b) => b.name.length - a.name.length);
  if (!mine.length || !text) return text;
  const re = new RegExp(`(${mine.map((a) => escape(a.name)).join('|')})`, 'g');
  return (
    <>
      {text.split(re).map((part, i) => {
        const hit = i % 2 === 1 ? mine.find((a) => a.name === part) : undefined;
        return hit ? (
          <button key={i} type="button" className="artifact-ref" onClick={() => select(hit.id)} title="Show on the right">
            {part}
          </button>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        );
      })}
    </>
  );
}
