// Categories, satellites, skill modules and the skills library.

export interface Category {
  key: string;
  name: string;
  icon: string;
  color: string;
  fg: string;
  uses: string;
  sats: string;
}

export const CATS: Category[] = [
  { key: 'agriculture', name: 'Agriculture', icon: 'agriculture', color: '#ffcf25', fg: '#000', uses: 'Crop health, dry patches, yield, pasture for herders', sats: 'Sentinel-2, Landsat, Sentinel-1' },
  { key: 'water', name: 'Water Bodies', icon: 'water_drop', color: '#14c6cb', fg: '#000', uses: 'Reservoir levels, algae/red tide, water use', sats: 'Sentinel-2, Sentinel-3, SWOT' },
  { key: 'forests', name: 'Forests & Nature', icon: 'forest', color: '#00ca8e', fg: '#000', uses: 'Deforestation alerts, EUDR proof, mangroves, carbon credits', sats: 'Sentinel-2, Sentinel-1, Landsat' },
  { key: 'disasters', name: 'Disasters & Risk', icon: 'local_fire_department', color: '#e62b1e', fg: '#fff', uses: 'Fire, flood, storm damage, landslides / ground sinking', sats: 'VIIRS/FIRMS, Sentinel-1, Sentinel-2' },
  { key: 'urban', name: 'Urban & Real Estate', icon: 'location_city', color: '#7b42bc', fg: '#fff', uses: 'Land-use change, construction, heat maps, roof solar', sats: 'Sentinel-2, Landsat thermal (+ paid high-res)' },
  { key: 'oceans', name: 'Oceans & Coasts', icon: 'sailing', color: '#1868f2', fg: '#fff', uses: 'Fishing zones, dark ships, coral reefs', sats: 'Sentinel-3, MODIS/VIIRS, Sentinel-1' },
  { key: 'air', name: 'Air & Climate', icon: 'air', color: '#fbeabf', fg: '#000', uses: 'Air pollution, methane leaks', sats: 'Sentinel-5P, EMIT' },
  { key: 'finance', name: 'Finance & Insurance', icon: 'account_balance', color: '#2b89ff', fg: '#000', uses: 'Port activity, crop forecasts, crop insurance, lender checks', sats: 'Sentinel-1/2, MODIS (+ paid high-res)' },
  { key: 'society', name: 'Society & Public Good', icon: 'diversity_3', color: '#911ced', fg: '#fff', uses: 'Poverty mapping, mosquito areas, fact-checking, education, heritage', sats: 'VIIRS night lights, Sentinel-2, Landsat' },
];

export interface Satellite {
  id: string;
  name: string;
  res: string;
  revisit: string;
  tier: 'free' | 'paid';
  price?: string;
  kind: 'optical' | 'radar' | 'thermal' | 'atmos' | 'lights';
  note: string;
}

export const SATS: Record<string, Satellite> = {
  s2: { id: 's2', name: 'Sentinel-2 L2A', res: '10 m', revisit: '5 days', tier: 'free', kind: 'optical', note: 'Multispectral, good for NDVI/NDMI' },
  l9: { id: 'l9', name: 'Landsat 9 TIRS', res: '30 m (100 m thermal)', revisit: '8 days', tier: 'free', kind: 'thermal', note: 'Surface temperature' },
  s1: { id: 's1', name: 'Sentinel-1 SAR', res: '10 m', revisit: '6 days', tier: 'free', kind: 'radar', note: 'Sees through clouds, day and night' },
  ps: { id: 'ps', name: 'PlanetScope', res: '3 m', revisit: 'Daily', tier: 'paid', price: '$1.80 / km²', kind: 'optical', note: 'For very small fields' },
  hr: { id: 'hr', name: 'Pléiades Neo', res: '30 cm', revisit: 'On order', tier: 'paid', price: '$12 / km²', kind: 'optical', note: 'Very high resolution, tasked' },
  s3: { id: 's3', name: 'Sentinel-3 OLCI', res: '300 m', revisit: 'Daily', tier: 'free', kind: 'optical', note: 'Ocean and lake colour' },
  viirs: { id: 'viirs', name: 'VIIRS / FIRMS', res: '375 m', revisit: '~12 hours', tier: 'free', kind: 'thermal', note: 'Active fire hotspots' },
  s5p: { id: 's5p', name: 'Sentinel-5P', res: '5.5 km', revisit: 'Daily', tier: 'free', kind: 'atmos', note: 'Air quality gases' },
};

