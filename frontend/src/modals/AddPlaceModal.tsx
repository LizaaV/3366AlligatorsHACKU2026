import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../state/store';
import { FIELD, PLACE_RESULTS, SOURCE_LABEL, type Place, type PlaceSource } from '../data/places';
import { areaHa, circlePts, fmtC, rectPts, thumb, txy, type Pt } from '../data/geo';
import { CATS } from '../data/catalog';
import { WATCHES, type Watch } from '../data/watches';
import { MapView, type MapLayers } from '../components/MapView';
import { Btn, Check, IconBtn, Modal, ModalHead, Ms, Tier } from '../components/ui';

/* ---------- geo helpers (local) ---------- */

const mpp16 = (lat: number) => (156543.03 * Math.cos((lat * Math.PI) / 180)) / 65536;

/** Move a lat/lon by an offset given in z16 pixels. */
const shift = (lat: number, lon: number, dx: number, dy: number) => {
  const n = Math.pow(2, 16);
  const t = txy(lat, lon, 16);
  const x = t.x + dx / 256, y = t.y + dy / 256;
  return { lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI, lon: (x / n) * 360 - 180 };
};

/** Deterministic "field-like" irregular polygon — stands in for the AI boundary detector. */
const detectPts = (lat: number, lon: number, w = 400, h = 300): Pt[] => {
  let seed = Math.abs(Math.round(lat * 1000 + lon * 7919)) % 233280 || 1;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const n = 11;
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    // superellipse-ish so it reads as a field, not a blob
    const c = Math.cos(a), s = Math.sin(a);
    const k = 1 / Math.pow(Math.pow(Math.abs(c), 4) + Math.pow(Math.abs(s), 4), 0.25);
    const j = 0.9 + rnd() * 0.16;
    return [+((s * k * w) / 2 * j).toFixed(1), +((-c * k * h) / 2 * j).toFixed(1)] as Pt;
  });
};

const extentOf = (pts: Pt[]) => {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1);
};
const fitZoom = (pts: Pt[], box: number) => Math.max(10, Math.min(18, Math.floor(16 + Math.log2(box / extentOf(pts)))));

const NO_LAYERS: MapLayers = { contour: false, ndmi: false, ndvi: false, lst: false, dry: false, clouds: false };
const CONTOUR: MapLayers = { ...NO_LAYERS, contour: true };

/* ---------- methods ---------- */

type Method = 'search' | 'coords' | 'draw' | 'upload' | 'parcel' | 'whatsapp' | 'pin' | 'project';

const METHODS: { id: Method; icon: string; title: string; hint: string; paid?: string }[] = [
  { id: 'search', icon: 'search', title: 'Search a place name', hint: 'Town, farm, lake, port or region' },
  { id: 'coords', icon: 'my_location', title: 'Coordinates', hint: 'Latitude / longitude or your location' },
  { id: 'draw', icon: 'draw', title: 'Draw on map', hint: 'Click the corners of your field' },
  { id: 'upload', icon: 'upload_file', title: 'Upload file', hint: 'KML, GeoJSON, Shapefile, CSV of points' },
  { id: 'parcel', icon: 'grid_view', title: 'Parcel / cadastre ID', hint: 'CAR, INSPIRE, survey number, APN', paid: 'Paid · $0.50/lookup in some countries' },
  { id: 'whatsapp', icon: 'chat', title: 'WhatsApp location pin', hint: 'Send a pin while standing in the field' },
  { id: 'pin', icon: 'location_on', title: 'Drop pin + radius', hint: 'One tap, then set a radius' },
  { id: 'project', icon: 'folder_open', title: 'Import from project', hint: 'Reuse a place another project has' },
];

const SEARCH_CAT: Record<string, number> = { 'Lake Mead': 1, 'Rondônia': 2, 'Port of Rotterdam': 7, 'Great Barrier Reef': 5 };

const PARCEL_SYS = [
  { id: 'br', name: 'Brazil · CAR', ph: 'RO-1100205-8F3A…', tier: 'free' as const, lat: -10.082, lon: -62.914, cat: 2 },
  { id: 'eu', name: 'EU · INSPIRE cadastral parcel', ph: 'NL.IMKAD.KadastraalPerceel.…', tier: 'free' as const, lat: 51.982, lon: 4.418, cat: 0 },
  { id: 'in', name: 'India · Survey number', ph: 'Anand / 214/2', tier: 'free' as const, lat: 22.552, lon: 72.968, cat: 0 },
  { id: 'us', name: 'United States · APN (county)', ph: '055-123-04-0-00-00-001', tier: 'paid' as const, lat: 37.951, lon: -100.884, cat: 0 },
  { id: 'ke', name: 'Kenya · LR number', ph: 'Nakuru/Block 4/112', tier: 'paid' as const, lat: -0.312, lon: 36.081, cat: 0 },
];

