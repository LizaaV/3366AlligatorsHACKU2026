/**
 * Edit a saved place (PATCH /api/places/{id}) and see what the agent remembers about it
 * (GET/PATCH /api/places/{id}/memory). Two tabs: Details and Memory.
 */

import { useCallback, useMemo, useState } from 'react';
import { api, toApiError } from '../api';
import type { PlaceMemory } from '../api/endpoints/places';
import { useStore } from '../state/store';
import { useResource } from '../hooks/useResource';
import { ErrorState, Skeleton } from '../components/async';
import { Btn, Modal, ModalHead } from '../components/ui';
import { ProfileEditor, rowsOf } from '../components/memory/ProfileEditor';
import type { Place } from '../model';

const NEW_PROJECT = '__new';
const NOTE_MAX = 1000;

function DetailsTab({ place }: { place: Place }) {
  const { places, categories, updatePlace, close, notify } = useStore();
  const projects = useMemo(() => Array.from(new Set(places.map((p) => p.project.trim()).filter(Boolean))), [places]);
  const [name, setName] = useState(place.name);
  const [categoryKey, setCategoryKey] = useState<string>(place.categoryKey);
  const [project, setProject] = useState(place.project.trim());
  const [newProject, setNewProject] = useState('');
  const [tags, setTags] = useState(place.tags.join(', '));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const projectValue = project === NEW_PROJECT ? newProject.trim() : project;
  const tagList = tags.split(',').map((t) => t.trim()).filter(Boolean);
  const changed = {
    name: name.trim() !== place.name,
    categoryKey: categoryKey !== place.categoryKey,
    project: projectValue !== place.project.trim(),
    tags: tagList.join('\n') !== place.tags.join('\n'),
  };
  const dirty = Object.values(changed).some(Boolean);
  const valid = name.trim().length > 0 && (project !== NEW_PROJECT || newProject.trim().length > 0);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await updatePlace(place.id, {
        ...(changed.name ? { name: name.trim() } : {}),
        ...(changed.categoryKey ? { categoryKey } : {}),
        ...(changed.project ? { project: projectValue } : {}),
        ...(changed.tags ? { tags: tagList } : {}),
      });
      notify(`${name.trim()} updated`, undefined, undefined, 'check_circle');
      close();
    } catch (err) {
      setError(toApiError(err).userMessage);
      setBusy(false);
    }
  };

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row wrap" style={{ gap: 12 }}>
        <label className="field" style={{ flex: '1 1 240px' }}>
          Name
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label className="field" style={{ flex: '1 1 200px' }}>
          Project
          <select className="input" value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">My places</option>
            {projects.map((p) => <option key={p} value={p}>{p}</option>)}
            <option value={NEW_PROJECT}>New project…</option>
          </select>
        </label>
      </div>
      {project === NEW_PROJECT && (
        <label className="field">
          New project name
          <input className="input" value={newProject} onChange={(e) => setNewProject(e.target.value)} placeholder="e.g. Nakuru dairy co-op" autoFocus />
        </label>
      )}
      <div className="field">
        Category
        <div className="row wrap" style={{ gap: 6 }}>
          {categories.map((c) => (
            <button key={c.key} className={`chip ${categoryKey === c.key ? 'on' : ''}`} onClick={() => setCategoryKey(c.key)} aria-pressed={categoryKey === c.key}>
              <span className="dot" style={{ background: c.color }} />
              {c.name}
            </button>
          ))}
        </div>
      </div>
      <label className="field">
        Tags <span className="tiny">Comma separated</span>
        <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="e.g. Maize, Drip irrigation" />
      </label>
      {error && <div className="caption" role="alert" style={{ color: 'var(--coral)' }}>{error}</div>}
      <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
        <Btn onClick={close}>Cancel</Btn>
        <Btn variant="primary" disabled={busy || !dirty || !valid} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</Btn>
      </div>
    </div>
  );
}