/** Modules a skill is composed from. A skill = ordered list of these with params. */
export interface StepModule {
  id: string;
  name: string;
  icon: string;
  desc: string;
  group: 'Input' | 'Data' | 'Analysis' | 'Output';
  params?: Record<string, string | number | boolean | string[]>;
}

export const MODULES: StepModule[] = [
  { id: 'ask.clarify', name: 'Ask', icon: 'help', group: 'Input', desc: 'Ask the user a few short questions before running.', params: { questions: ['What crop?', 'How is it watered?'] } },
  { id: 'area.mark', name: 'Mark the area', icon: 'pentagon', group: 'Input', desc: 'Use a saved place or ask the user to draw or upload one.', params: { min_ha: 1 } },
  { id: 'time.window', name: 'Pick dates', icon: 'date_range', group: 'Data', desc: 'Recent window plus the same window in past years.', params: { recent_days: 45, baseline_years: 3 } },
  { id: 'sat.route', name: 'Pick the satellite', icon: 'satellite_alt', group: 'Data', desc: 'Route to free sources first; paid only if the area is too small.', params: { prefer: 'free', candidates: ['s2', 'l9', 'ps'] } },
  { id: 'scenes.filter', name: 'Find clear images', icon: 'filter_drama', group: 'Data', desc: 'Skip cloudy scenes and scenes right after rain.', params: { max_cloud_pct: 20, skip_after_rain_h: 48 } },
  { id: 'scenes.clean', name: 'Clean the images', icon: 'content_cut', group: 'Data', desc: 'Clip to the area and mask clouds and shadows.', params: { mask: 'SCL' } },
  { id: 'index.compute', name: 'Calculate indices', icon: 'calculate', group: 'Analysis', desc: 'Spectral indices such as NDVI, NDMI, NDWI or LST.', params: { indices: ['NDMI', 'NDVI', 'LST'] } },
  { id: 'detect.anomaly', name: 'Find anomalies', icon: 'troubleshoot', group: 'Analysis', desc: 'Zones far from the area median on N or more dates.', params: { min_dates: 2, z_score: -1.5 } },
  { id: 'detect.change', name: 'Find changes', icon: 'compare', group: 'Analysis', desc: 'Compare each date with a baseline and list changes.', params: { min_area_ha: 0.5 } },
  { id: 'explain.cause', name: 'Find the cause', icon: 'psychology', group: 'Analysis', desc: 'Check elevation, soil and weather to suggest a cause.', params: { layers: ['elevation', 'soil', 'rain'] } },
  { id: 'output.map', name: 'Show the answer', icon: 'map', group: 'Output', desc: 'Map layers, key numbers with confidence ranges, next steps.', params: { confidence: true } },
  { id: 'output.watch', name: 'Keep watching', icon: 'visibility', group: 'Output', desc: 'Re-run on each new pass and alert on a condition.', params: { every: 'new pass' } },
];

export interface Skill {
  id: string;
  cat: number;
  name: string;
  sat: string;
  cost: string;
  tier: 'free' | 'paid';
  short: string;
  long: string;
  dev: string;
  official: boolean;
  verified: boolean;
  lat: number;
  lon: number;
  res: string;
  revisit: string;
  runs: number;
  rating: number;
  version: string;
  updated: string;
  steps: string[];
  accuracy: string;
  limits: string[];
}

const OFFICIAL = new Set(['Groundtruth Labs', 'Groundtruth']);

const BASE_STEPS = ['area.mark', 'time.window', 'sat.route', 'scenes.filter', 'scenes.clean', 'index.compute', 'detect.change', 'output.map'];

type Row = [number, string, string, string, string, string, string, number, number, string, string, (string[] | null)?, boolean?];

