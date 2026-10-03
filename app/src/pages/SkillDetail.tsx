import { useState } from 'react';
import { useStore } from '../state/store';
import { CATS, MODULES, skillManifest, type Skill } from '../data/catalog';
import { areaHa, fmtC, quad } from '../data/geo';
import { Btn, CatPill, Empty, Ms, Tier, hideBroken } from '../components/ui';
import { CopyBtn, JsonCode, PublisherBadge, StorageExplainer, fmtRuns } from './libraryParts';

const fmtParam = (v: unknown) => (Array.isArray(v) ? `[${v.join(', ')}]` : String(v));

export function SkillDetail({ id }: { id: string }) {
  const { skills, go } = useStore();
  const s = skills.find((x) => x.id === id);
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
  const { go, places, askPlaceId, setAskPlace, installed, toggleInstall, notify, open } = useStore();
  const [tab, setTab] = useState<'overview' | 'file'>('overview');
  const [placeId, setPlaceId] = useState<string | null>(
    (askPlaceId && places.some((p) => p.id === askPlaceId) ? askPlaceId : places[0]?.id) ?? null,
  );
  const place = places.find((p) => p.id === placeId) || null;
  const c = CATS[s.cat];
  const isInstalled = installed.includes(s.id);
  const manifest = skillManifest(s);
  const json = JSON.stringify(manifest, null, 2);

  const run = () => {
    if (!place) return;
    setAskPlace(place.id);
    go('ask', undefined, { place: place.id, skill: s.id });
  };

  const install = () => {
    toggleInstall(s.id);
    notify(isInstalled ? `Removed “${s.name}” from your skills` : `Installed “${s.name}” — the agent can now use it in Ask`, isInstalled ? 'Undo' : undefined, isInstalled ? () => toggleInstall(s.id) : undefined, isInstalled ? 'remove_circle' : 'download_done');
  };

  const meta: { l: string; v: React.ReactNode }[] = [
    { l: 'Satellite', v: s.sat },
    { l: 'Cost', v: <>{s.tier === 'paid' ? s.cost : 'Free sources'}<Tier tier={s.tier} /></> },
    { l: 'Category', v: <><span className="sq" style={{ background: c.color }} />{c.name}</> },
    { l: 'Developer', v: <>{s.dev}{s.official ? <Ms n="verified" size={16} className="lib-v-official" /> : s.verified ? <Ms n="verified_user" size={16} className="lib-v-community" /> : null}</> },
    { l: 'Resolution', v: s.res },
    { l: 'Revisit', v: s.revisit },
  ];

  return (
    <div className="lib-detail">
      <div className="lib-media" aria-label={`Reference imagery near ${fmtC(s.lat, s.lon)}`}>
        {quad(s.lat, s.lon, s.cat === 0 ? 15 : 13).map((src, i) => <img onError={hideBroken} key={i} src={src} alt="" />)}
        <div className="lib-media-pill"><Ms n="image" />Reference image · {fmtC(s.lat, s.lon)}</div>
      </div>

      <div className="lib-detail-col">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <Btn icon="arrow_back" onClick={() => go('library')} style={{ paddingLeft: 8 }}>All skills</Btn>
          <CatPill cat={s.cat} />
        </div>

        <div>
          <h1 className="h2" style={{ margin: 0 }}>{s.name}</h1>
          <p className="body-lg" style={{ margin: '10px 0 0' }}>{s.short}</p>
        </div>

        <div className="lib-pubrow">
          <span className="ink" style={{ fontWeight: 600 }}>by {s.dev}</span>
          <PublisherBadge s={s} />
          <span>v{s.version}</span>
          <span className="sep">·</span>
          <span>Updated {s.updated}</span>
          <span className="sep">·</span>
          <span>{fmtRuns(s.runs)} runs</span>
          <span className="sep">·</span>
          <span><span style={{ color: 'var(--yellow)' }}>★</span> {s.rating ? s.rating.toFixed(1) : 'No ratings yet'}</span>
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
              <div className="body">{s.long}</div>
            </div>

            <div>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
                <span className="eyebrow">Steps</span>
                <span className="caption">{s.steps.length} modules · same order on every run</span>
              </div>
              <ol className="lib-steps">
                {s.steps.map((sid, i) => {
                  const m = MODULES.find((x) => x.id === sid);
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
              <div className="ink" style={{ font: '600 15px/1.45 var(--font)' }}>{s.accuracy}</div>
              <ul className="lib-limits">
                {s.limits.map((l) => <li key={l}>{l}</li>)}
              </ul>
            </div>
          </>
        ) : (
          <>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="caption" style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{manifest.id}@{manifest.version}.json</span>
              <CopyBtn text={json} />
            </div>
            <JsonCode value={manifest} />
            <StorageExplainer />
          </>
        )}

        <div className="well lib-try">
          <div className="eyebrow">Try it on my place</div>
          {places.length ? (
            <div className="row wrap">
              {places.map((p) => (
                <button key={p.id} className={`lib-try-chip ${p.id === placeId ? 'on' : ''}`} onClick={() => setPlaceId(p.id)} aria-pressed={p.id === placeId}>
                  <Ms n={p.circle ? 'radio_button_unchecked' : 'pentagon'} />
                  {p.name}
                  <span className="subtle">{areaHa(p.pts, p.lat)} ha</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="body-sm">You have no saved places yet. Add one in Places, then come back to run this skill on it.</div>
          )}
          <div className="row wrap">
            <Btn variant="primary" icon="play_arrow" tier={s.tier} tierLabel={s.tier === 'paid' ? s.cost : undefined} disabled={!place} onClick={run}>
              Run on {place ? place.name : 'a place'}
            </Btn>
            {!places.length && <Btn icon="add_location_alt" onClick={() => go('places')}>Add a place</Btn>}
          </div>
        </div>

        <div className="row wrap">
          <Btn icon={isInstalled ? 'remove_circle_outline' : 'download'} onClick={install}>{isInstalled ? 'Uninstall' : 'Install'}</Btn>
          <Btn icon="edit" onClick={() => go('library', 'new', { from: s.id })}>Duplicate &amp; edit</Btn>
          <Btn icon="ios_share" onClick={() => open({ kind: 'export', target: { kind: 'skill', title: s.name, subtitle: `v${s.version} · by ${s.dev}` } })}>Export</Btn>
          <Btn icon="visibility" onClick={() => open({ kind: 'watchBuilder', skillId: s.id })}>Keep watching with this skill</Btn>
        </div>
      </div>
    </div>
  );
}
