/** Live positions of the free Earth-observation satellites the agent draws on. */

import { request } from '../http';

export interface SatellitePoint {
  lat: number;
  lon: number;
}

export interface SatelliteDto {
  id: string;
  name: string;
  norad_id: number;
  mission: string;
  lat: number;
  lon: number;
  alt_km: number;
  velocity_kms: number;
  /** ISO timestamp the position is valid for. */
  at: string;
  /** Ground track ahead of the satellite, in order of travel. */
  track: SatellitePoint[];
}

const EARTH_R = 6371;
const MU = 398600.4418;
const OMEGA_E = (2 * Math.PI) / 86164; // earth rotation, rad/s
const R2D = 180 / Math.PI;

interface Orbit { id: string; name: string; norad: number; mission: string; alt: number; incl: number; raan: number; phase: number }

// Plausible circular-orbit stand-ins (real altitudes/inclinations, made-up phase).
const ORBITS: Orbit[] = [
  { id: 'sentinel-1a', name: 'Sentinel-1A', norad: 39634, mission: 'Copernicus SAR radar', alt: 693, incl: 98.18, raan: 20, phase: 10 },
  { id: 'sentinel-2a', name: 'Sentinel-2A', norad: 40697, mission: 'Copernicus optical imaging', alt: 786, incl: 98.62, raan: 80, phase: 120 },
  { id: 'sentinel-2b', name: 'Sentinel-2B', norad: 42063, mission: 'Copernicus optical imaging', alt: 786, incl: 98.62, raan: 80, phase: 300 },
  { id: 'sentinel-2c', name: 'Sentinel-2C', norad: 60989, mission: 'Copernicus optical imaging', alt: 786, incl: 98.62, raan: 80, phase: 210 },
  { id: 'landsat-8', name: 'Landsat 8', norad: 39084, mission: 'USGS/NASA land imaging', alt: 705, incl: 98.2, raan: 140, phase: 60 },
  { id: 'landsat-9', name: 'Landsat 9', norad: 49260, mission: 'USGS/NASA land imaging', alt: 705, incl: 98.2, raan: 140, phase: 240 },
  { id: 'terra', name: 'Terra', norad: 25994, mission: 'NASA MODIS / ASTER', alt: 705, incl: 98.2, raan: 200, phase: 330 },
  { id: 'aqua', name: 'Aqua', norad: 27424, mission: 'NASA MODIS / AMSR-E', alt: 705, incl: 98.2, raan: 260, phase: 170 },
  { id: 'suomi-npp', name: 'Suomi NPP', norad: 37849, mission: 'NASA/NOAA VIIRS', alt: 824, incl: 98.7, raan: 320, phase: 90 },
];

function position(o: Orbit, tSec: number): SatellitePoint {
  const a = EARTH_R + o.alt;
  const n = Math.sqrt(MU / a ** 3); // rad/s
  const u = o.phase / R2D + n * tSec; // argument of latitude
  const i = o.incl / R2D;
  const lat = Math.asin(Math.sin(i) * Math.sin(u));
  const lonInertial = Math.atan2(Math.cos(i) * Math.sin(u), Math.cos(u)) + o.raan / R2D;
  let lon = (lonInertial - OMEGA_E * tSec) * R2D;
  lon = ((((lon + 180) % 360) + 360) % 360) - 180;
  return { lat: lat * R2D, lon };
}

function fixtureSatellites(): SatelliteDto[] {
  const now = Date.now();
  const t0 = now / 1000;
  return ORBITS.map((o) => {
    const p = position(o, t0);
    const track: SatellitePoint[] = [];
    for (let s = 60; s <= 3600; s += 60) track.push(position(o, t0 + s));
    const a = EARTH_R + o.alt;
    return {
      id: o.id, name: o.name, norad_id: o.norad, mission: o.mission,
      lat: p.lat, lon: p.lon, alt_km: o.alt, velocity_kms: Math.sqrt(MU / a),
      at: new Date(now).toISOString(), track,
    };
  });
}

export const satellitesApi = {
  /** TODO(api): GET /api/satellites */
  list: (signal?: AbortSignal): Promise<SatelliteDto[]> =>
    request<SatelliteDto[]>({ method: 'GET', path: '/satellites', signal, fixture: fixtureSatellites }),
};