// Ported from the prototype's PR presets; community entries added so the official/community split has substance.
const ROWS: Row[] = [
  [0, 'Dry patch finder', 'Sentinel-2 · Landsat 9 thermal', 'Free', 'Finds parts of a field that stay drier than the rest on two or more dates.', 'Compares NDMI (plant water) and land surface temperature across every clear pass in the last six weeks and the same window in past years. Zones that stay much drier than the field median on two or more dates are flagged, sized in hectares, and checked against elevation and soil maps to suggest a cause.', 'Groundtruth Labs', 37.9785, -100.9155, '10 m', '5 days', ['ask.clarify', 'area.mark', 'time.window', 'sat.route', 'scenes.filter', 'scenes.clean', 'index.compute', 'detect.anomaly', 'explain.cause', 'output.map']],
  [0, 'Weekly crop health', 'Sentinel-2', 'Free', 'A clean NDVI map of every field after each clear pass.', 'Builds a cloud-free NDVI composite for each field contour every week, highlights zones that dropped more than 0.1 since the previous pass, and keeps a season curve you can compare with earlier years.', 'AgriSense Co-op', 36.6, -120.1, '10 m', '5 days'],
  [0, 'Pasture for herders', 'Sentinel-2 · Sentinel-1', 'Free', 'Shows where grass is growing so herds can move to better grazing.', 'Combines optical greenness with radar soil moisture so the map still updates through cloudy weeks. Results are summarised per grazing block and can be sent as a short WhatsApp or text message.', 'Rangeland Watch', -2.6, 37.2, '10–20 m', '6 days'],
  [0, 'Small-field stress (3 m)', 'PlanetScope', '$1.80 / km²', 'Daily 3 m stress map for fields too small for Sentinel-2.', 'Routes to PlanetScope when a field is under 2 ha so the edges are not lost in 10 m pixels. Runs the same NDMI and NDVI anomaly checks as the free version.', 'Groundtruth Labs', 12.97, 77.59, '3 m', 'Daily', null, true],
  [1, 'Reservoir level tracker', 'Sentinel-2 · SWOT', 'Free', 'Water surface area and height for any lake or reservoir.', 'Maps the water edge from Sentinel-2 using the NDWI index and pairs it with SWOT water-height measurements to estimate volume change over time.', 'Groundtruth Labs', 36.13, -114.45, '10 m / 100 m', '5–21 days'],
  [1, 'Algae & red tide alert', 'Sentinel-3 OLCI', 'Free', 'Chlorophyll and bloom warnings for lakes and coasts.', 'Uses Sentinel-3 OLCI ocean colour bands to estimate chlorophyll-a and cyanobacteria, and sends a warning when a bloom grows past a set size near beaches or water intakes.', 'BlueShore Analytics', 41.7, -83.2, '300 m', 'Daily'],
  [1, 'Irrigation water use', 'Sentinel-2 · Landsat thermal', 'Free', 'Estimates how much water each field used this month.', 'Calculates evapotranspiration from Landsat surface temperature and Sentinel-2 vegetation cover, then totals it per field to compare with water rights or allocations.', 'Canal Data', 30.8, 31.0, '30 m', '8 days'],
  [2, 'Deforestation alerts', 'Sentinel-1 · Sentinel-2', 'Free', 'Weekly alerts for new forest clearing, even under clouds.', 'Radar backscatter change from Sentinel-1 catches clearing through cloud cover; Sentinel-2 confirms it on the next clear pass. Each alert includes area, date and a before/after image.', 'Groundtruth Labs', -10.0, -63.0, '10 m', '6 days'],
  [2, 'EUDR proof pack', 'Sentinel-2 · Landsat', '$9 / plot', 'Shows a plot has not been cleared since December 2020.', 'Builds a dated history of forest cover for each plot from 2020 to today and exports a signed report with images and coordinates in the format buyers ask for under the EU Deforestation Regulation.', 'Traceable Earth', 6.0, -6.5, '10–30 m', '5 days', null, true],
  [2, 'Mangrove extent', 'Sentinel-2', 'Free', 'Tracks mangrove gain and loss along a coastline.', 'Classifies mangrove cover each year with a vegetation and water index model and reports change by hectare for restoration and blue-carbon projects.', 'Tidewood', 21.9, 89.2, '10 m', '5 days'],
  [3, 'Active fire map', 'VIIRS / FIRMS', 'Free', 'Fire hotspots near your sites within hours of a pass.', 'Pulls NASA FIRMS hotspots from VIIRS and MODIS, groups them into fire fronts, and alerts when one comes within a set distance of a field, plant or town.', 'Groundtruth Labs', 39.8, -121.4, '375 m', '~12 hours'],
  [3, 'Flood extent', 'Sentinel-1', 'Free', 'Maps flooded land through cloud and at night.', 'Detects open water from Sentinel-1 radar and compares it with a dry-season baseline to show newly flooded areas, with an estimate of affected farmland and roads.', 'Floodline', 26.5, 68.0, '10 m', '6 days'],
  [3, 'Ground sinking', 'Sentinel-1 InSAR', 'Free', 'Millimetre-scale ground movement for buildings and slopes.', 'Runs InSAR time series on Sentinel-1 radar to measure subsidence and slope movement, flagging points that move faster than a set rate per year.', 'Strata Motion', 19.43, -99.13, '~20 m', '12 days'],
  [4, 'Land-use change', 'Sentinel-2', 'Free', 'See what was built, cleared or planted between two dates.', 'Classifies land cover for two dates and lists every change by type and area, for zoning checks and due diligence on a parcel.', 'Groundtruth Labs', 25.08, 55.2, '10 m', '5 days'],
  [4, 'Urban heat map', 'Landsat 9 thermal', 'Free', 'Finds the hottest streets and blocks in summer.', 'Averages clear-sky Landsat surface temperature over the summer and ranks neighbourhoods so cities can plan trees, cool roofs and shade.', 'Cool Blocks', 33.45, -112.07, '30 m', '8 days'],
  [4, 'Rooftop solar potential', 'Paid high-res + elevation', '$0.40 / roof', 'Estimates panel area and yearly output for each roof.', 'Uses 30–50 cm imagery and a surface model to measure roof faces, shading and tilt, then estimates usable panel area and annual kWh per building.', 'Sunroof Data', 52.52, 13.4, '30–50 cm', 'On order', null, true],
  [5, 'Fishing zones', 'Sentinel-3 · MODIS/VIIRS', 'Free', 'Daily map of where fish are likely to gather.', 'Combines sea surface temperature fronts and chlorophyll to highlight likely fishing grounds, delivered as a light map for low-bandwidth phones at sea.', 'Catch Forecast', -12.0, -77.3, '300 m–1 km', 'Daily'],
  [5, 'Dark ship detection', 'Sentinel-1', 'Free', 'Finds vessels that switched off their tracking transponder.', 'Detects ships in Sentinel-1 radar and matches them against AIS tracks. Ships with no matching AIS signal are listed with position and time.', 'OpenWake', 26.5, 56.3, '10 m', '6 days'],
  [5, 'Coral reef watch', 'Sentinel-2 · MODIS SST', 'Free', 'Early warning for heat stress and bleaching on reefs.', 'Tracks accumulated heat stress from sea surface temperature and checks shallow-water reef colour in Sentinel-2 to flag likely bleaching.', 'Reef Pulse', -18.3, 147.7, '10 m / 1 km', 'Daily'],
  [6, 'Air pollution (NO₂)', 'Sentinel-5P', 'Free', 'Daily nitrogen dioxide levels over cities and industry.', 'Maps tropospheric NO₂ from Sentinel-5P TROPOMI and compares each week with the same week in past years, adjusted for weather.', 'Groundtruth Labs', 45.2, 10.0, '5.5 km', 'Daily'],
  [6, 'Methane leak finder', 'EMIT · Sentinel-5P', 'Free', 'Spots large methane plumes from wells, pipelines and landfills.', 'Screens Sentinel-5P for methane hot spots, then checks EMIT hyperspectral scenes to pin down the plume source and estimate its rate.', 'Plume Hunter', 31.9, -102.1, '60 m / 5.5 km', 'Daily / tasked'],
  [6, 'Wildfire smoke tracker', 'Sentinel-5P · VIIRS', 'Free', 'Follows smoke plumes and the aerosol load over towns.', 'Combines the Sentinel-5P aerosol index with VIIRS fire detections to show where smoke is drifting and which places sit under it.', 'Haze Map', 44.5, -121.5, '5.5 km', 'Daily'],
  [7, 'Port activity index', 'Sentinel-1 · Sentinel-2', 'Free', 'Counts ships and containers at major ports each week.', 'Counts vessels in radar and estimates container yard fill in optical imagery to give a weekly activity index that moves ahead of official trade data.', 'Harbour Signal', 51.95, 4.05, '10 m', '3–6 days'],
  [7, 'Crop insurance check', 'Sentinel-1/2 + paid high-res', '$4 / claim', 'Verifies crop loss claims with before and after images.', 'Compares crop condition before and after a reported event, measures the affected area, and attaches high-resolution imagery where the claim needs it.', 'Groundtruth Labs', 42.0, -93.5, '10 m / 50 cm', '5 days', null, true],
  [7, 'Lender field check', 'Sentinel-2', 'Free', 'Confirms a farm exists and is being farmed before a loan.', 'Checks parcel boundaries, crop history and planting dates over the past three seasons and returns a one-page summary for loan officers.', 'Ledger Fields', 30.9, 75.8, '10 m', '5 days'],
  [8, 'Poverty mapping', 'VIIRS night lights', 'Free', 'Estimates economic activity from night-time lights.', 'Uses monthly VIIRS night-light composites with population data to estimate where economic activity is growing or falling, down to district level.', 'Open Atlas', 6.5, 3.4, '500 m', 'Monthly'],
  [8, 'Mosquito risk areas', 'Sentinel-2 · Landsat', 'Free', 'Finds standing water and warm, humid areas where mosquitoes breed.', 'Maps small water bodies, vegetation and surface temperature to rank villages by breeding-site risk for spraying and bed-net campaigns.', 'Vector Map', 0.35, 32.6, '10–30 m', '5 days'],
  [8, 'Heritage site watch', 'Sentinel-2', 'Free', 'Watches for looting pits, building or erosion at heritage sites.', 'Compares each new pass with a baseline for protected sites and flags new disturbance such as digging, roads or construction.', 'Ancient Ground', 30.33, 35.44, '10 m', '5 days'],
];

