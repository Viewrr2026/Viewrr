import { useEffect, useRef } from "react";
import * as THREE from "three";

export default function HeroCanvas() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    // ── Scene setup ──────────────────────────────────────────────────────────
    const W = el.clientWidth;
    const H = el.clientHeight;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W, H);
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 100);
    camera.position.set(0, 0, 5);

    // ── Colour palette ────────────────────────────────────────────────────────
    const ORANGE = new THREE.Color("#FF5A1F");
    const ORANGE_DIM = new THREE.Color("#FF5A1F").multiplyScalar(0.35);
    const WHITE_DIM = new THREE.Color("#ffffff").multiplyScalar(0.15);

    // ── Node positions (spheres scattered in 3D space) ────────────────────────
    const NODE_COUNT = 55;
    const positions: THREE.Vector3[] = [];
    for (let i = 0; i < NODE_COUNT; i++) {
      positions.push(
        new THREE.Vector3(
          (Math.random() - 0.5) * 9,
          (Math.random() - 0.5) * 5.5,
          (Math.random() - 0.5) * 4
        )
      );
    }

    // ── Nodes ─────────────────────────────────────────────────────────────────
    const nodeGroup = new THREE.Group();
    const nodeMeshes: THREE.Mesh[] = [];

    positions.forEach((pos, i) => {
      const isAnchor = i === 0; // first node is the glowing anchor
      const geo = new THREE.SphereGeometry(isAnchor ? 0.13 : Math.random() * 0.045 + 0.02, 16, 16);
      const mat = new THREE.MeshBasicMaterial({
        color: isAnchor ? ORANGE : i % 7 === 0 ? ORANGE_DIM : WHITE_DIM,
        transparent: true,
        opacity: isAnchor ? 1 : Math.random() * 0.6 + 0.3,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(pos);
      // Override anchor position to centre-left
      if (isAnchor) mesh.position.set(-0.8, 0.1, 0.5);
      nodeGroup.add(mesh);
      nodeMeshes.push(mesh);
    });
    scene.add(nodeGroup);

    // ── Glowing ring around anchor ────────────────────────────────────────────
    const ringGeo = new THREE.RingGeometry(0.22, 0.27, 64);
    const ringMat = new THREE.MeshBasicMaterial({ color: ORANGE, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.copy(nodeMeshes[0].position);
    scene.add(ring);

    const ring2Geo = new THREE.RingGeometry(0.34, 0.37, 64);
    const ring2Mat = new THREE.MeshBasicMaterial({ color: ORANGE, transparent: true, opacity: 0.15, side: THREE.DoubleSide });
    const ring2 = new THREE.Mesh(ring2Geo, ring2Mat);
    ring2.position.copy(nodeMeshes[0].position);
    scene.add(ring2);

    // ── Edges (lines connecting close nodes) ──────────────────────────────────
    const CONNECT_DIST = 2.2;
    const lineGeo = new THREE.BufferGeometry();
    const lineVerts: number[] = [];

    positions.forEach((a, i) => {
      const actualA = i === 0 ? nodeMeshes[0].position : a;
      positions.forEach((b, j) => {
        if (j <= i) return;
        const actualB = j === 0 ? nodeMeshes[0].position : b;
        if (actualA.distanceTo(actualB) < CONNECT_DIST) {
          lineVerts.push(actualA.x, actualA.y, actualA.z);
          lineVerts.push(actualB.x, actualB.y, actualB.z);
        }
      });
    });

    lineGeo.setAttribute("position", new THREE.Float32BufferAttribute(lineVerts, 3));
    const lineMat = new THREE.LineBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.06 });
    const lineSegments = new THREE.LineSegments(lineGeo, lineMat);
    scene.add(lineSegments);

    // ── Mouse parallax ────────────────────────────────────────────────────────
    let targetX = 0, targetY = 0, currentX = 0, currentY = 0;

    const onMouseMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      targetX = ((e.clientX - rect.left) / rect.width  - 0.5) * 0.8;
      targetY = ((e.clientY - rect.top)  / rect.height - 0.5) * 0.5;
    };
    window.addEventListener("mousemove", onMouseMove);

    // ── Resize ────────────────────────────────────────────────────────────────
    const onResize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);

    // ── Animation loop ────────────────────────────────────────────────────────
    let frame: number;
    let t = 0;

    const tick = () => {
      frame = requestAnimationFrame(tick);
      t += 0.008;

      // Smooth mouse follow
      currentX += (targetX - currentX) * 0.04;
      currentY += (targetY - currentY) * 0.04;

      nodeGroup.rotation.y = currentX * 0.5;
      nodeGroup.rotation.x = -currentY * 0.3;
      lineSegments.rotation.y = currentX * 0.5;
      lineSegments.rotation.x = -currentY * 0.3;

      // Anchor node pulse
      const pulse = Math.sin(t * 2) * 0.04 + 1;
      nodeMeshes[0].scale.setScalar(pulse);
      ring.rotation.z = t * 0.4;
      ring2.rotation.z = -t * 0.25;
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.2 + Math.sin(t * 2) * 0.15;
      (ring2.material as THREE.MeshBasicMaterial).opacity = 0.08 + Math.sin(t * 1.5) * 0.07;

      // Sync rings to anchor
      ring.position.copy(nodeMeshes[0].position);
      ring2.position.copy(nodeMeshes[0].position);
      const rot = nodeGroup.rotation;
      ring.rotation.x = -rot.x;
      ring2.rotation.x = -rot.x;

      // Slow drift of all nodes
      nodeMeshes.forEach((m, i) => {
        if (i === 0) return;
        m.position.y += Math.sin(t + i * 0.7) * 0.0008;
        m.position.x += Math.cos(t * 0.6 + i * 0.5) * 0.0005;
      });

      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div
      ref={mountRef}
      className="absolute inset-0 w-full h-full"
      style={{ pointerEvents: "none" }}
    />
  );
}