function MemoryTab({ place }: { place: Place }) {
  const { notify } = useStore();
  const res = useResource(useCallback((signal) => api.places.memory(place.id, signal), [place.id]), [place.id]);
  const [local, setLocal] = useState<PlaceMemory | null>(null);
  const mem = local ?? res.data;
  const rows = useMemo(() => rowsOf(mem?.profile), [mem]);
  const [note, setNote] = useState('');
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  const saveProfile = async (patch: Record<string, string>) => {
    setLocal(await api.places.patchMemory(place.id, { profile: patch }));
    notify(`Saved to ${place.name}'s memory`, undefined, undefined, 'check_circle');
  };

  const addNote = async () => {
    setNoteBusy(true);
    setNoteError(null);
    try {
      setLocal(await api.places.patchMemory(place.id, { note: note.trim() }));
      setNote('');
    } catch (err) {
      setNoteError(toApiError(err).userMessage);
    } finally {
      setNoteBusy(false);
    }
  };

  return (
    <div className="col" style={{ gap: 18 }}>
      <div className="caption muted">What the agent knows about this place. It is private to you and is given to the agent whenever you ask about {place.name}.</div>
      {res.isLoading && <Skeleton lines={5} h={14} />}
      {res.error && <ErrorState error={res.error} onRetry={res.refetch} title="Could not load this place's memory" />}
      {mem && (
        <>
          <section className="col" style={{ gap: 8 }}>
            <div className="eyebrow">Facts</div>
            <ProfileEditor rows={rows} onSave={saveProfile} emptyHint="No facts yet. Add what the agent should assume, such as the crop or the irrigation type." keyPlaceholder="e.g. crop" valuePlaceholder="e.g. Maize" />
          </section>

          <section className="col" style={{ gap: 8 }}>
            <div className="eyebrow">Notes</div>
            {(mem.notes ?? []).length === 0 && <div className="caption muted">No notes yet.</div>}
            {(mem.notes ?? []).map((n, i) => (
              <div key={`${n.date}-${i}`} className="well" style={{ padding: '8px 12px' }}>
                <div className="tiny">{n.date}</div>
                <div className="body-sm" style={{ whiteSpace: 'pre-wrap' }}>{n.text}</div>
              </div>
            ))}
            <textarea className="input" aria-label="New note" value={note} maxLength={NOTE_MAX} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Replanted the north third after the hail" />
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="tiny">{note.length}/{NOTE_MAX}</span>
              <Btn size="sm" icon="add" disabled={noteBusy || !note.trim()} onClick={addNote}>{noteBusy ? 'Adding…' : 'Add note'}</Btn>
            </div>
            {noteError && <div className="caption" role="alert" style={{ color: 'var(--coral)' }}>{noteError}</div>}
          </section>

          <section className="col" style={{ gap: 8 }}>
            <div className="eyebrow">Saved answers</div>
            {(mem.insights ?? []).length === 0 && <div className="caption muted">Nothing saved yet. Use “Remember this” under an answer about {place.name}.</div>}
            {/* Read-only. Newest first. An insight carries a run id but no thread, so there is nothing to open. */}
            {[...(mem.insights ?? [])].reverse().map((ins, i) => (
              <div key={`${ins.run_id}-${i}`} className="well" style={{ padding: '8px 12px' }}>
                <div className="tiny">{ins.date}{ins.confidence ? ` · ${ins.confidence} confidence` : ''}</div>
                <div className="body-sm">{ins.text}</div>
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}

export function EditPlaceModal({ placeId, initialTab }: { placeId: string; initialTab?: 'details' | 'memory' }) {
  const { places, close } = useStore();
  const [tab, setTab] = useState<'details' | 'memory'>(initialTab ?? 'details');
  const place = places.find((p) => p.id === placeId);
  if (!place) return null;

  return (
    <Modal size="wide" onClose={close} label={`Edit ${place.name}`}>
      <ModalHead eyebrow="Place" title={place.name} onClose={close} />
      <div className="seg" role="tablist" aria-label="Place settings" style={{ marginBottom: 16, alignSelf: 'flex-start' }}>
        <button role="tab" aria-selected={tab === 'details'} className={tab === 'details' ? 'on' : ''} onClick={() => setTab('details')}>Details</button>
        <button role="tab" aria-selected={tab === 'memory'} className={tab === 'memory' ? 'on' : ''} onClick={() => setTab('memory')}>Memory</button>
      </div>
      {tab === 'details' ? <DetailsTab place={place} /> : <MemoryTab place={place} />}
    </Modal>
  );
}