const VERIFIED_COMMUNITY = new Set(['AgriSense Co-op', 'BlueShore Analytics', 'Floodline', 'Traceable Earth']);

export const SKILLS: Skill[] = ROWS.map((a, i) => {
  const official = OFFICIAL.has(a[6]);
  const paid = !!a[12];
  const lim = a[9].includes('km') || a[9].includes('300 m') || a[9].includes('375 m') || a[9].includes('500 m');
  return {
    id: a[1].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
    cat: a[0],
    name: a[1],
    sat: a[2],
    cost: a[3],
    tier: paid ? 'paid' : 'free',
    short: a[4],
    long: a[5],
    dev: a[6],
    official,
    verified: official || VERIFIED_COMMUNITY.has(a[6]),
    lat: a[7],
    lon: a[8],
    res: a[9],
    revisit: a[10],
    runs: Math.round(40 + ((i * 7919) % 97) * 37 + (official ? 4200 : 0)),
    rating: +(4.1 + ((i * 31) % 9) / 10).toFixed(1),
    version: official ? `2.${i % 4}.0` : `1.${i % 6}.${i % 3}`,
    updated: ['Sep 30', 'Sep 26', 'Sep 18', 'Aug 29', 'Aug 12'][i % 5],
    steps: a[11] || BASE_STEPS,
    accuracy: lim ? 'Regional — good for trends, not single fields' : official ? 'Validated on 1,200 ground-truth plots · F1 0.86' : 'Community-reported · not independently validated',
    limits: [
      `Pixels are ${a[9]}; features smaller than ~${lim ? '1 km' : '3 pixels'} can be missed.`,
      a[2].includes('Sentinel-1') ? 'Radar can confuse wet soil with water after heavy rain.' : 'Optical satellites cannot see through cloud; cloudy passes are skipped.',
      'Causes are inferred from patterns, not observed directly — confirm on the ground.',
    ],
  };
});

