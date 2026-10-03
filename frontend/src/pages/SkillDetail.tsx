import { useCallback, useState } from 'react';
import { useStore } from '../state/store';
import { api } from '../api';
import { useResource } from '../hooks/useResource';
import type { Skill } from '../model';
import { DEFAULT_CENTER, fmtC, quad } from '../lib/geo';
import { fmtDate } from '../lib/format';
import { Btn, CatPill, Empty, Ms, hideBroken } from '../components/ui';
import { skillStatus } from '../data/presentation';
import { ErrorState, Skeleton } from '../components/async';
import { CopyBtn, JsonCode, PublisherBadge, StatusBadge, StorageExplainer, fmtRuns } from './libraryParts';

const fmtParam = (v: unknown) => (Array.isArray(v) ? `[${v.join(', ')}]` : String(v));

export function SkillDetail({ id }: { id: string }) {
  const { skills, go, loading } = useStore();
  const s = skills.find((x) => x.id === id);
  if (loading.skills) return <Skeleton h={28} lines={4} style={{ maxWidth: 520 }} />;
  if (!s) {
    return (
      <Empty icon="extension_off" title="Skill not found" body="It may have been removed or the link is from another workspace.">
        <Btn icon="arrow_back" onClick={() => go('library')}>All skills</Btn>
      </Empty>
    );
  }
  return <Detail s={s} />;
}

