/**
 * Add a place: a three-step wizard — locate it, check the outline, name it.
 *
 * This file is only the shell. It owns the step, the chosen method, the `Loc` the method
 * reported, and the save. Everything else lives in `addPlace/`:
 *
 *   - each locate-method is a component that owns its own inputs and reports a `Loc | null`,
 *     so switching method discards the previous one's state instead of leaving it lying around
 *   - `useOutline` owns step 2's geometry and the boundary detection
 *   - `useDetailsForm` owns step 3's form
 *
 * The three slices meet here, in `save()` — that function's dependencies are the real interface
 * between them.
 */

import { useCallback, useState } from 'react';
import { useStore } from '../state/store';
import { ApiError, toApiError } from '../api';
import type { Place } from '../model';
import { sourceLabel } from '../data/presentation';
import { fmtC, ptsToRing } from '../lib/geo';
import { Btn, Modal, ModalHead, Ms } from '../components/ui';
import { ErrorState } from '../components/async';
import { Steps } from './addPlace/Steps';
import { MethodInput } from './addPlace/methods';
import { OutlineStep } from './addPlace/OutlineStep';
import { DetailsStep } from './addPlace/DetailsStep';
import { useOutline } from './addPlace/useOutline';
import { useDetailsForm } from './addPlace/useDetailsForm';
import { METHODS, type Loc, type Method } from './addPlace/types';

/** A location carried in from elsewhere (geocoder pick, globe click): the wizard starts at the outline step. */
export interface AddPlacePrefill { lat: number; lon: number; name?: string; method?: 'pin' }

const fmtHa = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });

