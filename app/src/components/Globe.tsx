import { useEffect, useRef } from 'react';
import * as THREE from 'three';

/** Spinning, draggable 3D Earth — ported from the prototype's initGlobe(). */
export function Globe({ visible, autoRotate = true, offsetRight = true }: { visible: boolean; autoRotate?: boolean; offsetRight?: boolean }) {
  const el = useRef<HTMLDivElement>(null);
  const live = useRef({ visible, autoRotate, offsetRight });
  live.current = { visible, autoRotate, offsetRight };

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
    const mat = new THREE.MeshPhongMaterial({ map, bumpMap: L.load(base + 'earth-topology.png'), bumpScale: 0.035, specularMap: L.load(base + 'earth-water.png'), specular: new THREE.Color(0x0c1220), shininess: 6 });
    const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 96), mat);
    earth.rotation.y = -1.75;
    grp.add(earth);
    const atm = new THREE.Mesh(
      new THREE.SphereGeometry(1, 64, 64),
      new THREE.ShaderMaterial({
        vertexShader: 'varying vec3 vN;void main(){vN=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader: 'varying vec3 vN;void main(){float i=pow(0.68-dot(vN,vec3(0.0,0.0,1.0)),2.6);gl_FragColor=vec4(0.17,0.54,1.0,1.0)*i;}',
        side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true,
      }),
    );
    atm.scale.setScalar(1.14);
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

    let drag: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => { drag = { x: e.clientX, y: e.clientY }; host.style.cursor = 'grabbing'; };
    const up = () => { drag = null; host.style.cursor = 'grab'; };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      earth.rotation.y += (e.clientX - drag.x) * 0.005;
      grp.rotation.x = Math.max(-1, Math.min(1, grp.rotation.x + (e.clientY - drag.y) * 0.003));
      drag = { x: e.clientX, y: e.clientY };
    };
    host.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointermove', move);

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (!live.current.visible) return;
      if (!drag && live.current.autoRotate) earth.rotation.y += 0.0011;
      stars.rotation.y += 0.00005;
      r.render(scene, cam);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      host.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointermove', move);
      r.dispose();
      host.removeChild(r.domElement);
    };
  }, []);

  return <div ref={el} style={{ position: 'absolute', inset: 0, opacity: visible ? 1 : 0, transition: 'opacity .6s ease', cursor: 'grab', pointerEvents: visible ? 'auto' : 'none' }} />;
}