function Detail({ s }: { s: Skill }) {
  const { go, places, askPlaceId, setAskPlace, installed, open, category, modules } = useStore();
  const [tab, setTab] = useState<'overview' | 'file'>('overview');
  const [placeId, setPlaceId] = useState<string | null>(
    (askPlaceId && places.some((p) => p.id === askPlaceId) ? askPlaceId : places[0]?.id) ?? null,
  );
  const place = places.find((p) => p.id === placeId) || null;
  const c = category(s.categoryKey);
  const ref = s.reference ?? DEFAULT_CENTER;
  const isInstalled = installed.includes(s.id);
  const status = skillStatus(s);
  const runnable = status === 'available';
  // The manifest is the backend's stored representation, so it is fetched rather than rebuilt.
  const manifestRes = useResource(useCallback((signal) => api.skills.manifest(s.id, signal), [s.id]), [s.id]);
  const json = manifestRes.data ? JSON.stringify(manifestRes.data, null, 2) : '';

  const run = () => {
    if (!place) return;
    setAskPlace(place.id);
    go('ask', undefined, { place: place.id, skill: s.id });
  };

  const meta: { l: string; v: React.ReactNode }[] = [
    { l: 'Satellite', v: s.sat },
    { l: 'Status', v: runnable ? 'Ready to run' : status === 'draft' ? 'Draft' : 'Concept, not runnable yet' },
    { l: 'Category', v: <><span className="sq" style={{ background: c.color }} />{c.name}</> },
    { l: 'Developer', v: <>{s.publisherName}{s.official ? <Ms n="verified" size={16} className="lib-v-official" /> : s.verified ? <Ms n="verified_user" size={16} className="lib-v-community" /> : null}</> },
    ...(s.res ? [{ l: 'Resolution', v: s.res }] : []),
    ...(s.revisit ? [{ l: 'Revisit', v: s.revisit }] : []),
  ];

  return (
    <div className="lib-detail">
      <div className="lib-media" aria-label={`Reference imagery near ${fmtC(ref.lat, ref.lon)}`}>
        {quad(ref.lat, ref.lon, s.categoryKey === 'agriculture' ? 15 : 13).map((src: string, i: number) => <img onError={hideBroken} key={i} src={src} alt="" />)}
        <div className="lib-media-pill"><Ms n="image" />Reference image · {fmtC(ref.lat, ref.lon)}</div>
      </div>

      <div className="lib-detail-col">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <Btn icon="arrow_back" onClick={() => go('library')} style={{ paddingLeft: 8 }}>All skills</Btn>
          <CatPill category={c} />
        </div>

        <div>
          <h1 className="h2" style={{ margin: 0 }}>{s.name}</h1>
          <p className="body-lg" style={{ margin: '10px 0 0' }}>{s.short}</p>
        </div>

        <div className="lib-pubrow">
          <span className="ink" style={{ fontWeight: 600 }}>by {s.publisherName}</span>
          <PublisherBadge s={s} />
          <StatusBadge s={s} />
          <span>v{s.version}</span>
          <span className="sep">·</span>
          <span>Updated {fmtDate(s.updatedAt)}</span>
          {typeof s.runs === 'number' && s.runs > 0 && <><span className="sep">·</span><span>{fmtRuns(s.runs)} runs</span></>}
          {typeof s.rating === 'number' && s.rating > 0 && <><span className="sep">·</span><span><span style={{ color: 'var(--yellow)' }}>★</span> {s.rating.toFixed(1)}</span></>}
          {isInstalled && <span className="tag"><Ms n="check" />Installed</span>}
        </div>

        <div className="seg" role="tablist" aria-label="Skill view" style={{ alignSelf: 'flex-start' }}>
          <button role="tab" aria-selected={tab === 'overview'} className={tab === 'overview' ? 'on' : ''} onClick={() => setTab('overview')}><Ms n="article" size={16} />Overview</button>
          <button role="tab" aria-selected={tab === 'file'} className={tab === 'file' ? 'on' : ''} onClick={() => setTab('file')}><Ms n="data_object" size={16} />Skill file (JSON)</button>
        </div>

        {tab === 'overview' ? (
          <>
            <div className="stats lib-stats2">
              {meta.map((m) => (
                <div key={m.l}><div className="l">{m.l}</div><div className="v">{m.v}</div></div>
              ))}
            </div>

            <div>
              <div className="eyebrow" style={{ marginBottom: 8 }}>How it works</div>
              <div className="body">{s.long || s.short}</div>
            </div>

            <div>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
                <span className="eyebrow">Steps</span>
                <span className="caption">{s.steps?.length ?? 0} modules · same order on every run</span>
              </div>
              <ol className="lib-steps">
                {(s.steps ?? []).map((sid: string, i: number) => {
                  const m = modules.find((x) => x.id === sid);
                  if (!m) return null;
                  const params = Object.entries(m.params || {});
                  return (
                    <li key={sid + i} className="lib-step">
                      <span className="lib-step-n">{i + 1}</span>
                      <div className="lib-step-card">
                        <span className="lib-step-ic"><Ms n={m.icon} /></span>
                        <div className="grow col" style={{ gap: 3 }}>
                          <div className="row wrap" style={{ gap: 8 }}>
                            <span className="ink" style={{ font: '600 14px/1.4 var(--font)' }}>{m.name}</span>
                            <span className="tag" style={{ padding: '0 6px', fontSize: 11 }}>{m.group}</span>
                          </div>
                          <div className="body-sm" style={{ fontSize: 13 }}>{m.desc}</div>
                          <div className="lib-mono">
                            {m.id}{params.length ? ' · ' + params.map(([k, v]) => `${k}=${fmtParam(v)}`).join(' · ') : ''}
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>

            <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="eyebrow">Accuracy &amp; limits</span>
                <Ms n={s.official ? 'fact_check' : 'info'} size={18} className="muted" />
              </div>
              <div className="ink" style={{ font: '600 15px/1.45 var(--font)' }}>{s.accuracy || 'Not validated yet: no accuracy figure has been measured for this skill.'}</div>
              {(s.limits?.length ?? 0) > 0 && (
                <ul className="lib-limits">
                  {s.limits.map((l: string) => <li key={l}>{l}</li>)}
                </ul>
              )}
            </div>
          </>
        ) : (
          <>
            {manifestRes.isLoading ? (
              <Skeleton h={14} lines={6} />
            ) : manifestRes.error ? (
              <ErrorState error={manifestRes.error} onRetry={manifestRes.refetch} title="Could not load the skill file" />
            ) : (
              <>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="caption" style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                    {s.id}@{s.version}.json
                  </span>
                  <CopyBtn text={json} />
                </div>
                <JsonCode value={manifestRes.data} />
                <StorageExplainer />
              </>
            )}
          </>
        )}

        {runnable ? (
          <div className="well lib-try">
            <div className="eyebrow">Try it on my place</div>
            {places.length ? (
              <div className="row wrap">
                {places.map((p) => (
                  <button key={p.id} className={`lib-try-chip ${p.id === placeId ? 'on' : ''}`} onClick={() => setPlaceId(p.id)} aria-pressed={p.id === placeId}>
                    <Ms n={p.circle ? 'radio_button_unchecked' : 'pentagon'} />
                    {p.name}
                    <span className="subtle">{p.areaHa} ha</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="body-sm">You have no saved places yet. Add one in Places, then come back to run this skill on it.</div>
            )}
            <div className="row wrap">
              <Btn variant="primary" icon="play_arrow" disabled={!place} onClick={run}>
                Run on {place ? place.name : 'a place'}
              </Btn>
              {!places.length && <Btn icon="add_location_alt" onClick={() => go('places')}>Add a place</Btn>}
            </div>
          </div>
        ) : (
          <div className="well lib-try">
            <div className="row" style={{ gap: 8 }}><Ms n="lightbulb" className="muted" /><span className="eyebrow">{status === 'draft' ? 'Draft' : 'Concept'}</span></div>
            <div className="body-sm">
              {status === 'draft'
                ? 'This is a draft you saved from the skill builder. Drafts cannot run yet.'
                : 'This skill is a planned recipe: the steps are written down, but there is no tested script behind it yet, so it cannot be run. You can still ask the agent about a place in your own words.'}
            </div>
          </div>
        )}

        <div className="row wrap">
          <Btn icon="edit" onClick={() => go('library', 'new', { from: s.id })}>Duplicate &amp; edit</Btn>
          {runnable && <Btn icon="notifications" onClick={() => open({ kind: 'watchBuilder', skillId: s.id })}>Set a trigger with this skill</Btn>}
        </div>
      </div>
    </div>
  );
}
