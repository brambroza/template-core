'use client';

/**
 * 3D factory floor: machines grouped by location on an isometric floor, coloured by live status.
 * Three.js is imported lazily so pages without the widget never download it.
 */
import { useEffect, useRef, useState } from 'react';
import { get, type FloorWidget } from '@erp/ui-schema';
import { gsap, reducedMotion } from '@/lib/motion';
import { screenHref } from '@/lib/nav';

type Data = Record<string, unknown>;
interface Machine { id: string; code: string; name: string; status: string; group: string; badge: number }

const STATUS_COLOR: Record<string, string> = { running: '#1F9D6B', down: '#D64535', retired: '#8A949C' };

function cssVar(el: Element, name: string, fallback: string) {
  return getComputedStyle(el).getPropertyValue(name).trim() || fallback;
}

export function Floor3D({ w, data, module }: { w: FloorWidget; data: Data; module: string }) {
  const box = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const machines: Machine[] = ((get(data, w.rows) as Data[]) ?? []).map((r) => ({
    id: String(get(r, w.link?.idFrom ?? 'id') ?? ''), code: String(get(r, w.code) ?? ''), name: String(get(r, w.name) ?? ''),
    status: String(get(r, w.status) ?? ''), group: String((w.group && get(r, w.group)) || 'โรงงาน'), badge: Number((w.badge && get(r, w.badge)) || 0),
  }));
  const key = machines.map((m) => `${m.id}:${m.status}:${m.badge}`).join('|');

  useEffect(() => {
    const el = box.current;
    if (!el || !machines.length) return;
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      let THREE: typeof import('three');
      try { THREE = await import('three'); } catch { setFailed(true); return; }
      if (disposed) return;
      const width = el.clientWidth, height = el.clientHeight;
      let renderer: import('three').WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      } catch {
        setFailed(true);
        return;
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(width, height);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFShadowMap;
      el.prepend(renderer.domElement);
      renderer.domElement.setAttribute('aria-hidden', 'true');

      const scene = new THREE.Scene();
      const aspect = width / height;

      // layout: one plate per location, machines in rows of 3 on it
      const groups = [...new Set(machines.map((m) => m.group))];
      const PER_ROW = 3, GAP = 2.2, PLATE_GAP = 1.6;
      let cursor = 0;
      const placed: { m: Machine; x: number; z: number }[] = [];
      const plates: { x: number; w: number; d: number; name: string }[] = [];
      for (const g of groups) {
        const list = machines.filter((m) => m.group === g);
        const cols = Math.min(PER_ROW, list.length), rows = Math.ceil(list.length / PER_ROW);
        const pw = cols * GAP + 0.6, pd = rows * GAP + 0.6;
        plates.push({ x: cursor + pw / 2, w: pw, d: pd, name: g });
        list.forEach((m, i) => placed.push({ m, x: cursor + 0.3 + GAP / 2 + (i % PER_ROW) * GAP, z: -pd / 2 + 0.3 + GAP / 2 + Math.floor(i / PER_ROW) * GAP }));
        cursor += pw + PLATE_GAP;
      }
      const totalW = cursor - PLATE_GAP;
      const center = new THREE.Vector3(totalW / 2, 0, 0);
      const span = Math.max(totalW, Math.max(...plates.map((p) => p.d)) * 1.6, 6);

      // half-height of the view: fit the layout with a little margin (isometric view shrinks it by ~0.6)
      // narrow screens (phones) need a wider view so every plate stays in frame
      const view = Math.max(3, span * 0.33) * (aspect < 1.4 ? Math.min(1.9, 1.4 / aspect) : 1);
      const camera = new THREE.OrthographicCamera(-view * aspect, view * aspect, view, -view, 0.1, 200);
      const radius = 30;
      let angle = Math.PI / 4;
      const placeCamera = () => {
        camera.position.set(center.x + Math.cos(angle) * radius, radius * 0.82, center.z + Math.sin(angle) * radius);
        camera.lookAt(center);
      };
      placeCamera();

      scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.2));
      const sun = new THREE.DirectionalLight(0xffffff, 1.6);
      sun.position.set(center.x + 8, 18, center.z + 10);
      sun.castShadow = true;
      sun.shadow.mapSize.set(1024, 1024);
      Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span });
      sun.target.position.copy(center);
      scene.add(sun, sun.target);

      const floorColor = new THREE.Color(cssVar(el, '--surface-2', '#EFF1EF'));
      const plateColor = new THREE.Color(cssVar(el, '--surface', '#FFFFFF'));
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.ShadowMaterial({ opacity: 0.12 }));
      ground.rotation.x = -Math.PI / 2;
      ground.receiveShadow = true;
      scene.add(ground);
      for (const p of plates) {
        const plate = new THREE.Mesh(new THREE.BoxGeometry(p.w, 0.12, p.d), new THREE.MeshStandardMaterial({ color: plateColor, roughness: 0.9 }));
        plate.position.set(p.x, 0.06, 0);
        plate.receiveShadow = true;
        scene.add(plate);
        const edge = new THREE.LineSegments(new THREE.EdgesGeometry(plate.geometry), new THREE.LineBasicMaterial({ color: floorColor.clone().offsetHSL(0, 0, -0.12) }));
        edge.position.copy(plate.position);
        scene.add(edge);
      }

      const bodyColor = new THREE.Color(cssVar(el, '--ink', '#141C22'));
      const tweens: gsap.core.Tween[] = [];
      const meshes: { m: Machine; group: import('three').Group; top: import('three').Vector3 }[] = [];
      for (const { m, x, z } of placed) {
        const g = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1, 1.2), new THREE.MeshStandardMaterial({ color: m.status === 'down' ? new THREE.Color('#D64535') : bodyColor, roughness: 0.55, metalness: 0.2 }));
        body.position.y = 0.62;
        body.castShadow = true;
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.45, 0.7), new THREE.MeshStandardMaterial({ color: bodyColor.clone().offsetHSL(0, 0, 0.12), roughness: 0.6 }));
        head.position.set(-0.2, 1.35, 0);
        head.castShadow = true;
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 20), new THREE.MeshStandardMaterial({ color: STATUS_COLOR[m.status] ?? '#8A949C', emissive: STATUS_COLOR[m.status] ?? '#8A949C', emissiveIntensity: 1.2 }));
        lamp.position.set(0.38, 1.3, 0.2);
        g.add(body, head, lamp);
        g.position.set(x, 0, z);
        scene.add(g);
        meshes.push({ m, group: g, top: new THREE.Vector3(x, 1.75, z) });
        if (m.status === 'down' && !reducedMotion()) {
          tweens.push(gsap.to(lamp.scale, { x: 1.6, y: 1.6, z: 1.6, duration: 0.6, yoyo: true, repeat: -1, ease: 'sine.inOut' }));
        }
      }

      // entrance: machines rise one after another
      if (!reducedMotion()) {
        meshes.forEach(({ group }, i) => tweens.push(gsap.from(group.scale, { y: 0.01, duration: 0.7, delay: 0.15 + i * 0.06, ease: 'back.out(1.6)' })));
        tweens.push(gsap.from(camera, { zoom: 0.8, duration: 1.2, ease: 'power2.out', onUpdate: () => camera.updateProjectionMatrix() }));
      }

      const labels = labelsRef.current;
      const projectLabels = () => {
        if (!labels) return;
        const rect = renderer.domElement.getBoundingClientRect();
        // place labels front-to-back; skip one that would cover an already placed label (broken machines first)
        const order = meshes.map((x, i) => ({ i, down: x.m.status === 'down' || x.m.badge > 0, v: x.top.clone().project(camera) }))
          .sort((a, b) => Number(b.down) - Number(a.down) || b.v.y - a.v.y);
        const placedBoxes: { x: number; y: number; w: number }[] = [];
        for (const { i, v } of order) {
          const a = labels.children[i] as HTMLElement | undefined;
          if (!a) continue;
          const x = ((v.x + 1) / 2) * rect.width, y = ((1 - v.y) / 2) * rect.height, w = a.offsetWidth || 70;
          const hit = placedBoxes.some((p) => Math.abs(p.y - y) < 20 && Math.abs(p.x - x) < (p.w + w) / 2 + 4);
          a.style.left = `${x}px`;
          a.style.top = `${y}px`;
          a.style.visibility = hit ? 'hidden' : 'visible';
          if (!hit) placedBoxes.push({ x, y, w });
        }
      };

      // drag to orbit; slow idle rotation otherwise
      let dragging = false, lastX = 0, idle = !reducedMotion();
      const down = (e: PointerEvent) => { dragging = true; idle = false; lastX = e.clientX; renderer.domElement.setPointerCapture(e.pointerId); };
      const move = (e: PointerEvent) => { if (!dragging) return; angle += (e.clientX - lastX) * 0.008; lastX = e.clientX; placeCamera(); };
      const up = () => { dragging = false; };
      renderer.domElement.addEventListener('pointerdown', down);
      renderer.domElement.addEventListener('pointermove', move);
      renderer.domElement.addEventListener('pointerup', up);

      let raf = 0;
      const tick = () => {
        if (idle) { angle += 0.0012; placeCamera(); }
        renderer.render(scene, camera);
        projectLabels();
        raf = requestAnimationFrame(tick);
      };
      tick();

      const ro = new ResizeObserver(() => {
        const w2 = el.clientWidth, h2 = el.clientHeight;
        if (!w2 || !h2) return;
        renderer.setSize(w2, h2);
        const a2 = w2 / h2;
        Object.assign(camera, { left: -view * a2, right: view * a2, top: view, bottom: -view });
        camera.updateProjectionMatrix();
      });
      ro.observe(el);

      cleanup = () => {
        cancelAnimationFrame(raf);
        ro.disconnect();
        tweens.forEach((t) => t.kill());
        renderer.dispose();
        scene.traverse((o) => {
          const mesh = o as import('three').Mesh;
          mesh.geometry?.dispose?.();
          const mat = mesh.material as import('three').Material | import('three').Material[] | undefined;
          (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => x.dispose());
        });
        renderer.domElement.remove();
      };
    })();
    return () => { disposed = true; cleanup(); };
  }, [key]);

  if (!machines.length) {
    return <div className="floor"><div className="floor-empty">ยังไม่มีเครื่องจักร<br />เพิ่มเครื่องจักรแล้วผังโรงงานจะแสดงที่นี่</div></div>;
  }
  const down = machines.filter((m) => m.status === 'down').length;
  return (
    <div className="floor" ref={box} role="img" aria-label={`ผังโรงงาน: เครื่องจักร ${machines.length} เครื่อง เดินเครื่อง ${machines.length - down} เสีย ${down}`}>
      <div ref={labelsRef} aria-hidden={failed ? undefined : true}>
        {machines.map((m) => (
          <a key={m.id} className={`floor-label${m.status === 'down' ? ' down' : ''}`} href={w.link ? screenHref(module, w.link.screen, m.id) : undefined}
            style={failed ? { position: 'static', transform: 'none', display: 'inline-block', margin: 6 } : undefined}>
            {m.code}{m.badge ? ` · งานค้าง ${m.badge}` : ''}
          </a>
        ))}
      </div>
      <div className="floor-legend">
        <span><i style={{ background: STATUS_COLOR.running }} />เดินเครื่อง</span>
        <span><i style={{ background: STATUS_COLOR.down }} />เสีย</span>
        <span>ลากเพื่อหมุน</span>
      </div>
    </div>
  );
}
