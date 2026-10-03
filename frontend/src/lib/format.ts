/**
 * Display formatting, in one place.
 *
 * Previously these were scattered: `slug` existed three times (two copies in `data/catalog.ts`
 * and one in `pages/libraryParts.tsx`), the number formatters lived in `pages/WatchDetail.tsx`
 * and were imported by another page, and `nextRank()` parsed display strings like
 * `"Sep 28, 18:04"` back into something sortable. Dates now arrive as ISO instants, so that
 * parsing is gone — compare the Date objects instead.
 */


/* ---------------- numbers ---------------- */

/** Uses a real minus sign (U+2212) rather than a hyphen, which reads badly at small sizes. */
export const fmtNum = (v: number) => {
  const s = Number.isInteger(v) ? String(v) : String(+v.toFixed(2));
  return s.replace('-', '−');
};

export const fmtVal = (v: number, unit: string) =>
  `${fmtNum(v)}${unit ? (unit.startsWith('%') || unit.startsWith('°') ? '' : ' ') + unit : ''}`;

export const ciLabel = (w: { ci: [number, number] }) =>
  w.ci[0] === w.ci[1] ? 'Exact count' : `90% range ${fmtNum(w.ci[0])}–${fmtNum(w.ci[1])}`;

export const fmtRuns = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `${n}`);

/** URL/id-safe slug. The single definition — was duplicated in three places. */
export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

/* ---------------- dates ---------------- */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** `Sep 28` — or `Sep 28, 2025` when it is not the current year. */
export const fmtDate = (d: Date | null, fallback = '—') => {
  if (!d) return fallback;
  const now = new Date();
  const base = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base}, ${d.getFullYear()}`;
};

/** `Today, 06:10` / `Tomorrow, 12:00` / `Sep 28, 18:04`. */
export const fmtDateTime = (d: Date | null, fallback = '—') => {
  if (!d) return fallback;
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (sameDay(d, now)) return `Today, ${hhmm(d)}`;
  if (sameDay(d, tomorrow)) return `Tomorrow, ${hhmm(d)}`;
  return `${fmtDate(d)}, ${hhmm(d)}`;
};

/** `Today` / `Tomorrow` / `Oct 5`, for a next-run column where the time is noise. */
export const fmtDay = (d: Date | null, fallback = 'Paused') => {
  if (!d) return fallback;
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (sameDay(d, now)) return 'Today';
  if (sameDay(d, tomorrow)) return 'Tomorrow';
  return fmtDate(d);
};

export const fmtMonthYear = (d: Date | null, fallback = '—') =>
  d ? `${MONTHS[d.getMonth()]} ${d.getFullYear()}` : fallback;

/** Sort key for a nullable date: nulls (paused, unscheduled) last. */
export const timeKey = (d: Date | null) => (d ? d.getTime() : Number.POSITIVE_INFINITY);

/* ---------- cloud cover ---------- */

/**
 * Cloud cover is expressed in TWO different units in the contract, which is easy to get wrong
 * and was: the answer's proof list rendered a 4% scene as "400%" until this was fixed.
 *
 *   ProofScene.cloud            percent   (`app/schemas/answer.py` says so explicitly)
 *   StripScene.cloud            0..1      (`earth/blocks.py`)
 *   Provenance.cloud_over_area  0..1      (`earth/types.py`)
 *
 * So there are two formatters rather than one, each named for the unit it takes. A call site
 * then has to say which it has, instead of assuming. Raised on #43 — if the contract settles on
 * one unit, one of these goes away.
 */

/** For a 0..1 fraction, e.g. `StripScene.cloud`, `Provenance.cloud_over_area`. */
export const cloudFromFraction = (v: number): string => `${Math.round(v * 100)}%`;

/** For a value already in percent, e.g. `ProofScene.cloud`. */
export const cloudFromPercent = (v: number): string => `${Math.round(v)}%`;