const WA_PINS = [
  { id: 'wa1', from: 'You', when: '2 min ago', note: '“Lower shamba, near the borehole”', lat: -0.3021, lon: 36.0712 },
  { id: 'wa2', from: 'Field team · Juma', when: 'Yesterday, 16:40', note: '“Maize block east of road”', lat: FIELD.lat + 0.0118, lon: FIELD.lon + 0.0094 },
];
const WA_NUMBER = '+1 (555) 014-7788';

interface Loc {
  lat: number;
  lon: number;
  label: string;
  source: PlaceSource;
  via: string;
  pts?: Pt[];
  circle?: boolean;
  givenLabel?: string;
  cat?: number;
  project?: string;
  details?: { l: string; v: string }[];
}

type Shape = 'given' | 'detected' | 'circle' | 'rect';

/* ---------- small pieces ---------- */

function Steps({ step }: { step: number }) {
  const items = ['Locate', 'Outline', 'Details'];
  return (
    <div className="row" style={{ gap: 0 }} aria-label={`Step ${step} of 3`}>
      {items.map((l, i) => {
        const n = i + 1, done = n < step, on = n === step;
        return (
          <div key={l} className="row" style={{ gap: 8, flex: i < 2 ? 1 : 'none' }}>
            <span style={{
              width: 24, height: 24, borderRadius: '50%', flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              font: '600 12px/1 var(--font)', background: on || done ? '#fff' : 'transparent', color: on || done ? '#000' : 'var(--subtle)',
              border: on || done ? '1px solid #fff' : '1px solid var(--hair)',
            }}>
              {done ? <Ms n="check" size={14} /> : n}
            </span>
            <span className={`eyebrow ${on ? '' : 'hide-mobile'}`} style={{ color: on ? 'var(--ink)' : done ? 'var(--muted)' : 'var(--subtle)' }}>{l}</span>
            {i < 2 && <span style={{ flex: 1, height: 1, minWidth: 12, margin: '0 12px', background: done ? 'var(--muted)' : 'var(--hair-soft)' }} />}
          </div>
        );
      })}
    </div>
  );
}

/** Fixed-size MapView centred in a fluid frame, with zoom buttons and an optional overlay/click handler. */
function MapFrame({ H, center, zoom, setZoom, place, layers, onPick, children }: {
  H: number; center: { lat: number; lon: number }; zoom: number; setZoom: (z: number) => void; place: Place | null; layers: MapLayers;
  onPick?: (dx16: number, dy16: number) => void; children?: (s: number, W: number, H: number) => ReactNode;
}) {
  const W = 700;
  const s = Math.pow(2, zoom - 16);
  return (
    <div style={{ position: 'relative', height: H, borderRadius: 'var(--r)', overflow: 'hidden', border: '1px solid var(--hair-soft)', background: '#0b0d10' }}>
      <div
        style={{ position: 'absolute', top: 0, left: '50%', width: W, height: H, marginLeft: -W / 2, cursor: onPick ? 'crosshair' : 'default' }}
        onClick={onPick ? (e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onPick((e.clientX - r.left - W / 2) / s, (e.clientY - r.top - H / 2) / s);
        } : undefined}
      >
        <MapView W={W} H={H} cx={W / 2} cy={H / 2} center={center} zoom={zoom} place={place} layers={layers} dateIdx={7} />
        {children && (
          <svg width={W} height={H} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}>
            {children(s, W, H)}
          </svg>
        )}
      </div>
      <div className="col" style={{ position: 'absolute', right: 8, top: 8, gap: 4 }}>
        <IconBtn icon="add" className="sm boxed" aria-label="Zoom in" onClick={() => setZoom(Math.min(18, zoom + 1))} />
        <IconBtn icon="remove" className="sm boxed" aria-label="Zoom out" onClick={() => setZoom(Math.max(3, zoom - 1))} />
      </div>
      <span className="tiny" style={{ position: 'absolute', left: 8, bottom: 6, color: 'var(--muted)', textShadow: '0 1px 2px #000' }}>
        Sentinel-2 cloudless · {fmtC(center.lat, center.lon)} · z{zoom}
      </span>
    </div>
  );
}

const Slider = ({ label, value, min, max, step, onChange, unit }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; unit: string }) => (
  <label className="field" style={{ flex: 1, minWidth: 200 }}>
    <span className="row" style={{ justifyContent: 'space-between' }}>
      <span>{label}</span>
      <span className="ink">{value.toLocaleString()} {unit}</span>
    </span>
    <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
  </label>
);

/* ---------- modal ---------- */