export const skillById = (id: string) => SKILLS.find((s) => s.id === id);

/** The storage format for a skill: a versioned JSON manifest, validated against a JSON Schema. */
export const skillManifest = (s: Skill) => ({
  $schema: 'https://groundtruth.earth/schemas/skill/v1.json',
  id: `${s.official ? 'gt' : s.dev.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.${CATS[s.cat].key}.${s.id}`,
  version: s.version,
  name: s.name,
  category: CATS[s.cat].key,
  publisher: { name: s.dev, official: s.official, verified: s.verified },
  pricing: { tier: s.tier, price: s.tier === 'paid' ? s.cost : null },
  inputs: [
    { key: 'area', type: 'geometry', required: true, accepts: ['place', 'polygon', 'geojson', 'kml'] },
    ...(s.steps.includes('ask.clarify') ? [{ key: 'context', type: 'answers', required: false }] : []),
  ],
  steps: s.steps.map((id) => {
    const m = MODULES.find((x) => x.id === id)!;
    return { module: id, params: m.params || {} };
  }),
  outputs: [
    { key: 'layers', type: 'raster[]' },
    { key: 'summary', type: 'text', languages: 'auto' },
    { key: 'metrics', type: 'metric[]', with_confidence: true },
    { key: 'proof', type: 'proof_pack' },
  ],
  accuracy: { resolution: s.res, revisit: s.revisit, statement: s.accuracy, known_limits: s.limits },
});
