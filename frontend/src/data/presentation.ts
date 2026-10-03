/**
 * Presentation for backend-owned reference data.
 *
 * The API owns a category's identity (`key`, `name`, `icon`, what it is used for, which
 * satellites serve it). Colour is a *design* decision from `docs/design/`, so it lives here
 * and is merged onto the API's categories by `toCategory()` in `../model.ts`.
 *
 * Keyed on the stable `key` string, so adding or reordering categories on the backend cannot
 * silently recolour the UI.
 */

export interface CategoryStyle {
  /** Accent colour for dots, pills and chart series. */
  color: string;
  /** Readable foreground when `color` is used as a background. */
  fg: string;
}

const FALLBACK: CategoryStyle = { color: '#b2b6bd', fg: '#000' };

const CATEGORY_STYLES: Record<string, CategoryStyle> = {
  agriculture: { color: '#ffcf25', fg: '#000' },
  water: { color: '#14c6cb', fg: '#000' },
  forests: { color: '#00ca8e', fg: '#000' },
  disasters: { color: '#e62b1e', fg: '#fff' },
  urban: { color: '#7b42bc', fg: '#fff' },
  oceans: { color: '#1868f2', fg: '#fff' },
  air: { color: '#fbeabf', fg: '#000' },
  finance: { color: '#2b89ff', fg: '#000' },
  society: { color: '#911ced', fg: '#fff' },
};

/** A category key the backend sends but the design has no colour for still renders. */
export const categoryStyle = (key: string): CategoryStyle => CATEGORY_STYLES[key] ?? FALLBACK;

/** Status colours for watches, shared by the overview cards, detail page and map pins. */
export const STATUS_STYLE = {
  ok: { label: 'Normal', color: 'var(--green)' },
  warn: { label: 'Needs attention', color: 'var(--yellow)' },
  alert: { label: 'Alert', color: 'var(--red)' },
} as const;

/** How a place was added — label for the `source` field the API returns. */
export const SOURCE_LABEL: Record<string, string> = {
  drawn: 'Drawn on map',
  uploaded: 'Uploaded file',
  search: 'From search',
  coords: 'From coordinates',
  whatsapp: 'WhatsApp location',
  parcel: 'Parcel / cadastre ID',
  pin: 'Dropped pin + radius',
};

export const sourceLabel = (source: string) => SOURCE_LABEL[source] ?? 'Added manually';
