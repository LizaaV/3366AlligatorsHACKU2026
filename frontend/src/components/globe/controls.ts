import type * as THREE from 'three';

export const MIN_DIST = 1.7;
export const MAX_DIST = 7;
const TAP_SLOP = 4; // px

export interface GlobeControlsOpts {
  host: HTMLElement;
  spin: THREE.Object3D; // rotates about its own y (longitude)
  tilt: THREE.Object3D; // rotates about x (latitude)
  cam: THREE.PerspectiveCamera;
  /** A click that was not a drag. */
  onTap: (clientX: number, clientY: number) => void;
  /** Pointer moved with no button/finger down. */
  onHover: (clientX: number, clientY: number) => void;
  onLeave: () => void;
  /** Any user drag / zoom — used to stop auto-rotate and cancel focus animation. */
  onInteract: () => void;
}

/** Google-Earth-style input: drag (mouse/touch) with inertia, wheel / ctrl+wheel / pinch zoom. */
export function attachGlobeControls(o: GlobeControlsOpts) {
  const { host, spin, tilt, cam } = o;
  const pts = new Map<number, { x: number; y: number }>();
  let vy = 0, vx = 0; // inertia (rad/frame)
  let down: { x: number; y: number; moved: boolean } | null = null;
  let pinch = 0;
  let dragging = false;

  const speed = () => 0.005 * Math.max(0.25, (cam.position.z - 1) / 2.5);
  const clampTilt = (v: number) => Math.max(-1.3, Math.min(1.3, v));
  const zoomBy = (f: number) => {
    cam.position.z = Math.min(MAX_DIST, Math.max(MIN_DIST, cam.position.z * f));
  };
  const dist = () => {
    const [a, b] = [...pts.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const pd = (e: PointerEvent) => {
    host.setPointerCapture?.(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) down = { x: e.clientX, y: e.clientY, moved: false };
    else { if (down) down.moved = true; pinch = dist(); }
    vx = vy = 0;
  };
  const pm = (e: PointerEvent) => {
    const p = pts.get(e.pointerId);
    if (!p) { if (e.pointerType === 'mouse') o.onHover(e.clientX, e.clientY); return; }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (pts.size >= 2) {
      const d = dist();
      if (pinch > 0 && d > 0) { zoomBy(pinch / d); o.onInteract(); }
      pinch = d;
      return;
    }
    if (down && !down.moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) > TAP_SLOP) down.moved = true;
    if (!down?.moved) return;
    dragging = true;
    host.style.cursor = 'grabbing';
    o.onInteract();
    vy = dx * speed();
    vx = dy * speed() * 0.6;
    spin.rotation.y += vy;
    tilt.rotation.x = clampTilt(tilt.rotation.x + vx);
  };
  const pu = (e: PointerEvent) => {
    if (!pts.delete(e.pointerId)) return;
    if (e.type === 'pointerup' && down && !down.moved && pts.size === 0) o.onTap(e.clientX, e.clientY);
    if (pts.size === 0) { down = null; dragging = false; host.style.cursor = 'grab'; }
    else { down = null; pinch = 0; vx = vy = 0; }
  };
  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    // ctrl+wheel is the trackpad pinch gesture (smaller deltas); plain wheel zooms as well.
    zoomBy(Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    o.onInteract();
  };
  const leave = () => o.onLeave();

  host.addEventListener('pointerdown', pd);
  host.addEventListener('pointermove', pm);
  host.addEventListener('pointerup', pu);
  host.addEventListener('pointercancel', pu);
  host.addEventListener('pointerleave', leave);
  host.addEventListener('wheel', wheel, { passive: false });

  return {
    get dragging() { return dragging; },
    /** Apply inertia; call once per frame. */
    update() {
      if (pts.size === 0 && (Math.abs(vy) > 1e-5 || Math.abs(vx) > 1e-5)) {
        spin.rotation.y += vy;
        tilt.rotation.x = clampTilt(tilt.rotation.x + vx);
        vy *= 0.94; vx *= 0.94;
      }
    },
    dispose() {
      host.removeEventListener('pointerdown', pd);
      host.removeEventListener('pointermove', pm);
      host.removeEventListener('pointerup', pu);
      host.removeEventListener('pointercancel', pu);
      host.removeEventListener('pointerleave', leave);
      host.removeEventListener('wheel', wheel);
    },
  };
}
