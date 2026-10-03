import { circlePts, rectPts, type Pt } from './geo';

export const FIELD = { lat: 37.9785, lon: -100.9155 };

export type PlaceSource = 'drawn' | 'uploaded' | 'search' | 'coords' | 'whatsapp' | 'parcel' | 'pin';

export interface Place {
  id: string;
  name: string;
  cat: number; // category index — used for the colour dot
  lat: number;
  lon: number;
  zoom: number;
  pts: Pt[]; // outline in z16 pixel offsets from centre
  circle: boolean;
  project: string;
  tags: string[];
  source: PlaceSource;
  created: string;
  details: { l: string; v: string }[];
}

export const SOURCE_LABEL: Record<PlaceSource, string> = {
  drawn: 'Drawn on map',
  uploaded: 'Uploaded file',
  search: 'From search',
  coords: 'From coordinates',
  whatsapp: 'WhatsApp location',
  parcel: 'Parcel / cadastre ID',
  pin: 'Dropped pin + radius',
};

export const PLACES: Place[] = [
  {
    id: 'np', name: 'North Pivot', cat: 0, lat: FIELD.lat, lon: FIELD.lon, zoom: 16, pts: circlePts(210, 48), circle: true,
    project: 'My Farm', tags: ['Maize', 'Center pivot'], source: 'drawn', created: 'Mar 2026',
    details: [{ l: 'Crop', v: 'Maize · planted Apr 28' }, { l: 'Irrigation', v: 'Center pivot, 7 spans' }, { l: 'Soil', v: 'Silt loam (SSURGO)' }, { l: 'Elevation', v: '880–884 m' }],
  },
  {
    id: 'sb', name: 'South Block', cat: 0, lat: FIELD.lat - 0.0146, lon: FIELD.lon, zoom: 16, pts: rectPts(430, 410), circle: false,
    project: 'My Farm', tags: ['Wheat', 'Rain-fed'], source: 'uploaded', created: 'Mar 2026',
    details: [{ l: 'Crop', v: 'Winter wheat · stubble' }, { l: 'Irrigation', v: 'Rain-fed' }, { l: 'Soil', v: 'Silt loam (SSURGO)' }, { l: 'Elevation', v: '878–881 m' }],
  },
  {
    id: 'mead', name: 'Lake Mead intake', cat: 1, lat: 36.13, lon: -114.45, zoom: 12, pts: rectPts(520, 360), circle: false,
    project: 'Water Ops', tags: ['Reservoir'], source: 'search', created: 'Jun 2026',
    details: [{ l: 'Type', v: 'Reservoir' }, { l: 'Full pool', v: '640 km²' }, { l: 'Gauge', v: 'USBR Hoover Dam' }, { l: 'Elevation', v: '317 m (Oct 1)' }],
  },
  {
    id: 'ro', name: 'Rondônia plot 14', cat: 2, lat: -10.0, lon: -63.0, zoom: 14, pts: rectPts(380, 300), circle: false,
    project: 'Cocoa supply chain', tags: ['EUDR', 'Cocoa'], source: 'parcel', created: 'Jul 2026',
    details: [{ l: 'Parcel ID', v: 'CAR RO-1100205-8F3A' }, { l: 'Forest 2020', v: '61% cover' }, { l: 'Supplier', v: 'Coop. Ji-Paraná' }, { l: 'Risk', v: 'Standard' }],
  },
];

export const PLACE_RESULTS = [
  { n: 'Garden City, Kansas', d: 'United States', lat: 37.971, lon: -100.873, z: 13 },
  { n: 'Lake Mead', d: 'Nevada, United States', lat: 36.13, lon: -114.45, z: 12 },
  { n: 'Rondônia', d: 'Brazil', lat: -10.0, lon: -63.0, z: 12 },
  { n: 'Port of Rotterdam', d: 'Netherlands', lat: 51.95, lon: 4.05, z: 13 },
  { n: 'Great Barrier Reef', d: 'Queensland, Australia', lat: -18.3, lon: 147.7, z: 11 },
  { n: 'Anand, Gujarat', d: 'India', lat: 22.56, lon: 72.95, z: 13 },
  { n: 'Nakuru County', d: 'Kenya', lat: -0.3, lon: 36.07, z: 12 },
];
