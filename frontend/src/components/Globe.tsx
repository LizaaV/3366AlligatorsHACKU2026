import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { attachGlobeControls } from './globe/controls';
import { angleDelta, latLonToVec3, spinForLon, vec3ToLatLon } from './globe/geo';
import { addSatellites } from './globeSatellites';
import type { SatFamily } from '../lib/satellites';

export interface GlobePick { lat: number; lon: number }

export interface GlobeProps {
  visible: boolean;
  autoRotate?: boolean;
  offsetRight?: boolean;
  /**
   * Horizontal shift of the globe's centre, in pixels from the middle of the host, e.g. half the
   * width of a side panel so the globe sits centred in the space beside it. Overrides the
   * default `offsetRight` shift.
   */
  offsetPx?: number;
  /** Called when the user clicks (not drags) the earth. */
  onPickLocation?: (p: GlobePick) => void;
  /** Smoothly rotate so this point faces the camera, drop a pin there, and hold it in view. */
  focus?: GlobePick | null;
  showSatellites?: boolean;
}

const fmt = (n: number, pos: string, neg: string) => `${Math.abs(n).toFixed(1)}°${n >= 0 ? pos : neg}`;

/** Draggable, zoomable 3D Earth with live satellites and click-to-pick. Sizes to its parent. */
export function Globe({ visible, autoRotate = true, offsetRight = true, offsetPx, onPickLocation, focus = null, showSatellites = true }: GlobeProps) {
  const el = useRef<HTMLDivElement>(null);
  const live = useRef({ visible, autoRotate, offsetRight, offsetPx, onPickLocation, showSatellites });
  live.current = { visible, autoRotate, offsetRight, offsetPx, onPickLocation, showSatellites };
  const api3d = useRef<{ setFocus: (f: GlobePick | null) => void; refreshLayout: () => void } | null>(null);
  const [hover, setHover] = useState<{ name: string; family: SatFamily; lat: number; lon: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const host = el.current!;
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.outputEncoding = THREE.sRGBEncoding;
    r.domElement.style.display = 'block';
    host.appendChild(r.domElement);
    const scene = new THREE.Scene();
    const BASE_Z = 3.5;
    const cam = new THREE.PerspectiveCamera(40, 1, 0.1, 1000);
    cam.position.z = BASE_Z;
    // grp: layout (offset/scale) + latitude tilt. spin: longitude. Everything geographic is a child of spin.
    const grp = new THREE.Group();
    scene.add(grp);
    grp.rotation.x = 0.38;
    grp.rotation.z = -0.12;
    const spin = new THREE.Group();
    spin.rotation.y = spinForLon(10);
    grp.add(spin);

    const L = new THREE.TextureLoader();
    const base = 'https://cdn.jsdelivr.net/npm/three-globe@2.31.0/example/img/';
    const map = L.load(base + 'earth-blue-marble.jpg');
    map.encoding = THREE.sRGBEncoding;
    map.anisotropy = 8;
    const bump = L.load(base + 'earth-topology.png');
    const water = L.load(base + 'earth-water.png');
    const earthGeo = new THREE.SphereGeometry(1, 96, 96);
    const mat = new THREE.MeshPhongMaterial({ map, bumpMap: bump, bumpScale: 0.035, specularMap: water, specular: new THREE.Color(0x0c1220), shininess: 6 });
    const earth = new THREE.Mesh(earthGeo, mat);
    spin.add(earth);

    // Thin, subtle atmosphere rim: brightest at the limb, fading outward.
    const atmGeo = new THREE.SphereGeometry(1, 64, 64);
    const atmMat = new THREE.ShaderMaterial({
      vertexShader: 'varying vec3 vN;void main(){vN=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'varying vec3 vN;void main(){float t=clamp(-vN.z/0.31,0.0,1.0);float i=pow(t,2.2)*0.45;gl_FragColor=vec4(0.42,0.66,1.0,1.0)*i;}',
      side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    });
    const atm = new THREE.Mesh(atmGeo, atmMat);
    atm.scale.setScalar(1.05);
    grp.add(atm);

    const g = new THREE.BufferGeometry();
    const N = 2200;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const u = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2, R = 60 + Math.random() * 40, s = Math.sqrt(1 - u * u);
      pos[i * 3] = R * s * Math.cos(t);
      pos[i * 3 + 1] = R * s * Math.sin(t);
      pos[i * 3 + 2] = R * u - 30;
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.22, sizeAttenuation: true, transparent: true, opacity: 0.8 });
    const stars = new THREE.Points(g, starMat);
    scene.add(stars);
    const sun = new THREE.DirectionalLight(0xffffff, 1.35);
    sun.position.set(-4, 1.8, 3.2);
    scene.add(sun);
    scene.add(new THREE.AmbientLight(0x8899bb, 0.18));

    // Satellites: the live constellation (lib/satellites.ts), propagated in the browser from
    // CelesTrak elements, added to the textured Earth so it turns with it.
    const sats = addSatellites(earth);
    sats.setVisible(live.current.showSatellites);

    // Pin for the picked / focused spot
    const pinGeo = new THREE.SphereGeometry(0.018, 16, 16);
    const pinMat = new THREE.MeshBasicMaterial({ color: 0xff5a4a });
    const ringGeo = new THREE.RingGeometry(0.028, 0.036, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xff5a4a, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false });
    const pin = new THREE.Group();
    const head = new THREE.Mesh(pinGeo, pinMat);
    head.position.z = 0.03;
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.z = 0.002;
    pin.add(head, ring);
    pin.visible = false;
    spin.add(pin);
    const placePin = (p: GlobePick) => {
      const v = latLonToVec3(p.lat, p.lon, 1.002);
      pin.position.copy(v);
      pin.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), v.clone().normalize()); // local +z → surface normal
      pin.visible = true;
    };

    // Focus animation target
    let target: { lon: number; lat: number } | null = null;
    // While a point is focused, auto-rotate stays off so it does not drift out of view.
    let held = false;
    const setFocus = (f: GlobePick | null) => {
      held = !!f;
      if (!f) { pin.visible = false; target = null; return; }
      placePin(f);
      target = { lon: spinForLon(f.lon), lat: THREE.MathUtils.clamp((f.lat * Math.PI) / 180, -1.2, 1.2) };
    };
    api3d.current = { setFocus, refreshLayout: () => resize() };

    // Layout
    const resize = () => {
      const w = host.clientWidth || 1, h = host.clientHeight || 1;
      r.setSize(w, h);
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
      const vh = 2 * BASE_Z * Math.tan(THREE.MathUtils.degToRad(20));
      const vw = vh * cam.aspect;
      const wide = cam.aspect > 1.2 && live.current.offsetRight;
      const px = live.current.offsetPx;
      grp.position.x = px != null ? vw * (px / w) : wide ? vw * 0.2 : 0;
      grp.position.y = cam.aspect > 1.2 ? 0 : -0.35;
      grp.scale.setScalar(cam.aspect > 1.2 ? 1 : 0.82);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    // Interaction
    let interacted = false;
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const toNdc = (cx: number, cy: number) => {
      const b = host.getBoundingClientRect();
      ndc.set(((cx - b.left) / b.width) * 2 - 1, -(((cy - b.top) / b.height) * 2 - 1));
      return b;
    };
    const earthHit = () => {
      ray.setFromCamera(ndc, cam);
      return ray.intersectObject(earth, false)[0] ?? null;
    };
    const ctrl = attachGlobeControls({
      host, spin, tilt: grp, cam,
      onInteract: () => { interacted = true; target = null; setHover(null); },
      onTap: (cx, cy) => {
        toNdc(cx, cy);
        const hit = earthHit();
        if (!hit) return;
        const ll = vec3ToLatLon(spin.worldToLocal(hit.point.clone()));
        placePin(ll);
        live.current.onPickLocation?.(ll);
      },
      onHover: (cx, cy) => {
        const b = toNdc(cx, cy);
        const eh = earthHit();
        const s = sats.pick(ndc, cam, eh ? eh.distance : Infinity);
        setHover(s ? { ...s, x: cx - b.left, y: cy - b.top } : null);
        host.style.cursor = s ? 'pointer' : 'grab';
      },
      onLeave: () => setHover(null),
    });

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (!live.current.visible) return;
      ctrl.update();
      if (target) {
        const dy = angleDelta(spin.rotation.y, target.lon);
        const dx = target.lat - grp.rotation.x;
        const dz = -grp.rotation.z;
        spin.rotation.y += dy * 0.08;
        grp.rotation.x += dx * 0.08;
        grp.rotation.z += dz * 0.08;
        if (Math.abs(dy) < 0.002 && Math.abs(dx) < 0.002) target = null;
      } else if (!ctrl.dragging && !interacted && !held && live.current.autoRotate) {
        spin.rotation.y += 0.0011;
      }
      stars.rotation.y += 0.00005;
      sats.setVisible(live.current.showSatellites);
      sats.update();
      r.render(scene, cam);
    };
    loop();

    return () => {
      api3d.current = null;
      cancelAnimationFrame(raf);
      ro.disconnect();
      ctrl.dispose();
      sats.dispose();
      [earthGeo, atmGeo, g, pinGeo, ringGeo].forEach((x) => x.dispose());
      [mat, atmMat, starMat, pinMat, ringMat].forEach((x) => x.dispose());
      [map, bump, water].forEach((x) => x.dispose());
      r.dispose();
      host.removeChild(r.domElement);
    };
  }, []);

  // Re-applied when the globe comes back into view, so returning from the map re-centres the place.
  useEffect(() => { if (visible) api3d.current?.setFocus(focus ?? null); }, [focus?.lat, focus?.lon, visible]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api3d.current?.refreshLayout(); }, [offsetRight, offsetPx]);

  return (
    <div ref={el} style={{ position: 'absolute', inset: 0, opacity: visible ? 1 : 0, transition: 'opacity .6s ease', cursor: 'grab', pointerEvents: visible ? 'auto' : 'none', touchAction: 'none' }}>
      {hover && (
        <div style={{
          position: 'absolute', left: hover.x + 14, top: hover.y + 14, pointerEvents: 'none', zIndex: 2,
          background: 'rgba(10,16,28,0.88)', color: '#eaf2ff', border: '1px solid rgba(127,227,255,0.35)',
          borderRadius: 6, padding: '6px 9px', fontSize: 12, lineHeight: 1.35, whiteSpace: 'nowrap',
        }}>
          <div style={{ fontWeight: 600 }}>{hover.name}</div>
          <div style={{ opacity: 0.75, textTransform: 'capitalize' }}>{hover.family} satellite</div>
          <div style={{ opacity: 0.75 }}>passing over {fmt(hover.lat, 'N', 'S')}, {fmt(hover.lon, 'E', 'W')}</div>
        </div>
      )}
    </div>
  );
}
