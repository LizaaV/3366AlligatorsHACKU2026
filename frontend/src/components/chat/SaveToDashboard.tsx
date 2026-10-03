/**
 * "Save to dashboard" on a finished answer: pick a dashboard (or make one) and every visual of
 * that run is copied onto it, with the run's script so each block can be refreshed later.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, toApiError } from '../../api';
import { useStore } from '../../state/store';
import { Ms } from '../ui';

export function SaveToDashboard({ runId, blockIds }: { runId: string; blockIds: string[] }) {
  const { notify, go } = useStore();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState<{ id: string; name: string }[] | null>(null);
  const [name, setName] = useState('');
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    api.dashboards.list().then((l) => live && setList(l.map((d) => ({ id: d.id, name: d.name })))).catch(() => live && setList([]));
    const away = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => { live = false; document.removeEventListener('mousedown', away); };
  }, [open]);

  const save = useCallback(async (dashboard: { id: string; name: string }) => {
    setBusy(true);
    let saved = 0;
    let lastError: string | null = null;
    for (const blockId of blockIds) {
      try {
        await api.dashboards.addBlock(dashboard.id, runId, blockId);
        saved++;
      } catch (err) {
        lastError = toApiError(err).userMessage;
      }
    }
    setBusy(false);
    setOpen(false);
    if (saved) notify(`Saved ${saved} ${saved === 1 ? 'visual' : 'visuals'} to ${dashboard.name}`, 'Open', () => go('dashboard', dashboard.id), 'dashboard');
    else notify(lastError ?? 'Nothing could be saved', undefined, undefined, 'error');
  }, [blockIds, runId, notify, go]);

  const createAndSave = async () => {
    const n = name.trim();
    if (!n) return;
    try {
      const d = await api.dashboards.create(n);
      setName('');
      await save({ id: d.id, name: d.name });
    } catch (err) {
      notify(toApiError(err).userMessage, undefined, undefined, 'error');
    }
  };

  return (
    <div ref={wrap} style={{ position: 'relative', alignSelf: 'flex-start' }}>
      <button className="btn btn-text btn-sm" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} disabled={busy}>
        <Ms n="dashboard_customize" />{busy ? 'Saving…' : 'Save to dashboard'}
      </button>
      {open && (
        <div className="menu" role="menu" style={{ left: 0, bottom: 'calc(100% + 6px)', width: 260 }}>
          <div className="menu-label eyebrow">Save these visuals to</div>
          {list === null && <div className="caption" style={{ padding: '6px 10px' }}>Loading…</div>}
          {list?.map((d) => (
            <button key={d.id} className="menu-item" onClick={() => void save(d)}><Ms n="dashboard" />{d.name}</button>
          ))}
          {list && !list.length && <div className="caption" style={{ padding: '6px 10px' }}>No dashboards yet. Name one below.</div>}
          <div className="divider" style={{ margin: '6px 4px' }} />
          <form className="row" style={{ gap: 6, padding: '4px 6px' }} onSubmit={(e) => { e.preventDefault(); void createAndSave(); }}>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="New dashboard" aria-label="New dashboard name" style={{ flex: 1, minWidth: 0, height: 32 }} />
            <button className="btn btn-ghost btn-sm" type="submit" disabled={!name.trim()}>Create</button>
          </form>
        </div>
      )}
    </div>
  );
}
