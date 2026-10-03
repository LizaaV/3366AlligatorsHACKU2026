import { FIELD } from './places';
import { thumb } from './geo';

export type Channel = 'email' | 'whatsapp' | 'sms' | 'push' | 'slack';

export const CHANNELS: { id: Channel; name: string; icon: string; tier: 'free' | 'paid'; note: string }[] = [
  { id: 'email', name: 'Email', icon: 'mail', tier: 'free', note: 'Any address' },
  { id: 'push', name: 'Mobile app', icon: 'smartphone', tier: 'free', note: 'iOS & Android push' },
  { id: 'whatsapp', name: 'WhatsApp', icon: 'chat', tier: 'free', note: 'Messages + map image' },
  { id: 'sms', name: 'SMS', icon: 'sms', tier: 'paid', note: '$0.02 / message' },
  { id: 'slack', name: 'Slack', icon: 'tag', tier: 'paid', note: 'Pro plan' },
];

export interface WatchEvent { date: string; text: string; level: 'info' | 'warn' | 'alert'; }

export interface Watch {
  id: string;
  name: string;
  cat: number;
  placeId: string | null;
  skillId: string;
  question: string;
  condition: string;
  metric: string;
  value: number;
  unit: string;
  ci: [number, number];
  confidence: 'High' | 'Medium' | 'Low';
  baselineLabel: string;
  baseline: number;
  delta: string;
  status: 'ok' | 'warn' | 'alert';
  history: number[]; // 0..1 normalised, last 12 passes
  band: [number[], number[]]; // historical 5-year min/max band, normalised
  histMean: number[]; // 5-year mean
  labels: string[];
  channels: Channel[];
  cadence: string;
  tier: 'free' | 'paid';
  on: boolean;
  lastRun: string;
  nextRun: string;
  sat: string;
  img: string;
  ring: boolean;
  events: WatchEvent[];
}

const M = ['Jul', 'Aug', 'Sep', 'Oct'];

