/**
 * Shared vocabulary for the add-place wizard.
 *
 * `Loc` is the contract between the eight locate-methods and the rest of the wizard: whatever
 * the user did — searched, drew, uploaded, pasted coordinates — the method reduces it to this
 * one shape, or to `null` while there is not enough input yet. Steps 2 and 3 know nothing about
 * which method produced it.
 */

import type { PlaceSource } from '../../api/types';
import type { Pt } from '../../lib/geo';
import type { MapLayers } from '../../components/MapView';

export type Method = 'search' | 'coords' | 'draw' | 'upload' | 'parcel' | 'whatsapp' | 'pin' | 'project';

/**
 * The methods offered in step 1. `upload`, `parcel` and `whatsapp` still have components, but
 * they need backend endpoints that do not exist yet (parse-file, lookup-parcel, a WhatsApp
 * bot), so they are not listed: a method that can only fail is worse than no method.
 */
export const METHODS: { id: Method; icon: string; title: string; hint: string }[] = [
  { id: 'search', icon: 'search', title: 'Search a place name', hint: 'Town, farm, lake, port or region' },
  { id: 'draw', icon: 'draw', title: 'Draw on map', hint: 'Click the corners of your field' },
  { id: 'pin', icon: 'location_on', title: 'Drop pin + radius', hint: 'One tap, then set a radius' },
  { id: 'project', icon: 'folder_open', title: 'Copy from a project', hint: 'Reuse a place another project has' },
];

/** What a locate-method yields. `null` from a method means "not enough input yet". */
export interface Loc {
  lat: number;
  lon: number;
  label: string;
  source: PlaceSource;
  /** Human-readable provenance, stored on the saved place as "Source". */
  via: string;
  /** An outline the method already has, in reference-zoom pixels. */
  pts?: Pt[];
  circle?: boolean;
  /** How to describe that outline in the saved place's details. */
  givenLabel?: string;
  categoryKey?: string;
  project?: string;
  details?: { label: string; value: string }[];
}

/** Which outline the user settled on in step 2. */
export type Shape = 'given' | 'detected' | 'circle' | 'rect';

/** Every locate-method renders inputs and reports a `Loc` (or `null`) upward. */
export interface MethodProps {
  onChange: (loc: Loc | null) => void;
}

export const NO_LAYERS: MapLayers = { contour: false };
export const CONTOUR: MapLayers = { contour: true };
