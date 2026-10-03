import * as THREE from 'three';

const D2R = Math.PI / 180;

/**
 * lat/lon (degrees) → point on a sphere of radius `r`, in the earth mesh's LOCAL frame
 * (mesh rotation 0). With three's SphereGeometry and an equirectangular texture, lon 0 sits on
 * +x, east runs toward -z and north is +y. The globe spins by rotating the parent group, so
 * markers added to that same group stay glued to the texture.
 */
export function latLonToVec3(lat: number, lon: number, r = 1, out = new THREE.Vector3()): THREE.Vector3 {
  const la = lat * D2R, lo = lon * D2R;
  return out.set(r * Math.cos(la) * Math.cos(lo), r * Math.sin(la), -r * Math.cos(la) * Math.sin(lo));
}

/** Inverse of latLonToVec3 (the vector need not be unit length). Longitude is in [-180, 180]. */
export function vec3ToLatLon(v: THREE.Vector3): { lat: number; lon: number } {
  const len = v.length() || 1;
  return { lat: Math.asin(THREE.MathUtils.clamp(v.y / len, -1, 1)) / D2R, lon: Math.atan2(-v.z, v.x) / D2R };
}

/** Orbit radius on the globe: kept visibly close to the surface, not to scale. */
export const orbitRadius = (altKm: number) => 1 + (altKm / 6371) * 2.5;

/** Spin (rotation.y of the earth group) that brings longitude `lon` to face the camera at +z. */
export const spinForLon = (lon: number) => -Math.PI / 2 - lon * D2R;

/** Shortest signed angular difference b - a, wrapped to (-π, π]. */
export const angleDelta = (a: number, b: number) => {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
};