export function AddPlaceModal({ prefill }: { prefill?: AddPlacePrefill }) {
  const { close, addPlace, addWatch, notify, go, skills, setAskPlace } = useStore();
  const [step, setStep] = useState(prefill ? 2 : 1);
  const [method, setMethod] = useState<Method | null>(prefill ? (prefill.method ?? 'pin') : null);
  const [loc, setLoc] = useState<Loc | null>(() =>
    prefill
      ? {
          lat: prefill.lat,
          lon: prefill.lon,
          label: prefill.name ?? 'Pinned site',
          source: 'pin',
          via: prefill.name ? `${prefill.name} · ${fmtC(prefill.lat, prefill.lon)}` : fmtC(prefill.lat, prefill.lon),
        }
      : null,
  );
  const [error, setError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);

  const outline = useOutline({ loc, step, method });
  const form = useDetailsForm(loc);
  const { pts, isCircle, ha, fitted, outlineLabel, center } = outline;

  // Stable so the method components' effects don't re-fire on every render of this shell.
  const onMethodChange = useCallback((next: Loc | null) => setLoc(next), []);

  /** Preview-only place, so the map can draw the outline before it is saved. */
  const draft: Place | null = loc
    ? {
        id: 'draft',
        name: form.finalName || loc.label,
        categoryKey: form.categoryKey,
        lat: loc.lat,
        lon: loc.lon,
        zoom: Math.max(12, Math.min(16, fitted)),
        pts,
        circle: isCircle,
        areaHa: ha,
        project: form.finalProject,
        tags: [],
        source: loc.source,
        createdAt: null,
        updatedAt: null,
        details: [],
      }
    : null;

  const goStep2 = () => {
    if (!loc) return;
    setError(null);
    outline.begin(loc, method);
    setStep(2);
  };

  /** The user picked a different spot on the globe in step 2: start over from a pin there. */
  const relocate = (at: { lat: number; lon: number }) => {
    const next: Loc = { ...at, label: 'Pinned site', source: 'pin', via: fmtC(at.lat, at.lon) };
    setMethod('pin');
    setLoc(next);
    outline.begin(next, 'pin');
  };

  const goStep3 = () => {
    if (!loc) return;
    setError(null);
    form.applySuggestions(loc);
    setStep(3);
  };

  const goBack = () => {
    setError(null);
    setStep((s) => s - 1);
  };

  const save = async () => {
    if (!loc || !draft || !form.complete || saving) return;
    setSaving(true);
    setError(null);
    try {
      // Geometry goes up as GeoJSON in WGS84. Area is NOT sent — the backend computes it.
      const created = await addPlace({
        name: form.finalName,
        categoryKey: form.categoryKey,
        center: center ?? { lat: loc.lat, lon: loc.lon },
        geometry: { type: 'Polygon', coordinates: [ptsToRing(pts, { lat: loc.lat, lon: loc.lon })] },
        isCircle,
        project: form.finalProject,
        tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
        source: loc.source,
        details: [
          { label: 'Added via', value: sourceLabel(loc.source) },
          { label: 'Source', value: loc.via },
          { label: 'Outline', value: outlineLabel },
          ...(loc.details ?? []).filter((d) => d.label !== 'Added via'),
        ],
      });

      // Watches the user opted into. Each is a separate write; one failing must not lose the place.
      const started: string[] = [];
      for (const skillId of form.startWatch) {
        const sk = skills.find((x) => x.id === skillId);
        if (!sk) continue;
        try {
          await addWatch({
            name: `${sk.name} · ${created.name}`,
            categoryKey: sk.categoryKey,
            placeId: created.id,
            skillId: sk.id,
            question: sk.short,
            condition: 'Any notable change since the last pass',
            channels: ['email'],
            cadence: `Every pass (${sk.revisit})`,
          });
          started.push(sk.name);
        } catch {
          notify(`${created.name} saved, but the “${sk.name}” trigger could not be created`, undefined, undefined, 'error');
        }
      }

      close();
      // Point the chat composer at the new place straight away.
      setAskPlace(created.id);
      notify(
        started.length
          ? `${created.name} saved · ${fmtHa(created.areaHa)} ha · ${started.length} trigger${started.length > 1 ? 's' : ''} started`
          : `${created.name} saved · ${fmtHa(created.areaHa)} ha`,
        'Ask about it',
        () => go('ask', undefined, { place: created.id }),
        'check_circle',
      );
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal size="wide" onClose={close} label="Add a place">
      <ModalHead eyebrow="New place" title="Add a place" sub="Save a field, plot, site or water body once — then ask about it or set a trigger on it." onClose={close} />
      <Steps step={step} />

      {step === 1 && (
        <>
          <div className="subhead">How do you want to add it?</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
            {METHODS.map((mt) => {
              const on = method === mt.id;
              return (
                <button
                  key={mt.id}
                  // Switching method clears the location: the previous method's component is
                  // unmounted, so whatever it had reported is no longer backed by any input.
                  onClick={() => { setMethod(mt.id); setLoc(null); }}
                  aria-pressed={on}
                  aria-label={mt.title}
                  style={{
                    textAlign: 'left', padding: 12, borderRadius: 'var(--r)', display: 'flex', flexDirection: 'column', gap: 6,
                    background: on ? 'var(--s2)' : 'var(--canvas)', border: `1px solid ${on ? '#fff' : 'var(--hair-soft)'}`, color: '#fff',
                  }}
                >
                  <Ms n={mt.icon} size={22} style={{ color: on ? '#fff' : 'var(--muted)' }} />
                  <span style={{ font: '600 14px/1.3 var(--font)' }}>{mt.title}</span>
                  <span className="tiny">{mt.hint}</span>
                </button>
              );
            })}
          </div>
          {method && (
            <div className="panel fade-up" key={method} style={{ padding: 16, background: 'var(--s1)' }}>
              <MethodInput method={method} onChange={onMethodChange} />
            </div>
          )}
          {!method && <div className="caption">Once the place is located you can draw its outline, use the AI boundary and fine-tune every point.</div>}
        </>
      )}

      {step === 2 && loc && draft && <OutlineStep loc={loc} draft={draft} outline={outline} onRelocate={relocate} />}
      {step === 3 && loc && <DetailsStep loc={loc} ha={ha} form={form} outline={{ shape: outline.shape, edited: outline.isEdited }} />}

      {error && <ErrorState error={error} onRetry={step === 3 ? () => void save() : undefined} title="Could not complete that" compact />}

      <div className="modal-foot" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        {step === 1 ? <Btn variant="text" onClick={close}>Cancel</Btn> : <Btn variant="text" icon="arrow_back" onClick={goBack}>Back</Btn>}
        {step === 1 && <Btn variant="primary" trailing="arrow_forward" disabled={!loc} onClick={goStep2}>Continue</Btn>}
        {step === 2 && <Btn variant="primary" trailing="arrow_forward" disabled={!loc || ha <= 0} onClick={goStep3}>Continue</Btn>}
        {step === 3 && <Btn variant="primary" icon="check" disabled={!form.complete || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save place'}</Btn>}
      </div>
    </Modal>
  );
}
