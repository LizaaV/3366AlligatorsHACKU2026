import { useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { CATS, MODULES, SATS, type Skill, type StepModule } from '../data/catalog';
import { Btn, IconBtn, Ms, Toggle } from '../components/ui';
import { CopyBtn, JsonCode, StorageExplainer, slug } from './libraryParts';

type ParamVal = string | number | boolean | string[];
interface Step { uid: number; module: string; params: Record<string, ParamVal>; }
type Visibility = 'private' | 'team' | 'public';

const DEFAULT_STEPS = ['area.mark', 'time.window', 'sat.route', 'scenes.filter', 'scenes.clean', 'index.compute', 'output.map'];
const GROUPS: StepModule['group'][] = ['Input', 'Data', 'Analysis', 'Output'];
const mod = (id: string) => MODULES.find((m) => m.id === id);
const cloneParams = (p?: StepModule['params']): Record<string, ParamVal> =>
  Object.fromEntries(Object.entries(p || {}).map(([k, v]) => [k, Array.isArray(v) ? [...v] : v]));

export function SkillBuilder() {
  const { route, go, skills, places, addSkill, notify } = useStore();
  const from = route.query.from ? skills.find((s) => s.id === route.query.from) : undefined;
  const uid = useRef(0);
  const mk = (id: string): Step => ({ uid: ++uid.current, module: id, params: cloneParams(mod(id)?.params) });

  const [name, setName] = useState(from ? `${from.name} (my version)` : '');
  const [cat, setCat] = useState(from ? from.cat : 0);
  const [short, setShort] = useState(from ? from.short : '');
  const [vis, setVis] = useState<Visibility>('private');
  const [paid, setPaid] = useState(false);
  const [price, setPrice] = useState('$1 / km²');
  const [steps, setSteps] = useState<Step[]>(() => (from ? from.steps : DEFAULT_STEPS).filter((id) => mod(id)).map(mk));
  const [openUid, setOpenUid] = useState<number | null>(null);
  const [testing, setTesting] = useState(false);

  const move = (i: number, d: -1 | 1) => setSteps((s) => {
    const j = i + d;
    if (j < 0 || j >= s.length) return s;
    const n = [...s];
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });
  const remove = (u: number) => setSteps((s) => s.filter((x) => x.uid !== u));
  const append = (id: string) => {
    const st = mk(id);
    setSteps((s) => [...s, st]);
    setOpenUid(st.uid);
  };
  const setParam = (u: number, k: string, raw: string | boolean) => setSteps((s) => s.map((x) => {
    if (x.uid !== u) return x;
    const prev = x.params[k];
    let v: ParamVal;
    if (typeof raw === 'boolean') v = raw;
    else if (Array.isArray(prev)) v = raw.split(',').map((t) => t.trim()).filter(Boolean);
    else if (typeof prev === 'number') v = raw === '' ? 0 : Number.isNaN(Number(raw)) ? prev : Number(raw);
    else v = raw;
    return { ...x, params: { ...x.params, [k]: v } };
  }));

  // Honest validation: the format only works if the recipe can actually run end to end.
  const first = steps[0] && mod(steps[0].module);
  const last = steps[steps.length - 1] && mod(steps[steps.length - 1].module);
  const hints: { level: 'ok' | 'error' | 'warn'; text: string }[] = [
    name.trim() ? { level: 'ok', text: 'Has a name' } : { level: 'error', text: 'Give the skill a name' },
    first?.group === 'Input' ? { level: 'ok', text: `Starts with an Input module (${first.name})` } : { level: 'error', text: 'Must start with an Input module (Ask or Mark the area)' },
    last?.group === 'Output' ? { level: 'ok', text: `Ends with an Output module (${last.name})` } : { level: 'error', text: 'Must end with an Output module (Show the answer or Keep watching)' },
    ...(steps.some((s) => s.module === 'scenes.filter') ? [] : [{ level: 'warn' as const, text: 'No “Find clear images” step — results may include cloudy images' }]),
    ...(steps.some((s) => mod(s.module)?.group === 'Analysis') ? [] : [{ level: 'warn' as const, text: 'No Analysis module — the skill will only return raw images' }]),
    ...(paid && !price.trim() ? [{ level: 'error' as const, text: 'Set a price for a paid skill' }] : []),
  ];
  const errors = hints.filter((h) => h.level === 'error').length;

  const sats = useMemo(() => {
    const r = steps.find((s) => s.module === 'sat.route');
    const ids = r && Array.isArray(r.params.candidates) ? r.params.candidates : ['s2'];
    const names = ids.map((id) => SATS[id]?.name.replace(/ (L2A|TIRS|SAR|OLCI)$/, '') ?? id);
    return names.length ? names.join(' · ') : 'Sentinel-2';
  }, [steps]);

  const version = '0.1.0';
  const skillSlug = slug(name) || 'untitled-skill';
  const manifest = {
    $schema: 'https://groundtruth.earth/schemas/skill/v1.json',
    id: `you.${CATS[cat].key}.${skillSlug}`,
    version,
    name: name.trim() || 'Untitled skill',
    category: CATS[cat].key,
    publisher: { name: 'You', official: false, verified: false },
    visibility: vis,
    pricing: { tier: paid ? 'paid' : 'free', price: paid ? price : null },
    inputs: [
      { key: 'area', type: 'geometry', required: true, accepts: ['place', 'polygon', 'geojson', 'kml'] },
      ...(steps.some((s) => s.module === 'ask.clarify') ? [{ key: 'context', type: 'answers', required: false }] : []),
    ],
    steps: steps.map((s) => ({ module: s.module, params: s.params })),
    outputs: [
      { key: 'layers', type: 'raster[]' },
      { key: 'summary', type: 'text', languages: 'auto' },
      { key: 'metrics', type: 'metric[]', with_confidence: true },
      { key: 'proof', type: 'proof_pack' },
    ],
    accuracy: { resolution: '10 m', revisit: '5 days', statement: 'Not yet validated', known_limits: [] as string[] },
  };
  const json = JSON.stringify(manifest, null, 2);

  const test = () => {
    setTesting(true);
    window.setTimeout(() => {
      setTesting(false);
      notify('Test run passed · 7 of 12 scenes usable', undefined, undefined, 'check_circle');
    }, 1100);
  };

  const publish = () => {
    if (errors) return;
    let id = skillSlug;
    if (skills.some((s) => s.id === id)) id = `${skillSlug}-${Date.now().toString(36).slice(-4)}`;
    const p0 = places[0];
    const flow = steps.map((s) => mod(s.module)?.name).filter(Boolean).join(' → ');
    const sk: Skill = {
      id,
      cat,
      name: name.trim(),
      sat: sats,
      cost: paid ? price.trim() : 'Free',
      tier: paid ? 'paid' : 'free',
      short: short.trim() || `Custom ${CATS[cat].name.toLowerCase()} skill.`,
      long: `${short.trim() ? short.trim() + ' ' : ''}Runs ${steps.length} modules in a fixed order: ${flow}.`,
      dev: 'You',
      official: false,
      verified: false,
      lat: p0?.lat ?? 37.9785,
      lon: p0?.lon ?? -100.9155,
      res: '10 m',
      revisit: '5 days',
      runs: 0,
      rating: 0,
      version,
      updated: 'Today',
      steps: steps.map((s) => s.module),
      accuracy: 'Not yet validated',
      limits: [
        'Not yet checked against ground-truth plots — treat results as indicative.',
        'Optical satellites cannot see through cloud; cloudy passes are skipped.',
        'Causes are inferred from patterns, not observed directly — confirm on the ground.',
      ],
    };
    addSkill(sk);
    go('library', id);
    notify(vis === 'public' ? `Published “${sk.name}” to the community library` : `Saved “${sk.name}” to your ${vis === 'team' ? 'team' : 'private'} library`, undefined, undefined, 'publish');
  };

  const hintIcon = { ok: ['check_circle', 'var(--green)'], error: ['error', 'var(--coral)'], warn: ['warning', 'var(--yellow)'] } as const;

  return (
    <>
      <div className="page-head">
        <div style={{ maxWidth: 680 }}>
          <Btn variant="text" size="sm" icon="arrow_back" onClick={() => go('library', from?.id)} style={{ marginLeft: -12 }}>
            {from ? from.name : 'Library'}
          </Btn>
          <h1 className="h1" style={{ margin: '10px 0 0' }}>Build a skill</h1>
          <p className="body-lg" style={{ margin: '10px 0 0' }}>Chain modules into a reproducible recipe. Saved as a versioned JSON file.</p>
        </div>
        {from && <span className="pill"><Ms n="content_copy" size={14} />Based on {from.name} v{from.version}</span>}
      </div>

      <div className="lib-builder">
        {/* ---------- left: about ---------- */}
        <div className="card lib-pane">
          <div className="eyebrow">About</div>
          <label className="field">Name
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Late-season dry spots" />
          </label>
          <label className="field">Category
            <select className="input" value={cat} onChange={(e) => setCat(+e.target.value)}>
              {CATS.map((c, i) => <option key={c.key} value={i}>{c.name}</option>)}
            </select>
          </label>
          <label className="field">Short description
            <textarea className="input" value={short} onChange={(e) => setShort(e.target.value)} placeholder="One sentence: what question does this answer?" rows={3} />
          </label>
          <div className="field">Visibility
            <div className="seg" role="radiogroup" aria-label="Visibility" style={{ flexWrap: 'wrap' }}>
              {([['private', 'Private'], ['team', 'Team'], ['public', 'Public (community)']] as [Visibility, string][]).map(([k, l]) => (
                <button key={k} role="radio" aria-checked={vis === k} className={vis === k ? 'on' : ''} onClick={() => setVis(k)}>{l}</button>
              ))}
            </div>
            {vis === 'public' && <span className="tiny">Public skills show under Community with your name. Groundtruth does not validate them unless you apply for verification.</span>}
          </div>
          <div className="field">Pricing
            <div className="seg" role="radiogroup" aria-label="Pricing" style={{ alignSelf: 'flex-start' }}>
              <button role="radio" aria-checked={!paid} className={!paid ? 'on' : ''} onClick={() => setPaid(false)}>Free</button>
              <button role="radio" aria-checked={paid} className={paid ? 'on' : ''} onClick={() => setPaid(true)}>Paid</button>
            </div>
          </div>
          {paid && (
            <label className="field">Price
              <input className="input" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="$1 / km²" />
              <span className="tiny">Charged per run on top of any paid imagery the steps use.</span>
            </label>
          )}
        </div>

        {/* ---------- middle: steps ---------- */}
        <div className="col" style={{ gap: 16, minWidth: 0 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="eyebrow">Steps</span>
            <span className="caption">{steps.length} modules · run top to bottom</span>
          </div>
          {steps.length === 0 && (
            <div className="well body-sm" style={{ padding: 20 }}>No steps yet. Add modules from the palette — start with “Mark the area”.</div>
          )}
          <ol className="lib-steps">
            {steps.map((st, i) => {
              const m = mod(st.module);
              if (!m) return null;
              const isOpen = openUid === st.uid;
              const entries = Object.entries(st.params);
              return (
                <li key={st.uid} className="lib-step">
                  <span className="lib-step-n">{i + 1}</span>
                  <div className={`lib-bstep grow ${isOpen ? 'open' : ''}`}>
                    <div className="lib-bstep-head">
                      <span className="lib-step-ic"><Ms n={m.icon} /></span>
                      <div className="grow col" style={{ gap: 2 }} onClick={() => setOpenUid(isOpen ? null : st.uid)}>
                        <div className="row wrap" style={{ gap: 8 }}>
                          <span className="ink" style={{ font: '600 14px/1.4 var(--font)' }}>{m.name}</span>
                          <span className="tag" style={{ padding: '0 6px', fontSize: 11 }}>{m.group}</span>
                        </div>
                        <span className="lib-mono">{m.id}{entries.length ? ` · ${entries.length} param${entries.length > 1 ? 's' : ''}` : ''}</span>
                      </div>
                      {entries.length > 0 && (
                        <IconBtn icon={isOpen ? 'expand_less' : 'tune'} className="sm" onClick={() => setOpenUid(isOpen ? null : st.uid)} aria-label={isOpen ? 'Hide parameters' : 'Edit parameters'} aria-expanded={isOpen} title="Parameters" />
                      )}
                      <IconBtn icon="arrow_upward" className="sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up" title="Move up" />
                      <IconBtn icon="arrow_downward" className="sm" onClick={() => move(i, 1)} disabled={i === steps.length - 1} aria-label="Move down" title="Move down" />
                      <IconBtn icon="close" className="sm" onClick={() => remove(st.uid)} aria-label={`Remove ${m.name}`} title="Remove" />
                    </div>
                    {isOpen && entries.length > 0 && (
                      <div className="lib-bstep-params">
                        {entries.map(([k, v]) => (
                          <label key={k} className="field" style={{ fontSize: 12 }}>
                            <span className="lib-mono" style={{ color: 'var(--muted)' }}>{k}{Array.isArray(v) ? ' (comma separated)' : ''}</span>
                            {typeof v === 'boolean' ? (
                              <Toggle on={v} onClick={() => setParam(st.uid, k, !v)} title={k} />
                            ) : (
                              <input
                                className="input"
                                type={typeof v === 'number' ? 'number' : 'text'}
                                value={Array.isArray(v) ? v.join(', ') : String(v)}
                                onChange={(e) => setParam(st.uid, k, e.target.value)}
                              />
                            )}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>

          <div className="card lib-pane" style={{ gap: 10 }}>
            <div className="eyebrow">Checks</div>
            <ul className="lib-hints">
              {hints.map((h) => (
                <li key={h.text}><Ms n={hintIcon[h.level][0]} style={{ color: hintIcon[h.level][1] }} /><span className={h.level === 'ok' ? '' : 'ink'}>{h.text}</span></li>
              ))}
            </ul>
          </div>
        </div>

        {/* ---------- right: palette + JSON ---------- */}
        <div className="lib-builder-right col" style={{ gap: 16, minWidth: 0 }}>
          <div className="card lib-pane" style={{ gap: 12 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="eyebrow">Module palette</span>
              <span className="tiny">Click to add</span>
            </div>
            {GROUPS.map((g) => (
              <div key={g} className="col" style={{ gap: 2 }}>
                <div className="tiny" style={{ padding: '4px 10px', fontWeight: 600 }}>{g}</div>
                {MODULES.filter((m) => m.group === g).map((m) => (
                  <button key={m.id} className="lib-palette-item" onClick={() => append(m.id)} title={`Add “${m.name}”`}>
                    <Ms n={m.icon} />
                    <span className="col grow" style={{ gap: 1 }}>
                      <span style={{ font: '600 13.5px/1.35 var(--font)' }}>{m.name}</span>
                      <span className="tiny">{m.desc}</span>
                    </span>
                    <Ms n="add" />
                  </button>
                ))}
              </div>
            ))}
          </div>

          <div className="col" style={{ gap: 10 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="eyebrow">Skill file · live</span>
              <CopyBtn text={json} />
            </div>
            <JsonCode value={manifest} />
            <StorageExplainer />
          </div>
        </div>
      </div>

      <div className="lib-foot">
        <Btn icon={testing ? undefined : 'science'} tier="free" onClick={test} disabled={testing || errors > 0}>
          {testing && <span className="spinner" />}
          {testing ? 'Testing on North Pivot…' : 'Test on North Pivot'}
        </Btn>
        <Btn icon="save" onClick={() => notify(`Draft saved · ${manifest.id}@${version}`, undefined, undefined, 'save')}>Save draft</Btn>
        <Btn variant="primary" icon="publish" tier="free" onClick={publish} disabled={errors > 0} title={errors ? 'Fix the checks above first' : undefined}>
          Publish to library
        </Btn>
      </div>
    </>
  );
}
