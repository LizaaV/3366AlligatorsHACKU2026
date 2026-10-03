// Map helpers ported from the prototype (EOX Sentinel-2 cloudless tiles, web-mercator math).

export const TILE = (z: number, x: number, y: number) =>
  `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/${z}/${y}/${x}.jpg`;

export const txy = (lat: number, lon: number, z: number) => {
  const n = Math.pow(2, z);
  const r = (lat * Math.PI) / 180;
  return { x: ((lon + 180) / 360) * n, y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n };
};

export const thumb = (lat: number, lon: number, z: number) => {
  const t = txy(lat, lon, z);
  return TILE(z, Math.floor(t.x), Math.floor(t.y));
};

export const quad = (lat: number, lon: number, z: number) => {
  const t = txy(lat, lon, z);
  const x = Math.round(t.x);
  const y = Math.round(t.y);
  return [TILE(z, x - 1, y - 1), TILE(z, x, y - 1), TILE(z, x - 1, y), TILE(z, x, y)];
};

export type Pt = [number, number];

export const circlePts = (r: number, n: number): Pt[] =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [+(Math.sin(a) * r).toFixed(1), +(-Math.cos(a) * r).toFixed(1)];
  });

export const rectPts = (w: number, h: number): Pt[] => [
  [-w / 2, -h / 2],
  [w / 2, -h / 2],
  [w / 2, h / 2],
  [-w / 2, h / 2],
];

const mpp16 = (lat: number) => (156543.03 * Math.cos((lat * Math.PI) / 180)) / 65536;

/** Area in hectares of a polygon given in z16 pixel offsets. */
export const areaHa = (pts: Pt[], lat: number) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return +(((Math.abs(a) / 2) * Math.pow(mpp16(lat), 2)) / 10000).toFixed(1);
};

export const fmtC = (lat: number, lon: number) =>
  `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(4)}°${lon >= 0 ? 'E' : 'W'}`;

const arcPt = (r: number, deg: number) => {
  const a = (deg * Math.PI) / 180;
  return [(300 + Math.sin(a) * r).toFixed(1), (300 - Math.cos(a) * r).toFixed(1)];
};

export const DRY_PATH = (() => {
  const a0 = 14, a1 = 100;
  const o0 = arcPt(206, a0), o1 = arcPt(206, a1), i1 = arcPt(132, a1), i0 = arcPt(132, a0);
  return `M${o0} A206 206 0 0 1 ${o1} L${i1} A132 132 0 0 0 ${i0} Z`;
})();

export const pts2 = (arr: number[], w = 300, h = 100, pad = 90) =>
  arr.map((v, i) => `${((i / (arr.length - 1)) * w).toFixed(1)},${(h - v * pad).toFixed(1)}`).join(' ');
