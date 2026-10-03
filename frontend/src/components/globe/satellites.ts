import * as THREE from 'three';
import type { SatelliteDto } from '../../api';
import { latLonToVec3, orbitRadius, vec3ToLatLon } from './geo';

const EARTH_R_KM = 6371;
const GLOW = '#7fe3ff';

interface Sat {
  dto: SatelliteDto;
  /** Unit vectors: [position at fetch time, ...track]. */
  path: THREE.Vector3[];
  /** Cumulative arc length (rad on the unit sphere) at each path point. */
  cum: number[];
  /** Angular speed in rad/s. */
  omega: number;
  fetchedAt: number;
  r: number;
  dot: THREE.Sprite;
  hit: THREE.Mesh;
  line: THREE.Line;
  linePos: Float32Array;
  cur: THREE.Vector3; // current unit vector
}

let glowTex: THREE.Texture | null = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(127,227,255,0.85)');
  grd.addColorStop(1, 'rgba(127,227,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

export interface SatHover { name: string; mission: string; lat: number; lon: number }

/** Satellite dots + ground tracks, parented to the earth group so they share its spin. */
export class SatelliteLayer {
  readonly group = new THREE.Group();
  private sats: Sat[] = [];
  private ray = new THREE.Raycaster();
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();

  setVisible(v: boolean) { this.group.visible = v; }

  /** Replace data from a fresh API response. */
  setData(list: SatelliteDto[], now = Date.now()) {
    const old = new Map(this.sats.map((s) => [s.dto.id, s]));
    const next: Sat[] = [];
    for (const dto of list) {
      const prev = old.get(dto.id);
      const s = prev ?? this.create(dto);
      old.delete(dto.id);
      s.dto = dto;
      s.fetchedAt = Date.parse(dto.at) || now;
      s.r = orbitRadius(dto.alt_km);
      s.omega = dto.velocity_kms / (EARTH_R_KM + dto.alt_km);
      s.path = [latLonToVec3(dto.lat, dto.lon, 1), ...dto.track.map((p) => latLonToVec3(p.lat, p.lon, 1))];
      s.cum = [0];
      for (let i = 1; i < s.path.length; i++) s.cum.push(s.cum[i - 1] + s.path[i - 1].angleTo(s.path[i]));
      this.resizeLine(s, s.path.length);
      next.push(s);
    }
    for (const s of old.values()) this.destroy(s);
    this.sats = next;
    this.update(now);
  }

  private create(dto: SatelliteDto): Sat {
    const mat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
    const dot = new THREE.Sprite(mat);
    dot.scale.setScalar(0.07);
    const hit = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), new THREE.MeshBasicMaterial({ visible: false }));
    const geo = new THREE.BufferGeometry();
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: new THREE.Color(GLOW), transparent: true, opacity: 0.35, depthWrite: false }));
    line.frustumCulled = false;
    this.group.add(dot, hit, line);
    return { dto, path: [], cum: [0], omega: 0, fetchedAt: 0, r: 1, dot, hit, line, linePos: new Float32Array(0), cur: new THREE.Vector3() };
  }

  private resizeLine(s: Sat, n: number) {
    // +1 for the live head point.
    const need = (n + 1) * 3;
    if (s.linePos.length !== need) {
      s.linePos = new Float32Array(need);
      s.line.geometry.setAttribute('position', new THREE.BufferAttribute(s.linePos, 3));
    }
  }

  private destroy(s: Sat) {
    this.group.remove(s.dot, s.hit, s.line);
    s.dot.material.dispose();
    (s.hit.material as THREE.Material).dispose();
    s.hit.geometry.dispose();
    s.line.geometry.dispose();
    (s.line.material as THREE.Material).dispose();
  }

  /** Advance every satellite along its track to wall-clock `now` (ms). */
  update(now = Date.now()) {
    for (const s of this.sats) {
      if (!s.path.length) continue;
      const dist = Math.max(0, ((now - s.fetchedAt) / 1000) * s.omega);
      const last = s.cum.length - 1;
      let i = 0;
      while (i < last && s.cum[i + 1] < dist) i++;
      if (i >= last) {
        s.cur.copy(s.path[last]);
        i = last;
      } else {
        const seg = s.cum[i + 1] - s.cum[i] || 1;
        const t = Math.min(1, (dist - s.cum[i]) / seg);
        s.cur.copy(s.path[i]).lerp(s.path[i + 1], t).normalize();
      }
      const p = this.tmpA.copy(s.cur).multiplyScalar(s.r);
      s.dot.position.copy(p);
      s.hit.position.copy(p);
      // Line: live head, then the rest of the track ahead.
      let k = 0;
      s.linePos[k++] = p.x; s.linePos[k++] = p.y; s.linePos[k++] = p.z;
      for (let j = i + 1; j < s.path.length; j++) {
        const v = s.path[j];
        s.linePos[k++] = v.x * s.r; s.linePos[k++] = v.y * s.r; s.linePos[k++] = v.z * s.r;
      }
      // Pad the unused tail with the last point (zero-length segments).
      const lx = s.linePos[k - 3], ly = s.linePos[k - 2], lz = s.linePos[k - 1];
      while (k < s.linePos.length) { s.linePos[k++] = lx; s.linePos[k++] = ly; s.linePos[k++] = lz; }
      (s.line.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  /** Pick the satellite under the pointer. `earthDist` (world) occludes ones behind the globe. */
  pick(ndc: THREE.Vector2, cam: THREE.Camera, earthDist = Infinity): SatHover | null {
    if (!this.group.visible || !this.sats.length) return null;
    this.ray.setFromCamera(ndc, cam);
    // Larger hit target when zoomed out is handled by sphere radius; good enough for dots.
    const hits = this.ray.intersectObjects(this.sats.map((s) => s.hit), false);
    const h = hits[0];
    if (!h || h.distance > earthDist) return null;
    const s = this.sats.find((x) => x.hit === h.object);
    if (!s) return null;
    const ll = vec3ToLatLon(this.tmpB.copy(s.cur));
    return { name: s.dto.name, mission: s.dto.mission, lat: ll.lat, lon: ll.lon };
  }

  dispose() {
    for (const s of this.sats) this.destroy(s);
    this.sats = [];
    glowTex?.dispose();
    glowTex = null;
  }
}
