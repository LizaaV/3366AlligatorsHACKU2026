import * as THREE from 'three';
import type { SatRec } from 'satellite.js';
import { FAMILY_COLOR, SATELLITES, loadTles, periodMin, subPoint, toSatrec, type SatFamily, type Satellite } from '../lib/satellites';

/**
 * Altitudes are drawn 1.6× true so low-Earth orbits (~700 km, 11% of the radius) clear the
 * atmosphere rim and read as orbits rather than as dots on the surface.
 */
const ALT_SCALE = 1.6;
const EARTH_KM = 6371;
/** Minutes of track drawn behind each satellite. */
const TRAIL_MIN = 14;
const TRAIL_PTS = 28;
const ORBIT_PTS = 160;

/**
 * Earth-fixed lat/lon/alt to a point on THREE.SphereGeometry's own UV layout, so a satellite
 * added as a child of the textured Earth sits over the right spot on the map and turns with it.
 */
export function toLocal(lat: number, lon: number, altKm: number, out = new THREE.Vector3()) {
  const r = 1 + (altKm / EARTH_KM) * ALT_SCALE;
  const phi = THREE.MathUtils.degToRad(lon + 180);
  const theta = THREE.MathUtils.degToRad(90 - lat);
  return out.set(-r * Math.cos(phi) * Math.sin(theta), r * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta));
}

const glowTexture = () => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.18, 'rgba(255,255,255,0.95)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.28)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.encoding = THREE.sRGBEncoding;
  return t;
};

interface Tracked {
  sat: Satellite;
  satrec: SatRec;
  dot: THREE.Sprite;
  trail: THREE.Line;
  /** One satellite per family also shows its whole orbit, dashed, as in the mock-up. */
  orbit?: THREE.Line;
}

/**
 * Adds the live constellation to `parent` (the Earth mesh). Elements load asynchronously; until
 * they do, nothing is drawn. Call `update` as often as you like — it throttles itself.
 */
export function addSatellites(parent: THREE.Object3D) {
  const group = new THREE.Group();
  parent.add(group);
  const tex = glowTexture();
  const tracked: Tracked[] = [];
  const ctl = new AbortController();
  let lastTrail = 0;
  let lastOrbit = 0;
  const tmp = new THREE.Vector3();

  /**
   * Writes the track into the line's preallocated position buffer in place, so the GPU buffer is
   * reused rather than a new one being allocated (and the old one leaked) on every refresh.
   */
  const trackLine = (line: THREE.Line, satrec: SatRec, fromMin: number, toMin: number, n: number, now: number) => {
    const attr = line.geometry.getAttribute('position') as THREE.BufferAttribute;
    let k = 0;
    for (let i = 0; i <= n; i++) {
      const p = subPoint(satrec, new Date(now + (fromMin + ((toMin - fromMin) * i) / n) * 60_000));
      if (!p) continue;
      toLocal(p.lat, p.lon, p.altKm, tmp);
      attr.setXYZ(k++, tmp.x, tmp.y, tmp.z);
    }
    attr.needsUpdate = true;
    line.geometry.setDrawRange(0, k);
    line.geometry.computeBoundingSphere();
    // Dashed lines need cumulative distances; Line.computeLineDistances() would allocate a new
    // attribute each time, so fill the preallocated one instead.
    const dist = line.geometry.getAttribute('lineDistance') as THREE.BufferAttribute | undefined;
    if (dist) {
      let d = 0;
      for (let i = 0; i < k; i++) {
        if (i > 0) d += Math.hypot(attr.getX(i) - attr.getX(i - 1), attr.getY(i) - attr.getY(i - 1), attr.getZ(i) - attr.getZ(i - 1));
        dist.setX(i, d);
      }
      dist.needsUpdate = true;
    }
  };

  const positions = (n: number) => {
    const a = new THREE.BufferAttribute(new Float32Array((n + 1) * 3), 3);
    a.setUsage(THREE.DynamicDrawUsage);
    return a;
  };

  void loadTles(ctl.signal)
    .then((tles) => {
      if (ctl.signal.aborted) return;
      const shownOrbit = new Set<SatFamily>();
      for (const sat of SATELLITES) {
        const tle = tles[sat.norad];
        if (!tle) continue;
        const color = new THREE.Color(FAMILY_COLOR[sat.family]);
        const dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
        dot.scale.setScalar(0.075);
        dot.userData.name = sat.name;

        // Trail fades from the satellite's colour to nothing; with additive blending, black is invisible.
        const tg = new THREE.BufferGeometry();
        const fade = new Float32Array((TRAIL_PTS + 1) * 3);
        for (let i = 0; i <= TRAIL_PTS; i++) color.clone().multiplyScalar((i / TRAIL_PTS) ** 1.6 * 0.9).toArray(fade, i * 3);
        tg.setAttribute('color', new THREE.BufferAttribute(fade, 3));
        tg.setAttribute('position', positions(TRAIL_PTS));
        tg.setDrawRange(0, 0);
        const trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));

        const t: Tracked = { sat, satrec: toSatrec(tle), dot, trail };
        if (!shownOrbit.has(sat.family)) {
          shownOrbit.add(sat.family);
          const og = new THREE.BufferGeometry();
          og.setAttribute('position', positions(ORBIT_PTS));
          og.setAttribute('lineDistance', new THREE.BufferAttribute(new Float32Array(ORBIT_PTS + 1), 1).setUsage(THREE.DynamicDrawUsage));
          og.setDrawRange(0, 0);
          t.orbit = new THREE.Line(
            og,
            new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.012, gapSize: 0.018, transparent: true, opacity: 0.22, depthWrite: false }),
          );
          group.add(t.orbit);
        }
        group.add(trail, dot);
        tracked.push(t);
      }
      lastTrail = lastOrbit = 0;
    })
    .catch(() => {
      /* aborted on unmount, or no elements at all: the globe simply shows no satellites */
    });

  const update = (now = Date.now()) => {
    if (!tracked.length) return;
    for (const t of tracked) {
      const p = subPoint(t.satrec, new Date(now));
      t.dot.visible = !!p;
      if (p) toLocal(p.lat, p.lon, p.altKm, t.dot.position);
    }
    if (now - lastTrail > 2_000) {
      lastTrail = now;
      for (const t of tracked) trackLine(t.trail, t.satrec, -TRAIL_MIN, 0, TRAIL_PTS, now);
    }
    if (now - lastOrbit > 60_000) {
      lastOrbit = now;
      for (const t of tracked) {
        if (!t.orbit) continue;
        const half = periodMin(t.satrec) / 2;
        trackLine(t.orbit, t.satrec, -half, half, ORBIT_PTS, now);
      }
    }
  };

  const dispose = () => {
    ctl.abort();
    for (const t of tracked) {
      t.dot.material.dispose();
      t.trail.geometry.dispose();
      (t.trail.material as THREE.Material).dispose();
      t.orbit?.geometry.dispose();
      (t.orbit?.material as THREE.Material | undefined)?.dispose();
    }
    tex.dispose();
    parent.remove(group);
  };

  return { update, dispose };
}