export const WATCHES: Watch[] = [
  {
    id: 'w-dry', name: 'Dry patches · North Pivot', cat: 0, placeId: 'np', skillId: 'dry-patch-finder',
    question: 'Where are the dry patches in my field?', condition: 'Dry area larger than 5 ha',
    metric: 'Dry area', value: 4.6, unit: 'ha', ci: [3.9, 5.3], confidence: 'Medium', baselineLabel: '5-yr avg, same week', baseline: 1.2, delta: '+2.5 ha in 3 passes',
    status: 'warn', history: [.1, .12, .1, .14, .13, .16, .2, .26, .34, .45, .6, .74], band: [[.04, .05, .04, .06, .05, .06, .07, .08, .08, .1, .1, .12], [.18, .2, .2, .22, .24, .25, .26, .28, .28, .3, .3, .32]], histMean: [.1, .11, .11, .13, .14, .15, .16, .17, .18, .19, .2, .21],
    labels: M, channels: ['email', 'whatsapp'], cadence: 'Every Sentinel-2 pass (~5 days)', tier: 'free', on: true, lastRun: 'Sep 28, 18:04', nextRun: 'Oct 3', sat: 'Sentinel-2 · Landsat 9',
    img: thumb(FIELD.lat, FIELD.lon, 16), ring: true,
    events: [
      { date: 'Sep 28', text: 'Dry zone grew to 4.6 ha (±0.7). Spans 5–6.', level: 'warn' },
      { date: 'Sep 23', text: 'Dry zone 3.9 ha. Cause updated: irrigation fault (was: unknown).', level: 'warn' },
      { date: 'Sep 18', text: 'Pass skipped — 64% cloud over field.', level: 'info' },
      { date: 'Sep 8', text: 'First dry zone detected on 2 consecutive dates.', level: 'alert' },
    ],
  },
  {
    id: 'w-ndvi', name: 'Crop health · South Block', cat: 0, placeId: 'sb', skillId: 'weekly-crop-health',
    question: 'Is South Block healthy?', condition: 'NDVI drops more than 0.1 between passes',
    metric: 'NDVI', value: 0.71, unit: '', ci: [0.68, 0.74], confidence: 'High', baselineLabel: '5-yr avg, same week', baseline: 0.66, delta: 'Stable',
    status: 'ok', history: [.42, .5, .58, .66, .72, .76, .78, .78, .77, .76, .76, .75], band: [[.3, .38, .46, .54, .6, .64, .66, .66, .64, .62, .6, .58], [.5, .58, .66, .74, .8, .82, .84, .84, .82, .8, .78, .76]], histMean: [.4, .48, .56, .64, .7, .73, .75, .75, .73, .71, .69, .67],
    labels: M, channels: ['push'], cadence: 'Weekly', tier: 'free', on: true, lastRun: 'Sep 28, 18:04', nextRun: 'Oct 3', sat: 'Sentinel-2',
    img: thumb(FIELD.lat - 0.0146, FIELD.lon, 16), ring: false,
    events: [{ date: 'Sep 28', text: 'NDVI 0.71 — within normal range.', level: 'info' }, { date: 'Sep 3', text: 'Pass skipped — cloudy.', level: 'info' }],
  },
  {
    id: 'w-heat', name: 'Heat stress · both fields', cat: 0, placeId: null, skillId: 'dry-patch-finder',
    question: 'Are my fields under heat stress?', condition: 'Surface temperature above 34 °C on 2 passes',
    metric: 'Surface temp.', value: 31.4, unit: '°C', ci: [30.2, 32.6], confidence: 'Medium', baselineLabel: '5-yr avg, same week', baseline: 29.8, delta: '+1.6 °C vs normal',
    status: 'ok', history: [.52, .58, .65, .72, .8, .84, .82, .8, .78, .76, .74, .72], band: [[.4, .46, .52, .58, .62, .64, .62, .6, .56, .52, .48, .44], [.62, .68, .74, .8, .84, .86, .86, .84, .8, .76, .72, .68]], histMean: [.5, .56, .62, .68, .72, .74, .73, .71, .68, .64, .6, .56],
    labels: M, channels: ['email'], cadence: 'Every Landsat pass (8 days)', tier: 'free', on: true, lastRun: 'Sep 26', nextRun: 'Oct 4', sat: 'Landsat 9 TIRS',
    img: thumb(FIELD.lat - 0.007, FIELD.lon, 15), ring: false,
    events: [{ date: 'Sep 26', text: 'North Pivot 2.8 °C hotter than field average in dry zone.', level: 'warn' }],
  },
  {
    id: 'w-mead', name: 'Reservoir level · Lake Mead', cat: 1, placeId: 'mead', skillId: 'reservoir-level-tracker',
    question: 'How much water is in Lake Mead?', condition: 'Surface area drops 5% in 30 days',
    metric: 'Surface area', value: -3.2, unit: '% vs Aug', ci: [-4.1, -2.3], confidence: 'High', baselineLabel: '5-yr avg change', baseline: -2.6, delta: 'In line with seasonal drawdown',
    status: 'ok', history: [.62, .6, .58, .57, .55, .54, .53, .52, .51, .5, .49, .48], band: [[.5, .49, .48, .46, .45, .44, .43, .42, .41, .4, .4, .39], [.7, .69, .68, .66, .65, .64, .63, .62, .61, .6, .6, .59]], histMean: [.6, .59, .58, .56, .55, .54, .53, .52, .51, .5, .5, .49],
    labels: M, channels: ['email'], cadence: 'Every pass (5–21 days)', tier: 'free', on: false, lastRun: 'Sep 30', nextRun: 'Paused', sat: 'Sentinel-2 · SWOT',
    img: thumb(36.13, -114.45, 12), ring: false,
    events: [{ date: 'Sep 30', text: 'Area −3.2% vs August.', level: 'info' }],
  },
  {
    id: 'w-algae', name: 'Algae watch · Lake Erie', cat: 1, placeId: null, skillId: 'algae-red-tide-alert',
    question: 'Is there an algae bloom near the Toledo intake?', condition: 'Bloom within 5 km of intake',
    metric: 'Chlorophyll-a', value: 28, unit: 'µg/L', ci: [21, 35], confidence: 'Low', baselineLabel: '5-yr avg, same week', baseline: 19, delta: 'Above normal, falling',
    status: 'warn', history: [.2, .22, .25, .3, .42, .55, .62, .58, .5, .4, .33, .28], band: [[.1, .12, .12, .14, .16, .2, .22, .2, .18, .15, .13, .12], [.3, .32, .34, .38, .44, .5, .52, .5, .46, .4, .34, .3]], histMean: [.18, .2, .2, .22, .25, .3, .34, .33, .3, .27, .24, .22],
    labels: M, channels: ['whatsapp', 'sms'], cadence: 'Daily', tier: 'paid', on: true, lastRun: 'Today, 11:20', nextRun: 'Tomorrow', sat: 'Sentinel-3 OLCI',
    img: thumb(41.7, -83.2, 11), ring: false,
    events: [{ date: 'Oct 2', text: 'Bloom 7.4 km from intake (±1.5 km).', level: 'warn' }, { date: 'Aug 17', text: 'Peak bloom — 22 km² near Maumee Bay.', level: 'alert' }],
  },
  {
    id: 'w-defor', name: 'Clearing alerts · Rondônia plot 14', cat: 2, placeId: 'ro', skillId: 'deforestation-alerts',
    question: 'Has any forest been cleared on plot 14?', condition: 'Any new clearing above 0.5 ha',
    metric: 'New clearing', value: 0, unit: 'ha', ci: [0, 0.3], confidence: 'High', baselineLabel: 'Since Dec 31, 2020', baseline: 0, delta: 'No change since 2020',
    status: 'ok', history: [.05, .05, .05, .05, .05, .05, .05, .05, .05, .05, .05, .05], band: [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [.1, .1, .1, .1, .1, .1, .1, .1, .1, .1, .1, .1]], histMean: [.05, .05, .05, .05, .05, .05, .05, .05, .05, .05, .05, .05],
    labels: M, channels: ['email'], cadence: 'Every 6 days', tier: 'free', on: true, lastRun: 'Sep 29', nextRun: 'Oct 5', sat: 'Sentinel-1 · Sentinel-2',
    img: thumb(-10.0, -63.0, 14), ring: false,
    events: [{ date: 'Sep 29', text: 'No clearing. Radar and optical agree.', level: 'info' }],
  },
  {
    id: 'w-fire', name: 'Fire nearby · my fields', cat: 3, placeId: null, skillId: 'active-fire-map',
    question: 'Any fires within 10 km of my farm?', condition: 'VIIRS hotspot within 10 km of any of my places',
    metric: 'Hotspots < 10 km', value: 0, unit: '', ci: [0, 0], confidence: 'High', baselineLabel: 'Last 30 days', baseline: 1, delta: 'None this week',
    status: 'ok', history: [0, .1, 0, 0, .3, 0, 0, .1, 0, 0, 0, 0], band: [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [.2, .2, .3, .3, .4, .4, .3, .3, .2, .2, .2, .2]], histMean: [.05, .06, .08, .1, .14, .14, .12, .1, .08, .06, .05, .05],
    labels: M, channels: ['push', 'whatsapp'], cadence: 'Every ~12 hours', tier: 'free', on: true, lastRun: 'Today, 06:10', nextRun: 'Today, 18:00', sat: 'VIIRS / FIRMS',
    img: thumb(FIELD.lat, FIELD.lon, 12), ring: false,
    events: [{ date: 'Aug 21', text: 'Hotspot 8.2 km SW — grass fire, out after 6 h.', level: 'alert' }],
  },
];