export function AddPlaceModal() {
  const { close, places, addPlace, addWatch, notify, go, open, connectors, skills } = useStore();
  const [step, setStep] = useState(1);
  const [method, setMethod] = useState<Method | null>(null);

  // step 1 inputs
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<number | null>(null);
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [geoMsg, setGeoMsg] = useState('');
  const [drawAt, setDrawAt] = useState(0); // index into PLACE_RESULTS-like jump list (0 = my farm)
  const [drawZoom, setDrawZoom] = useState(15);
  const [verts, setVerts] = useState<Pt[]>([]);
  const [pin, setPin] = useState<Pt | null>(null);
  const [file, setFile] = useState<{ name: string; size: number } | null>(null);
  const [parsing, setParsing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [parcelSys, setParcelSys] = useState('br');
  const [parcelId, setParcelId] = useState('');
  const [parcelState, setParcelState] = useState<'idle' | 'busy' | 'found'>('idle');
  const [waPin, setWaPin] = useState<string | null>(null);
  const [fromProject, setFromProject] = useState<string | null>(null);
  const [fromPlace, setFromPlace] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // step 2
  const [shape, setShape] = useState<Shape>('detected');
  const [radius, setRadius] = useState(300);
  const [rw, setRw] = useState(600);
  const [rh, setRh] = useState(400);
  const [zoomAdj, setZoomAdj] = useState(0);

  // step 3
  const projects = useMemo(() => Array.from(new Set(places.map((p) => p.project))), [places]);
  const [name, setName] = useState('');
  const [project, setProject] = useState(projects[0] ?? '__new');
  const [newProject, setNewProject] = useState('');
  const [cat, setCat] = useState(0);
  const [tags, setTags] = useState('');
  const [startWatch, setStartWatch] = useState<string[]>([]);

  const jumps = [{ n: 'My Farm, Garden City', lat: FIELD.lat, lon: FIELD.lon }, ...PLACE_RESULTS.map((r) => ({ n: r.n, lat: r.lat, lon: r.lon }))];
  const drawCenter = jumps[drawAt];
  const parcel = PARCEL_SYS.find((p) => p.id === parcelSys)!;

  /* the location the chosen method yields (null = not enough input yet) */
  const loc: Loc | null = useMemo(() => {
    switch (method) {
      case 'search': {
        if (result === null) return null;
        const r = PLACE_RESULTS[result];
        return { lat: r.lat, lon: r.lon, label: r.n, source: 'search', via: `Search · ${r.n}, ${r.d}`, cat: SEARCH_CAT[r.n] };
      }
      case 'coords': {
        const a = parseFloat(lat), b = parseFloat(lon);
        if (!isFinite(a) || !isFinite(b) || Math.abs(a) > 85 || Math.abs(b) > 180) return null;
        return { lat: a, lon: b, label: `Site ${fmtC(a, b)}`, source: 'coords', via: fmtC(a, b) };
      }
      case 'draw': {
        if (verts.length < 3) return null;
        const cx = verts.reduce((s, v) => s + v[0], 0) / verts.length;
        const cy = verts.reduce((s, v) => s + v[1], 0) / verts.length;
        const c = shift(drawCenter.lat, drawCenter.lon, cx, cy);
        return { ...c, label: 'New field', source: 'drawn', via: `${verts.length} points drawn`, pts: verts.map((v) => [+(v[0] - cx).toFixed(1), +(v[1] - cy).toFixed(1)] as Pt), givenLabel: 'As drawn' };
      }
      case 'upload': {
        if (!file || parsing) return null;
        const base = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Uploaded field';
        const isCsv = /\.csv$/i.test(file.name);
        return {
          lat: FIELD.lat + 0.0152, lon: FIELD.lon - 0.0061, label: base.charAt(0).toUpperCase() + base.slice(1), source: 'uploaded', via: file.name,
          pts: detectPts(FIELD.lat + 0.0152, FIELD.lon - 0.0061, 460, 330), givenLabel: isCsv ? 'Outline around points' : 'From file',
          details: [{ l: 'File', v: file.name }],
        };
      }
      case 'parcel': {
        if (parcelState !== 'found') return null;
        return {
          lat: parcel.lat, lon: parcel.lon, label: `Parcel ${parcelId.trim()}`, source: 'parcel', via: `${parcel.name} · ${parcelId.trim()}`,
          pts: detectPts(parcel.lat, parcel.lon, 380, 420), givenLabel: 'From parcel register', cat: parcel.cat,
          details: [{ l: 'Parcel ID', v: `${parcel.name.split(' · ')[1]} ${parcelId.trim()}` }],
        };
      }
      case 'whatsapp': {
        const p = WA_PINS.find((x) => x.id === waPin);
        if (!p) return null;
        return { lat: p.lat, lon: p.lon, label: p.note.replace(/[“”]/g, ''), source: 'whatsapp', via: `${p.from} · ${p.when}` };
      }
      case 'pin': {
        if (!pin) return null;
        const c = shift(drawCenter.lat, drawCenter.lon, pin[0], pin[1]);
        return { ...c, label: 'Pinned site', source: 'pin', via: fmtC(c.lat, c.lon) };
      }
      case 'project': {
        const p = places.find((x) => x.id === fromPlace);
        if (!p) return null;
        return {
          lat: p.lat, lon: p.lon, label: p.name, source: p.source, via: `Copied from ${p.project} · ${p.name}`,
          pts: p.pts, circle: p.circle, givenLabel: `As in ${p.project}`, cat: p.cat, details: p.details,
        };
      }
      default:
        return null;
    }
  }, [method, result, lat, lon, verts, drawCenter, file, parsing, parcelState, parcel, parcelId, waPin, pin, fromPlace, places]);

  /* ---------- step 2 geometry ---------- */
  const m = loc ? mpp16(loc.lat) : 1;
  const pts: Pt[] = !loc ? [] :
    shape === 'given' && loc.pts ? loc.pts :
    shape === 'circle' ? circlePts(radius / m, 48) :
    shape === 'rect' ? rectPts(rw / m, rh / m) :
    detectPts(loc.lat, loc.lon);
  const isCircle = shape === 'circle' || (shape === 'given' && !!loc?.circle);
  const ha = loc ? areaHa(pts, loc.lat) : 0;
  const baseZoom = pts.length ? fitZoom(pts, 220) : 15;
  const previewZoom = Math.max(3, Math.min(18, baseZoom + zoomAdj));
  const finalName = name.trim();
  const finalProject = project === '__new' ? newProject.trim() : project;

  const draft: Place | null = loc ? {
    id: 'draft', name: finalName || loc.label, cat, lat: loc.lat, lon: loc.lon, zoom: Math.max(12, Math.min(16, baseZoom)),
    pts, circle: isCircle, project: finalProject, tags: [], source: loc.source, created: 'Oct 2026', details: [],
  } : null;

  const suggested = useMemo(() => skills.filter((s) => s.cat === cat).slice(0, 3), [skills, cat]);
  useEffect(() => setStartWatch([]), [cat]);

  const goStep2 = () => {
    if (!loc) return;
    setShape(loc.pts ? 'given' : method === 'pin' || method === 'whatsapp' || method === 'coords' ? 'circle' : 'detected');
    setZoomAdj(0);
    setStep(2);
  };
  const goStep3 = () => {
    if (!loc) return;
    if (!name) setName(loc.label);
    if (loc.cat !== undefined) setCat(loc.cat);
    setStep(3);
  };

  const pickFile = (f: File | undefined) => {
    if (!f) return;
    setFile({ name: f.name, size: f.size });
    setParsing(true);
    window.setTimeout(() => setParsing(false), 900);
  };

  const lookup = () => {
    if (!parcelId.trim()) return;
    setParcelState('busy');
    window.setTimeout(() => setParcelState('found'), 900);
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) { setGeoMsg('Location is not available in this browser.'); return; }
    setGeoMsg('Finding you…');
    navigator.geolocation.getCurrentPosition(
      (p) => { setLat(p.coords.latitude.toFixed(5)); setLon(p.coords.longitude.toFixed(5)); setGeoMsg(`Accurate to about ${Math.round(p.coords.accuracy)} m.`); },
      () => setGeoMsg('Could not get your location. Type it in instead.'),
      { timeout: 8000 },
    );
  };

  const save = () => {
    if (!loc || !draft || !finalName || !finalProject) return;
    const id = 'p' + Date.now();
    const place: Place = {
      ...draft,
      id,
      name: finalName,
      project: finalProject,
      tags: tags.split(',').map((s) => s.trim()).filter(Boolean),
      details: [
        { l: 'Added via', v: SOURCE_LABEL[loc.source] },
        { l: 'Source', v: loc.via },
        { l: 'Outline', v: shape === 'detected' ? 'AI-detected boundary' : shape === 'circle' ? `Circle, ${radius} m radius` : shape === 'rect' ? `Rectangle, ${rw} × ${rh} m` : loc.givenLabel ?? 'Provided' },
        { l: 'Area', v: `${ha} ha` },
        ...(loc.details ?? []).filter((d) => d.l !== 'Added via'),
      ],
    };
    addPlace(place);
    const base = WATCHES[0];
    startWatch.forEach((sid, i) => {
      const sk = skills.find((s) => s.id === sid);
      if (!sk) return;
      const w: Watch = {
        ...base,
        id: `w${Date.now()}-${i}`,
        name: `${sk.name} · ${finalName}`,
        cat: sk.cat,
        placeId: id,
        skillId: sk.id,
        question: sk.short,
        metric: 'First result',
        unit: '',
        ci: [0, 0],
        condition: 'Any notable change since the last pass',
        value: 0,
        delta: 'Waiting for the first pass',
        confidence: 'Medium',
        status: 'ok',
        history: [...base.histMean],
        channels: ['email'],
        cadence: `Every pass (${sk.revisit})`,
        tier: sk.tier,
        on: true,
        lastRun: 'Not run yet',
        nextRun: 'Next pass',
        sat: sk.sat,
        img: thumb(place.lat, place.lon, place.zoom),
        ring: false,
        events: [],
      };
      addWatch(w);
    });
    close();
    notify(
      startWatch.length ? `${finalName} saved · ${startWatch.length} watch${startWatch.length > 1 ? 'es' : ''} started` : `${finalName} saved`,
      'Ask about it',
      () => go('ask', undefined, { place: id }),
      'check_circle',
    );
  };

  /* ---------- step bodies ---------- */

  const methodInput = (): ReactNode => {
    switch (method) {
      case 'search': {
        const s = query.trim().toLowerCase();
        const res = PLACE_RESULTS.map((r, i) => ({ ...r, i })).filter((r) => !s || `${r.n} ${r.d}`.toLowerCase().includes(s));
        return (
          <div className="col" style={{ gap: 10 }}>
            <div style={{ position: 'relative' }}>
              <Ms n="search" size={18} className="subtle" style={{ position: 'absolute', left: 12, top: 12 }} />
              <input className="input" autoFocus value={query} onChange={(e) => { setQuery(e.target.value); setResult(null); }} placeholder="e.g. Lake Mead, Garden City, Port of Rotterdam" style={{ paddingLeft: 38 }} aria-label="Search a place name" />
            </div>
            <div className="tiny">{s ? `${res.length} result${res.length === 1 ? '' : 's'}` : 'Suggestions'}</div>
            {res.length === 0 ? (
              <div className="caption">No match. Try coordinates, or draw it on the map instead.</div>
            ) : (
              <div className="col" style={{ gap: 2 }}>
                {res.map((r) => (
                  <button key={r.n} className={`menu-item ${result === r.i ? 'on' : ''}`} onClick={() => setResult(r.i)}>
                    <Ms n="location_on" />
                    <span className="grow">{r.n} <span className="caption">· {r.d}</span></span>
                    <span className="tiny hide-mobile">{fmtC(r.lat, r.lon)}</span>
                    {result === r.i && <Ms n="check" style={{ color: '#fff' }} />}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      }
      case 'coords':
        return (
          <div className="col" style={{ gap: 10 }}>
            <div className="row wrap" style={{ gap: 12, alignItems: 'flex-end' }}>
              <label className="field" style={{ flex: '1 1 140px' }}>
                Latitude
                <input className="input" inputMode="decimal" value={lat} placeholder="37.9785"
                  onChange={(e) => {
                    const v = e.target.value;
                    const both = v.split(/[,\s]+/).filter(Boolean);
                    if (both.length === 2 && isFinite(+both[0]) && isFinite(+both[1])) { setLat(both[0]); setLon(both[1]); } else setLat(v);
                  }} />
              </label>
              <label className="field" style={{ flex: '1 1 140px' }}>
                Longitude
                <input className="input" inputMode="decimal" value={lon} placeholder="-100.9155" onChange={(e) => setLon(e.target.value)} />
              </label>
              <Btn icon="near_me" onClick={useMyLocation}>Use my location</Btn>
            </div>
            <div className="caption">
              Decimal degrees, WGS84. You can paste “lat, lon” into the first box.{geoMsg && <> {geoMsg}</>}
              {(lat || lon) && !loc && <span style={{ color: 'var(--coral)' }}> Latitude must be within ±85, longitude within ±180.</span>}
            </div>
          </div>
        );
      case 'draw':
      case 'pin': {
        const isDraw = method === 'draw';
        return (
          <div className="col" style={{ gap: 10 }}>
            <div className="row wrap" style={{ gap: 8, justifyContent: 'space-between' }}>
              <label className="row caption" style={{ gap: 8 }}>
                Jump to
                <select className="input" style={{ height: 34, width: 'auto', fontSize: 13 }} value={drawAt}
                  onChange={(e) => { setDrawAt(+e.target.value); setVerts([]); setPin(null); setDrawZoom(+e.target.value === 0 ? 15 : 13); }}>
                  {jumps.map((j, i) => <option key={j.n} value={i}>{j.n}</option>)}
                </select>
              </label>
              {isDraw && (
                <div className="row" style={{ gap: 4 }}>
                  <Btn size="sm" variant="text" icon="undo" disabled={!verts.length} onClick={() => setVerts((v) => v.slice(0, -1))}>Undo</Btn>
                  <Btn size="sm" variant="text" icon="delete" disabled={!verts.length} onClick={() => setVerts([])}>Clear</Btn>
                </div>
              )}
            </div>
            <MapFrame H={240} center={drawCenter} zoom={drawZoom} setZoom={setDrawZoom} place={null} layers={NO_LAYERS}
              onPick={(dx, dy) => (isDraw ? setVerts((v) => [...v, [dx, dy]]) : setPin([dx, dy]))}>
              {(s, W, H) => isDraw ? (
                <g>
                  {verts.length > 1 && (
                    <polygon points={verts.map((v) => `${W / 2 + v[0] * s},${H / 2 + v[1] * s}`).join(' ')}
                      fill={verts.length > 2 ? 'rgba(255,255,255,.12)' : 'none'} stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
                  )}
                  {verts.map((v, i) => <circle key={i} cx={W / 2 + v[0] * s} cy={H / 2 + v[1] * s} r="4.5" fill={i === 0 ? '#fff' : '#000'} stroke="#fff" strokeWidth="2" />)}
                </g>
              ) : pin ? (
                <g>
                  <circle cx={W / 2 + pin[0] * s} cy={H / 2 + pin[1] * s} r="14" fill="rgba(43,137,255,.25)" />
                  <circle cx={W / 2 + pin[0] * s} cy={H / 2 + pin[1] * s} r="5" fill="#2b89ff" stroke="#fff" strokeWidth="2" />
                </g>
              ) : null}
            </MapFrame>
            <div className="caption">
              {isDraw
                ? verts.length < 3 ? `Click the corners of your area on the map (${verts.length}/3 minimum). You can refine the outline in the next step.` : `${verts.length} points · about ${areaHa(verts, drawCenter.lat)} ha. Keep clicking to add corners.`
                : pin ? `Pin at ${loc ? fmtC(loc.lat, loc.lon) : ''}. You'll set the radius next.` : 'Click once on the map to drop a pin.'}
            </div>
          </div>
        );
      }
      case 'upload':
        return (
          <div className="col" style={{ gap: 10 }}>
            <input ref={fileRef} type="file" hidden accept=".kml,.kmz,.geojson,.json,.zip,.shp,.csv,.gpx" onChange={(e) => pickFile(e.target.files?.[0])} />
            <div
              role="button"
              tabIndex={0}
              onClick={() => fileRef.current?.click()}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); pickFile(e.dataTransfer.files?.[0]); }}
              style={{
                border: `1px dashed ${dragOver ? '#fff' : 'var(--hair)'}`, borderRadius: 'var(--r)', padding: '28px 16px', background: dragOver ? 'var(--s2)' : 'var(--canvas)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, textAlign: 'center', cursor: 'pointer',
              }}
            >
              <Ms n="upload_file" size={28} className="muted" />
              <div className="ink" style={{ font: '600 14px/1.4 var(--font)' }}>Drop a file here or click to choose</div>
              <div className="caption">KML / KMZ, GeoJSON, Shapefile (.zip), GPX or CSV with lat/lon columns</div>
            </div>
            {file && (
              <div className="well row" style={{ padding: '10px 14px', gap: 10 }}>
                <Ms n="description" className="muted" />
                <div className="grow">
                  <div className="ink body-sm" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</div>
                  <div className="tiny">
                    {parsing ? 'Reading file…' : /\.csv$/i.test(file.name) ? '14 points found · we drew an outline around them · WGS84' : '1 polygon found · WGS84'}
                  </div>
                </div>
                {parsing ? <span className="spinner" /> : <Ms n="check_circle" style={{ color: 'var(--green)' }} />}
                <IconBtn icon="close" className="sm" aria-label="Remove file" onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ''; }} />
              </div>
            )}
          </div>
        );
      case 'parcel':
        return (
          <div className="col" style={{ gap: 10 }}>
            <div className="row wrap" style={{ gap: 12, alignItems: 'flex-end' }}>
              <label className="field" style={{ flex: '1 1 220px' }}>
                Register
                <select className="input" value={parcelSys} onChange={(e) => { setParcelSys(e.target.value); setParcelState('idle'); }}>
                  {PARCEL_SYS.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.tier === 'free' ? 'free' : '$0.50 / lookup'}</option>)}
                </select>
              </label>
              <label className="field" style={{ flex: '1 1 220px' }}>
                Parcel ID
                <input className="input" value={parcelId} placeholder={parcel.ph} onChange={(e) => { setParcelId(e.target.value); setParcelState('idle'); }} onKeyDown={(e) => e.key === 'Enter' && lookup()} />
              </label>
              <Btn variant="secondary" icon={parcelState === 'found' ? 'check' : 'travel_explore'} disabled={!parcelId.trim() || parcelState === 'busy'} onClick={lookup}
                tier={parcel.tier} tierLabel={parcel.tier === 'paid' ? '$0.50' : undefined}>
                {parcelState === 'busy' ? 'Looking up…' : parcelState === 'found' ? 'Found' : 'Look up'}
              </Btn>
            </div>
            <div className="caption">
              {parcelState === 'found'
                ? `Parcel found in ${parcel.name}. Official boundary loaded — check it in the next step.`
                : parcel.tier === 'paid' ? 'This register charges per lookup. You are only charged if the parcel is found.' : 'Free public register. Boundaries come straight from the official record.'}
            </div>
          </div>
        );
      case 'whatsapp':
        return (
          <div className="col" style={{ gap: 10 }}>
            <div className="body-sm">
              Standing in the field? In WhatsApp, tap <span className="ink">📎 → Location → Send your current location</span> to <span className="ink">{WA_NUMBER}</span> (Groundtruth). It shows up here within seconds — no app needed.
            </div>
            {!connectors.whatsapp.connected ? (
              <div className="well row wrap" style={{ padding: '12px 14px', gap: 12 }}>
                <Ms n="link_off" className="muted" />
                <div className="grow body-sm" style={{ minWidth: 180 }}>Connect your WhatsApp number first so we know which pins are yours.</div>
                <Btn variant="secondary" icon="chat" tier="free" onClick={() => open({ kind: 'connectors', focus: 'whatsapp' })}>Connect WhatsApp</Btn>
              </div>
            ) : (
              <div className="col" style={{ gap: 2 }}>
                <div className="tiny" style={{ marginBottom: 4 }}>Pins received from {connectors.whatsapp.number || 'your number'}</div>
                {WA_PINS.map((p) => (
                  <button key={p.id} className={`menu-item ${waPin === p.id ? 'on' : ''}`} onClick={() => setWaPin(p.id)}>
                    <Ms n="pin_drop" />
                    <span className="grow">
                      {p.note}
                      <span className="caption" style={{ display: 'block' }}>{p.from} · {p.when} · {fmtC(p.lat, p.lon)}</span>
                    </span>
                    {waPin === p.id && <Ms n="check" style={{ color: '#fff' }} />}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      case 'project': {
        const list = places.filter((p) => p.project === fromProject);
        return (
          <div className="col" style={{ gap: 10 }}>
            <div className="row wrap" style={{ gap: 6 }}>
              {projects.map((p) => (
                <button key={p} className={`chip ${fromProject === p ? 'on' : ''}`} onClick={() => { setFromProject(p); setFromPlace(null); }}>
                  <Ms n="folder" />{p}
                </button>
              ))}
            </div>
            {fromProject && (
              <div className="col" style={{ gap: 2 }}>
                {list.map((p) => (
                  <button key={p.id} className={`menu-item ${fromPlace === p.id ? 'on' : ''}`} onClick={() => setFromPlace(p.id)}>
                    <span className="dot" style={{ background: CATS[p.cat].color }} />
                    <span className="grow">{p.name} <span className="caption">· {areaHa(p.pts, p.lat)} ha</span></span>
                    {fromPlace === p.id && <Ms n="check" style={{ color: '#fff' }} />}
                  </button>
                ))}
              </div>
            )}
            {!fromProject && <div className="caption">Pick a project to see its places. The outline is copied; watches are not.</div>}
          </div>
        );
      }
      default:
        return null;
    }
  };

  const step1 = (
    <>
      <div className="subhead">How do you want to add it?</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
        {METHODS.map((mt) => {
          const on = method === mt.id;
          return (
            <button
              key={mt.id}
              onClick={() => setMethod(mt.id)}
              aria-pressed={on}
              style={{
                textAlign: 'left', padding: 12, borderRadius: 'var(--r)', display: 'flex', flexDirection: 'column', gap: 6,
                background: on ? 'var(--s2)' : 'var(--canvas)', border: `1px solid ${on ? '#fff' : 'var(--hair-soft)'}`, color: '#fff',
              }}
            >
              <span className="row" style={{ justifyContent: 'space-between', width: '100%' }}>
                <Ms n={mt.icon} size={22} style={{ color: on ? '#fff' : 'var(--muted)' }} />
                {mt.paid ? <Tier tier="paid" label="$0.50" /> : <Tier tier="free" />}
              </span>
              <span style={{ font: '600 14px/1.3 var(--font)' }}>{mt.title}</span>
              <span className="tiny">{mt.hint}</span>
            </button>
          );
        })}
      </div>
      {method && (
        <div className="panel fade-up" key={method} style={{ padding: 16, background: 'var(--s1)' }}>
          {methodInput()}
        </div>
      )}
      {!method && <div className="caption">Every method is free except official parcel lookups in a few countries (US, Kenya: $0.50 per parcel found).</div>}
    </>
  );

  const shapeOpts: { id: Shape; icon: string; label: string; ai?: boolean }[] = [
    ...(loc?.pts ? [{ id: 'given' as Shape, icon: 'check_circle', label: loc.givenLabel ?? 'As provided' }] : []),
    { id: 'detected', icon: 'auto_awesome', label: 'Detected field boundary', ai: true },
    { id: 'circle', icon: 'radio_button_unchecked', label: 'Circle' },
    { id: 'rect', icon: 'crop_square', label: 'Rectangle' },
  ];

  const step2 = loc && draft && (
    <>
      <div className="row wrap" style={{ justifyContent: 'space-between', gap: 8 }}>
        <div>
          <div className="subhead">Check the outline</div>
          <div className="caption" style={{ marginTop: 2 }}>{loc.via}</div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <span className="eyebrow">Area</span>
          <span style={{ font: '700 24px/1.17 var(--font)', letterSpacing: -0.5 }}>{ha.toLocaleString()}</span>
          <span className="body-sm">ha</span>
        </div>
      </div>
      <div className="seg" role="radiogroup" aria-label="Outline shape" style={{ flexWrap: 'wrap', alignSelf: 'flex-start', maxWidth: '100%' }}>
        {shapeOpts.map((o) => (
          <button key={o.id} role="radio" aria-checked={shape === o.id} className={shape === o.id ? 'on' : ''} onClick={() => setShape(o.id)}>
            <Ms n={o.icon} size={16} />
            {o.label}
            {o.ai && <span className="badge-ai" style={{ padding: '0 6px', fontSize: 10 }}>AI</span>}
          </button>
        ))}
      </div>
      <MapFrame H={300} center={{ lat: loc.lat, lon: loc.lon }} zoom={previewZoom} setZoom={(z) => setZoomAdj(z - baseZoom)} place={draft} layers={CONTOUR} />
      {shape === 'circle' && <Slider label="Radius" value={radius} min={50} max={2000} step={10} unit="m" onChange={setRadius} />}
      {shape === 'rect' && (
        <div className="row wrap" style={{ gap: 16 }}>
          <Slider label="Width (east–west)" value={rw} min={50} max={3000} step={10} unit="m" onChange={setRw} />
          <Slider label="Height (north–south)" value={rh} min={50} max={3000} step={10} unit="m" onChange={setRh} />
        </div>
      )}
      <div className="well row" style={{ padding: '10px 14px', gap: 10, alignItems: 'flex-start' }}>
        <Ms n="info" size={18} className="muted" style={{ marginTop: 1 }} />
        <div className="body-sm">
          {shape === 'detected'
            ? 'Auto-detected boundaries can be off by 10–20 m at field edges. Adjust before running analyses.'
            : shape === 'given' && loc.source === 'parcel'
              ? 'Registered parcel boundaries are legal lines — the planted area inside can differ. Results are reported for the full parcel.'
              : 'Satellite pixels are 10 m wide, so the outermost 10 m of any outline mixes with what is next to it.'}
          {ha < 1 && <span style={{ color: 'var(--yellow)' }}> Under 1 ha, free 10 m imagery gives fewer than 100 pixels — results will be less certain.</span>}
        </div>
      </div>
    </>
  );

  const step3 = loc && (
    <>
      <div className="subhead">Details</div>
      <div className="row wrap" style={{ gap: 12 }}>
        <label className="field" style={{ flex: '1 1 240px' }}>
          Name
          <input className="input" value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder="e.g. East paddock" />
        </label>
        <label className="field" style={{ flex: '1 1 200px' }}>
          Project
          <select className="input" value={project} onChange={(e) => setProject(e.target.value)}>
            {projects.map((p) => <option key={p} value={p}>{p}</option>)}
            <option value="__new">New project…</option>
          </select>
        </label>
      </div>
      {project === '__new' && (
        <label className="field">
          New project name
          <input className="input" value={newProject} onChange={(e) => setNewProject(e.target.value)} placeholder="e.g. Nakuru dairy co-op" autoFocus />
        </label>
      )}
      <div className="field">
        Category
        <div className="row wrap" style={{ gap: 6 }}>
          {CATS.map((c, i) => (
            <button key={c.key} className={`chip ${cat === i ? 'on' : ''}`} onClick={() => setCat(i)} aria-pressed={cat === i}>
              <span className="dot" style={{ background: c.color, boxShadow: cat === i ? '0 0 0 1px #000' : undefined }} />
              {c.name}
            </button>
          ))}
        </div>
      </div>
      <label className="field">
        Tags <span className="tiny">Comma separated</span>
        <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="e.g. Maize, Drip irrigation" />
      </label>
      {suggested.length > 0 && (
        <div className="field">
          Start watching <span className="tiny">Optional · re-runs on every new satellite pass</span>
          <div className="col" style={{ gap: 6 }}>
            {suggested.map((sk) => {
              const on = startWatch.includes(sk.id);
              return (
                <button key={sk.id} onClick={() => setStartWatch((s) => (on ? s.filter((x) => x !== sk.id) : [...s, sk.id]))} aria-pressed={on}
                  className="well row" style={{ padding: '10px 14px', gap: 12, textAlign: 'left', color: '#fff', borderColor: on ? 'var(--hair)' : undefined }}>
                  <Check on={on} />
                  <span className="grow">
                    <span style={{ font: '600 14px/1.4 var(--font)' }}>{sk.name}</span>
                    <span className="caption" style={{ display: 'block' }}>{sk.short} · {sk.sat}</span>
                  </span>
                  <Tier tier={sk.tier} label={sk.tier === 'paid' ? sk.cost : undefined} />
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="well row wrap" style={{ padding: '10px 14px', gap: 12 }}>
        <span className="caption">{SOURCE_LABEL[loc.source]}</span>
        <span className="caption">·</span>
        <span className="caption">{fmtC(loc.lat, loc.lon)}</span>
        <span className="caption">·</span>
        <span className="caption">{ha} ha</span>
      </div>
    </>
  );

  return (
    <Modal size="wide" onClose={close} label="Add a place">
      <ModalHead eyebrow="New place" title="Add a place" sub="Save a field, plot, site or water body once — then ask about it or watch it." onClose={close} />
      <Steps step={step} />
      {step === 1 && step1}
      {step === 2 && step2}
      {step === 3 && step3}
      <div className="modal-foot" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        {step === 1 ? <Btn variant="text" onClick={close}>Cancel</Btn> : <Btn variant="text" icon="arrow_back" onClick={() => setStep(step - 1)}>Back</Btn>}
        {step === 1 && <Btn variant="primary" trailing="arrow_forward" disabled={!loc} onClick={goStep2}>Continue</Btn>}
        {step === 2 && <Btn variant="primary" trailing="arrow_forward" disabled={!loc || ha <= 0} onClick={goStep3}>Continue</Btn>}
        {step === 3 && <Btn variant="primary" icon="check" tier="free" disabled={!finalName || !finalProject} onClick={save}>Save place</Btn>}
      </div>
    </Modal>
  );
}
