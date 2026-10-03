/**
 * `limits`: the "can't" and "won't" answer.
 *
 * This block is the product's refusal surface — it arrives when the agent declines a question
 * (`guard` scope `not_allowed`) or genuinely cannot see the answer from orbit. It is rendered
 * as a first-class result, not an error: "who filled the pond in and whether it was permitted"
 * is a real limit of satellite imagery, and saying so plainly is the honest answer.
 *
 * `actions` are the routes forward the backend judged viable; `kind` picks the icon. They are
 * presented as information rather than buttons — none of them is a thing the frontend can
 * perform on its own.
 */

import { BlockFrame } from './BlockFrame';
import { Ms } from '../ui';
import type { components } from '../../api/schema';

type S = components['schemas'];

const ACTION_ICON: Record<S['LimitAction']['kind'], string> = {
  radar: 'radar',
  wait: 'schedule',
  enlarge: 'zoom_out_map',
  expert: 'support_agent',
  other: 'arrow_forward',
};

export function LimitsBlock({ block }: { block: S['LimitsBlock'] }) {
  return (
    <BlockFrame title={block.title} caption={block.caption} primary={block.primary} provenance={block.provenance}>
      <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
        <Ms n="do_not_disturb_on" size={16} className="muted" style={{ marginTop: 2 }} />
        <span className="body-sm" style={{ fontSize: 13, lineHeight: 1.6 }}>{block.cant_tell}</span>
      </div>

      {block.actions.length > 0 && (
        <div className="col" style={{ gap: 6 }}>
          <span className="eyebrow">What could help</span>
          {block.actions.map((a) => (
            <span key={`${a.kind}-${a.label}`} className="row tiny" style={{ gap: 8 }}>
              <Ms n={ACTION_ICON[a.kind]} size={14} className="muted" />
              <span>{a.label}</span>
            </span>
          ))}
        </div>
      )}

      {block.contacts.length > 0 && (
        <div className="col" style={{ gap: 4 }}>
          <span className="eyebrow">Who can tell you</span>
          {block.contacts.map((c) => <span key={c} className="tiny">{c}</span>)}
        </div>
      )}

      {block.rule_id && (
        <span className="tiny muted" style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
          rule: {block.rule_id}
        </span>
      )}
    </BlockFrame>
  );
}
