/**
 * Friendly, satellite-free names for the map layers.
 *
 * The catalog ids come from the backend (`ndvi`, `lst`...). Users should never see index
 * names or sensor names, so each id maps to a plain-language label, icon and legend.
 */

export interface LayerLook {
  label: string;
  icon: string;
  /** One line shown in the legend of the active layer. */
  legend: string;
  /** Gradient stops for the legend bar, low to high. */
  ramp: string[];
}

const LOOKS: Record<string, LayerLook> = {
  outline: { label: 'Outline', icon: 'pentagon', legend: 'The boundary of your place', ramp: ['#ffffff', '#ffffff'] },
  truecolour: { label: 'True colour', icon: 'image', legend: 'The ground as the eye would see it', ramp: ['#3d4a2c', '#8a7a5a', '#cfc7b0'] },
  ndvi: { label: 'Plant health', icon: 'eco', legend: 'Brown is stressed or bare, green is thriving', ramp: ['#8a5a2b', '#d6c25a', '#2f9e44'] },
  ndmi: { label: 'Moisture', icon: 'water_drop', legend: 'Dry on the left, wet on the right', ramp: ['#c9a227', '#7fb7d9', '#1b5fa8'] },
  lst: { label: 'Heat', icon: 'device_thermostat', legend: 'Cooler to hotter ground', ramp: ['#2b6cb0', '#f2d15b', '#d9381e'] },
  water: { label: 'Water', icon: 'waves', legend: 'Open water shown in blue', ramp: ['#d9e6f2', '#1d78c1'] },
  dry: { label: 'Dry spots', icon: 'grain', legend: 'Patches that stayed dry on several dates', ramp: ['#5a4a2a', '#e8a33a'] },
  burn: { label: 'Burnt ground', icon: 'local_fire_department', legend: 'Recently burnt areas shown darker', ramp: ['#3a2a22', '#d9381e'] },
  roughness: { label: 'Surface texture', icon: 'texture', legend: 'Smooth surfaces dark, rough ones bright (radar)', ramp: ['#22252b', '#d0d3d8'] },
  clouds: { label: 'Clouds', icon: 'cloud', legend: 'Where clouds or shadows hid the ground', ramp: ['#3a3f48', '#e6e8ec'] },
};

const ALIAS: Record<string, string> = { greenness: 'ndvi', moisture: 'ndmi', heat: 'lst', base: 'truecolour', rgb: 'truecolour', bare: 'dry' };

const FALLBACK: LayerLook = { label: 'Layer', icon: 'layers', legend: '', ramp: ['#3a3f48', '#b2b6bd'] };

/** Look up a layer id (or a block measure name), tolerating unknown ids. */
export function layerLook(id: string, fallbackName?: string): LayerLook {
  const key = id.toLowerCase();
  const hit = LOOKS[key] ?? LOOKS[ALIAS[key] ?? ''];
  if (hit) return hit;
  return { ...FALLBACK, label: fallbackName ?? FALLBACK.label };
}
