import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { addSatellites } from './globeSatellites';

/**
 * Spinning, draggable 3D Earth with the live satellite constellation.
 *
 * Tap the Earth (a click without dragging) and it turns that spot to face you and zooms in,
 * then calls `onPick(lat, lon)` so the page can hand over to the map. A click that misses
 * the Earth calls `onOutside`.
 */
export function Globe({
  visible,
  autoRotate = true,
  offsetRight = true,
  onPick,
  onOutside,
}: {
  visible: boolean;
  autoRotate?: boolean;
  offsetRight?: boolean;
  onPick?: (lat: number, lon: number) => void;
  onOutside?: () => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const live = useRef({ visible, autoRotate, offsetRight, onPick, onOutside });
  live.current = { visible, autoRotate, offsetRight, onPick, onOutside };
  /** Restarts the render loop; set by the mount effect, called when the globe becomes visible. */
  const resume = useRef<() => void>(() => undefined);

  useEffect(() => {
    const host = el.current!;
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.outputEncoding = THREE.sRGBEncoding;
    r.domElement.style.display = 'block';
    host.appendChild(r.domElement);
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(40, 1, 0.1, 1000);
    cam.position.z = 3.5;
    const grp = new THREE.Group();
    scene.add(grp);
    grp.rotation.x = 0.38;
    grp.rotation.z = -0.12;
    const L = new THREE.TextureLoader();
    const base = 'https://cdn.jsdelivr.net/npm/three-globe@2.31.0/example/img/';
    const map = L.load(base + 'earth-blue-marble.jpg');
    map.encoding = THREE.sRGBEncoding;
    map.anisotropy = 8;
    const bump = L.load(base + 'earth-topology.png');
    const spec = L.load(base + 'earth-water.png');
    const mat = new THREE.MeshPhongMaterial({ map, bumpMap: bump, bumpScale: 0.035, specularMap: spec, specular: new THREE.Color(0x0c1220), shininess: 6 });
    const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 96), mat);
    earth.rotation.y = -1.75;
    grp.add(earth);
    const atm = new THREE.Mesh(
      new THREE.SphereGeometry(1, 64, 64),
      new THREE.ShaderMaterial({
        vertexShader: 'varying vec3 vN;void main(){vN=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader: 'varying vec3 vN;void main(){float i=pow(0.68-dot(vN,vec3(0.0,0.0,1.0)),3.2);gl_FragColor=vec4(0.17,0.54,1.0,1.0)*i*0.55;}',
        side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true,
      }),
    );
    atm.scale.setScalar(1.08);
    grp.add(atm);
    const sats = addSatellites(earth);
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
    const stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.22, sizeAttenuation: true, transparent: true, opacity: 0.8 }));
    scene.add(stars);
    const sun = new THREE.DirectionalLight(0xffffff, 1.35);
    sun.position.set(-4, 1.8, 3.2);
    scene.add(sun);
    scene.add(new THREE.AmbientLight(0x8899bb, 0.18));

    const resize = () => {
      const w = host.clientWidth, h = host.clientHeight;
      r.setSize(w, h);
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
      const vh = 2 * cam.position.z * Math.tan(THREE.MathUtils.degToRad(20));
      const vw = vh * cam.aspect;
      const wide = cam.aspect > 1.2 && live.current.offsetRight;
      grp.position.x = wide ? vw * 0.2 : 0;
      grp.position.y = cam.aspect > 1.2 ? 0 : -0.35;
      const sc = cam.aspect > 1.2 ? 1 : 0.82;
      grp.scale.setScalar(sc);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    // Rest pose, restored whenever the globe is shown again after a fly-in.
    const rest = { camZ: cam.position.z, rx: grp.rotation.x, rz: grp.rotation.z };
    // A running fly-in: from the current pose to the picked spot facing the camera.
    let fly: null | { t0: number; from: number[]; to: number[]; lat: number; lon: number } = null;
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();

    /** lat/lon of a point on the Earth mesh, from its local (unrotated) coordinates. */
    const toLatLon = (world: THREE.Vector3) => {
      const p = earth.worldToLocal(world.clone()).normalize();
      // three's SphereGeometry: u = atan2(z, -x) / 2π from lon -180°, v from the north pole.
      const lat = THREE.MathUtils.radToDeg(Math.asin(p.y));
      let u = Math.atan2(p.z, -p.x) / (2 * Math.PI);
      if (u < 0) u += 1;
      return { lat, lon: u * 360 - 180, local: p };
    };

    const pick = (e: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ndc, cam);
      const hit = ray.intersectObject(earth, false)[0];
      if (!hit) return live.current.onOutside?.();
      const { lat, lon, local } = toLatLon(hit.point);
      // Turn the spot to the front: rotate the Earth about Y so its longitude faces +z, then
      // tilt the group by the latitude so it sits at the centre.
      let ry = -Math.atan2(local.x, local.z);
      while (ry - earth.rotation.y > Math.PI) ry -= 2 * Math.PI;
      while (earth.rotation.y - ry > Math.PI) ry += 2 * Math.PI;
      fly = {
        t0: performance.now(),
        from: [earth.rotation.y, grp.rotation.x, grp.rotation.z, grp.position.x, grp.position.y, cam.position.z],
        to: [ry, THREE.MathUtils.degToRad(lat), 0, 0, 0, 1.45],
        lat,
        lon,
      };
    };

    let drag: { x: number; y: number } | null = null;
    let moved = 0;
    const down = (e: PointerEvent) => { if (fly) return; drag = { x: e.clientX, y: e.clientY }; moved = 0; host.style.cursor = 'grabbing'; };
    const up = (e: PointerEvent) => {
      const wasClick = !!drag && moved < 6;
      drag = null;
      host.style.cursor = 'grab';
      if (wasClick && e.target === r.domElement) pick(e);
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      moved += Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y);
      earth.rotation.y += (e.clientX - drag.x) * 0.005;
      grp.rotation.x = Math.max(-1, Math.min(1, grp.rotation.x + (e.clientY - drag.y) * 0.003));
      drag = { x: e.clientX, y: e.clientY };
    };
    const wheel = (e: WheelEvent) => {
      if (fly) return;
      e.preventDefault();
      cam.position.z = Math.max(1.6, Math.min(5, cam.position.z * (1 + e.deltaY * 0.001)));
    };
    host.addEventListener('wheel', wheel, { passive: false });
    host.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointermove', move);

    // The loop stops itself while the globe is hidden (map mode, another tab) instead of spinning
    // an idle rAF; `resume` restarts it when it is shown again.
    let raf = 0;
    const loop = () => {
      if (!live.current.visible) {
        raf = 0;
        return;
      }
      raf = requestAnimationFrame(loop);
      if (fly) {
        const k = Math.min(1, (performance.now() - fly.t0) / 1300);
        const ease = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
        const v = fly.from.map((f, i) => f + (fly!.to[i] - f) * ease);
        [earth.rotation.y, grp.rotation.x, grp.rotation.z, grp.position.x, grp.position.y, cam.position.z] = v;
        if (k >= 1) {
          const { lat, lon } = fly;
          fly = null;
          live.current.onPick?.(lat, lon);
        }
      } else if (!drag && live.current.autoRotate) earth.rotation.y += 0.0011;
      stars.rotation.y += 0.00005;
      sats.update();
      r.render(scene, cam);
    };
    resume.current = () => {
      // Back from the map: zoom out to the rest pose, keeping the spot that was picked in view.
      if (cam.position.z < rest.camZ - 0.01) {
        cam.position.z = rest.camZ;
        grp.rotation.x = rest.rx;
        grp.rotation.z = rest.rz;
        resize();
      }
      if (!raf) raf = requestAnimationFrame(loop);
    };
    resume.current();

    return () => {
      cancelAnimationFrame(raf);
      raf = -1; // never restart after unmount
      resume.current = () => undefined;
      sats.dispose();
      earth.geometry.dispose();
      mat.dispose();
      map.dispose();
      bump.dispose();
      spec.dispose();
      atm.geometry.dispose();
      (atm.material as THREE.Material).dispose();
      g.dispose();
      (stars.material as THREE.Material).dispose();
      ro.disconnect();
      host.removeEventListener('pointerdown', down);
      host.removeEventListener('wheel', wheel);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointermove', move);
      r.dispose();
      host.removeChild(r.domElement);
    };
  }, []);

  useEffect(() => {
    if (visible) resume.current();
  }, [visible]);

  return <div ref={el} style={{ position: 'absolute', inset: 0, opacity: visible ? 1 : 0, transition: 'opacity .6s ease', cursor: 'grab', pointerEvents: visible ? 'auto' : 'none' }} />;
}
