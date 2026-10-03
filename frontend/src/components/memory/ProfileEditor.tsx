/**
 * Editable key/value profile, shared by "What the agent knows about this place" and "About you".
 *
 * The backend merges keys and never deletes them, so saved rows can be edited but not removed;
 * rows you add here and have not saved yet can be dropped. Limits mirror `schemas/memory.py`:
 * at most 30 keys per save, key up to 40 characters, value up to 300.
 */

import { useEffect, useMemo, useState } from 'react';
import { toApiError } from '../../api';
import { Btn, IconBtn } from '../ui';

export const MAX_PATCH_KEYS = 30;
export const MAX_TOTAL_KEYS = 50;
export const MAX_KEY = 40;
export const MAX_VALUE = 300;

export interface ProfileRow {
  key: string;
  value: string;
  /** ISO date the agent learned it, when known. */
  saved?: string;
}

interface NewRow { id: number; key: string; value: string }

export function ProfileEditor({ rows, onSave, emptyHint, keyPlaceholder = 'e.g. crop', valuePlaceholder = 'e.g. Maize' }: {
  rows: ProfileRow[];
  onSave: (patch: Record<string, string>) => Promise<void>;
  emptyHint: string;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [added, setAdded] = useState<NewRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextId, setNextId] = useState(1);

  // New data from the server replaces whatever was being edited.
  useEffect(() => { setDrafts({}); setAdded([]); }, [rows]);

  const { patch, problem } = useMemo(() => {
    const patch: Record<string, string> = {};
    let problem: string | null = null;
    for (const r of rows) {
      const d = drafts[r.key];
      if (d === undefined || d === r.value) continue;
      if (!d.trim()) { problem = `“${r.key}” cannot be blank — the agent keeps saved facts, so overwrite it instead.`; continue; }
      patch[r.key] = d.trim();
    }
    for (const n of added) {
      const k = n.key.trim(), v = n.value.trim();
      if (!k && !v) continue;
      if (!k || !v) { problem = 'Each new row needs both a name and a value.'; continue; }
      if (k.includes(':')) { problem = 'Names cannot contain a colon.'; continue; }
      patch[k] = v;
    }
    const existing = new Set(rows.map((r) => r.key));
    if (Object.keys(patch).length > MAX_PATCH_KEYS) problem = `Save at most ${MAX_PATCH_KEYS} changes at a time.`;
    else if (new Set([...existing, ...Object.keys(patch)]).size > MAX_TOTAL_KEYS) problem = `At most ${MAX_TOTAL_KEYS} entries in total.`;
    return { patch, problem };
  }, [rows, drafts, added]);

  const count = Object.keys(patch).length;
  const save = async () => {
    setBusy(true);
    setError(null);
    try { await onSave(patch); }
    catch (err) { setError(toApiError(err).userMessage); }
    finally { setBusy(false); }
  };

  return (
    <div className="col" style={{ gap: 10 }}>
      {rows.length === 0 && added.length === 0 && <div className="caption muted">{emptyHint}</div>}

      {rows.map((r) => (
        <div key={r.key} className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
          <div className="col" style={{ width: 150, flex: 'none', paddingTop: 10 }}>
            <span style={{ font: '600 13px/1.3 var(--font)', wordBreak: 'break-word' }}>{r.key}</span>
            {r.saved && <span className="tiny">Saved {r.saved}</span>}
          </div>
          <input className="input grow" aria-label={`Value for ${r.key}`} maxLength={MAX_VALUE} value={drafts[r.key] ?? r.value} onChange={(e) => setDrafts((d) => ({ ...d, [r.key]: e.target.value }))} />
        </div>
      ))}

      {added.map((n) => (
        <div key={n.id} className="row" style={{ gap: 8 }}>
          <input className="input" style={{ width: 150, flex: 'none' }} aria-label="New name" maxLength={MAX_KEY} placeholder={keyPlaceholder} value={n.key} onChange={(e) => setAdded((a) => a.map((x) => (x.id === n.id ? { ...x, key: e.target.value } : x)))} />
          <input className="input grow" aria-label="New value" maxLength={MAX_VALUE} placeholder={valuePlaceholder} value={n.value} onChange={(e) => setAdded((a) => a.map((x) => (x.id === n.id ? { ...x, value: e.target.value } : x)))} />
          <IconBtn icon="close" className="sm" aria-label="Remove this row" onClick={() => setAdded((a) => a.filter((x) => x.id !== n.id))} />
        </div>
      ))}

      <div className="row wrap" style={{ gap: 8, justifyContent: 'space-between' }}>
        <Btn size="sm" icon="add" onClick={() => { setAdded((a) => [...a, { id: nextId, key: '', value: '' }]); setNextId((i) => i + 1); }}>Add a fact</Btn>
        <Btn variant="primary" size="sm" disabled={busy || count === 0 || !!problem} onClick={save}>{busy ? 'Saving…' : count ? `Save ${count} change${count === 1 ? '' : 's'}` : 'Save'}</Btn>
      </div>
      {(problem || error) && <div className="caption" role="alert" style={{ color: 'var(--coral)' }}>{error ?? problem}</div>}
    </div>
  );
}

export const rowsOf = (profile: Record<string, string | { value: string; saved: string }> | undefined): ProfileRow[] =>
  Object.entries(profile ?? {}).map(([key, v]) => (typeof v === 'string' ? { key, value: v } : { key, value: v.value, saved: v.saved }));
