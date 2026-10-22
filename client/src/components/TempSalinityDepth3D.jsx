import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Box, RotateCcw } from 'lucide-react';

// World-space size of the plot cube. Fixed regardless of the data's real
// units — each axis is normalized 0..1 before being mapped in here, so
// wildly different temperature/salinity/depth ranges always fill the view.
const PLOT_WIDTH = 3.4;   // Temperature axis (X)
const PLOT_DEPTH = 3.4;   // Salinity axis (Z)
const PLOT_HEIGHT = 3.6;  // Depth axis (Y, points downward)

const AXIS_COLORS = {
  temperature: 0xe08a3e, // warm amber — matches the "warm" end of temp data
  depth: 0x6fd4c9,       // cyan — matches the app's ice/cyan accent
  salinity: 0x8fb08a,    // muted teal-green
};

const SHALLOW_COLOR = [0.55, 0.92, 0.88];
const DEEP_COLOR = [0.06, 0.12, 0.34];

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function depthColor(t) {
  return [
    lerp(SHALLOW_COLOR[0], DEEP_COLOR[0], t),
    lerp(SHALLOW_COLOR[1], DEEP_COLOR[1], t),
    lerp(SHALLOW_COLOR[2], DEEP_COLOR[2], t),
  ];
}

// Renders a small text label as a THREE.Sprite (canvas texture) — avoids
// pulling in a text-rendering library just for three short axis captions.
function makeTextSprite(text, hexColor) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const scale = 2;
  canvas.width = 256 * scale;
  canvas.height = 64 * scale;
  ctx.scale(scale, scale);
  ctx.font = '600 26px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = `#${hexColor.toString(16).padStart(6, '0')}`;
  ctx.fillText(text, 4, 32);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.15, 0.29, 1);
  return sprite;
}

/**
 * Filters a utils/oceanSection.js `section` down to the points that have
 * BOTH temperature and salinity, and sorts them shallow → deep. Returns
 * null when there isn't enough overlapping data for a meaningful 3D path
 * (fewer than 2 usable points, or every point shares the same value on an
 * axis so it can't be normalized into a range).
 */
function buildTempSalinityDepthPoints(section) {
  if (!section || !Array.isArray(section.points)) return null;
  const pts = section.points
    .filter((p) => p.depth !== null && p.temperature !== null && p.salinity !== null)
    .sort((a, b) => a.depth - b.depth);
  if (pts.length < 2) return null;

  const tempSpan = new Set(pts.map((p) => p.temperature)).size;
  const salSpan = new Set(pts.map((p) => p.salinity)).size;
  const depthSpan = new Set(pts.map((p) => p.depth)).size;
  if (tempSpan < 2 && salSpan < 2 && depthSpan < 2) return null;

  return pts;
}

function buildSceneData(points) {
  const temps = points.map((p) => p.temperature);
  const depths = points.map((p) => p.depth);
  const sals = points.map((p) => p.salinity);
  const tMin = Math.min(...temps), tMax = Math.max(...temps);
  const dMin = Math.min(...depths), dMax = Math.max(...depths);
  const sMin = Math.min(...sals), sMax = Math.max(...sals);
  const tSpan = tMax - tMin || 1;
  const dSpan = dMax - dMin || 1;
  const sSpan = sMax - sMin || 1;

  const positions = new Float32Array(points.length * 3);
  const colors = new Float32Array(points.length * 3);
  points.forEach((p, i) => {
    const nx = ((p.temperature - tMin) / tSpan - 0.5) * PLOT_WIDTH;
    const ny = -((p.depth - dMin) / dSpan) * PLOT_HEIGHT;
    const nz = ((p.salinity - sMin) / sSpan - 0.5) * PLOT_DEPTH;
    positions[i * 3] = nx;
    positions[i * 3 + 1] = ny;
    positions[i * 3 + 2] = nz;
    const [r, g, b] = depthColor((p.depth - dMin) / dSpan);
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  });

  return {
    positions,
    colors,
    ranges: { temperature: [tMin, tMax], depth: [dMin, dMax], salinity: [sMin, sMax] },
  };
}

/**
 * A genuine 3-axis 3D view: Temperature (X) × Depth (Y) × Salinity (Z),
 * plotted as a connected, depth-ordered scatter/line — both properties
 * visible simultaneously, unlike OceanSection3D's single-color-at-a-time
 * triangulated slab.
 *
 * Props:
 *  - section: return value of utils/oceanSection.js's buildOceanSection()
 *    (or buildOceanSectionFromMeta()). Renders nothing when the section
 *    doesn't have overlapping temperature + salinity data.
 */
function TempSalinityDepth3D({ section }) {
  const mountRef = useRef(null);
  const ctxRef = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const points = useMemo(() => buildTempSalinityDepthPoints(section), [section]);
  const data = useMemo(() => (points ? buildSceneData(points) : null), [points]);

  useEffect(() => {
    if (!mountRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setSize({ width, height });
    });
    ro.observe(mountRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!mountRef.current || !data) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(4.4, 2.4, 4.8);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    // Size immediately from the mount node's current box instead of waiting
    // for the (async) ResizeObserver callback below — see OceanSection3D for
    // why this matters.
    const initialRect = mountRef.current.getBoundingClientRect();
    if (initialRect.width > 0 && initialRect.height > 0) {
      camera.aspect = initialRect.width / initialRect.height;
      camera.updateProjectionMatrix();
      renderer.setSize(initialRect.width, initialRect.height);
    }

    // Defensive: guarantee the mount node is empty before we add our canvas,
    // in case a previous instance's cleanup ever failed to run.
    mountRef.current.innerHTML = '';
    mountRef.current.appendChild(renderer.domElement);

    const target = new THREE.Vector3(0, -PLOT_HEIGHT / 2, 0);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.copy(target);
    controls.minDistance = 2.5;
    controls.maxDistance = 16;
    controls.update();

    // Reference box + floor grid.
    const boxGeom = new THREE.BoxGeometry(PLOT_WIDTH, PLOT_HEIGHT, PLOT_DEPTH);
    boxGeom.translate(0, -PLOT_HEIGHT / 2, 0);
    const boxEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(boxGeom),
      new THREE.LineBasicMaterial({ color: 0x2b5561, transparent: true, opacity: 0.45 })
    );
    scene.add(boxEdges);

    const grid = new THREE.GridHelper(PLOT_WIDTH, 8, 0x2b5561, 0x16313c);
    grid.position.y = -PLOT_HEIGHT;
    scene.add(grid);

    // Corner axes (Temperature / Depth / Salinity), from the deepest,
    // coldest, least-saline corner.
    const origin = new THREE.Vector3(-PLOT_WIDTH / 2, -PLOT_HEIGHT, -PLOT_DEPTH / 2);
    const axisDefs = [
      { end: new THREE.Vector3(PLOT_WIDTH / 2, -PLOT_HEIGHT, -PLOT_DEPTH / 2), color: AXIS_COLORS.temperature, label: 'Temperature \u2192' },
      { end: new THREE.Vector3(-PLOT_WIDTH / 2, 0, -PLOT_DEPTH / 2), color: AXIS_COLORS.depth, label: 'Depth \u2193' },
      { end: new THREE.Vector3(-PLOT_WIDTH / 2, -PLOT_HEIGHT, PLOT_DEPTH / 2), color: AXIS_COLORS.salinity, label: 'Salinity \u2192' },
    ];
    const axisGroup = new THREE.Group();
    axisDefs.forEach(({ end, color, label }) => {
      const geom = new THREE.BufferGeometry().setFromPoints([origin, end]);
      const line = new THREE.Line(geom, new THREE.LineBasicMaterial({ color, linewidth: 2 }));
      axisGroup.add(line);
      const sprite = makeTextSprite(label, color);
      sprite.position.copy(end).multiplyScalar(1.0);
      sprite.position.lerp(origin, -0.12); // nudge just past the end of the axis
      axisGroup.add(sprite);
    });
    scene.add(axisGroup);

    // The depth-ordered path itself.
    const pathGeom = new THREE.BufferGeometry();
    pathGeom.setAttribute('position', new THREE.Float32BufferAttribute(data.positions.slice(), 3));
    pathGeom.setAttribute('color', new THREE.Float32BufferAttribute(data.colors.slice(), 3));
    const pathLine = new THREE.Line(pathGeom, new THREE.LineBasicMaterial({ vertexColors: true, linewidth: 2 }));
    scene.add(pathLine);

    const pointsGeom = new THREE.BufferGeometry();
    pointsGeom.setAttribute('position', new THREE.Float32BufferAttribute(data.positions.slice(), 3));
    pointsGeom.setAttribute('color', new THREE.Float32BufferAttribute(data.colors.slice(), 3));
    const pointsMaterial = new THREE.PointsMaterial({ size: 0.11, vertexColors: true, sizeAttenuation: true });
    const pointCloud = new THREE.Points(pointsGeom, pointsMaterial);
    scene.add(pointCloud);

    let frameId;
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      frameId = requestAnimationFrame(animate);
    };
    animate();

    ctxRef.current = { scene, camera, renderer, controls, target };

    return () => {
      cancelAnimationFrame(frameId);
      controls.dispose();
      boxGeom.dispose();
      boxEdges.geometry.dispose();
      boxEdges.material.dispose();
      grid.geometry.dispose();
      grid.material.dispose();
      axisGroup.children.forEach((child) => {
        child.geometry?.dispose?.();
        child.material?.map?.dispose?.();
        child.material?.dispose?.();
      });
      pathGeom.dispose();
      pathLine.material.dispose();
      pointsGeom.dispose();
      pointsMaterial.dispose();
      renderer.dispose();
      if (mountRef.current) mountRef.current.innerHTML = '';
      ctxRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx || size.width === 0 || size.height === 0) return;
    ctx.camera.aspect = size.width / size.height;
    ctx.camera.updateProjectionMatrix();
    ctx.renderer.setSize(size.width, size.height);
  }, [size, data]);

  const resetView = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    ctx.camera.position.set(4.4, 2.4, 4.8);
    ctx.controls.target.copy(ctx.target);
    ctx.controls.update();
  }, []);

  if (!data) return null;

  const { temperature, depth, salinity } = data.ranges;

  return (
    <div className="mt-4 pt-4 border-t border-slate-700/70">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Box className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-white">Temperature × Depth × Salinity</h3>
        </div>
        <button
          type="button"
          onClick={resetView}
          title="Reset view"
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs bg-slate-800/70 border border-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>

      <div
        ref={mountRef}
        className="relative w-full h-72 rounded-lg overflow-hidden border border-slate-700/70 cursor-grab active:cursor-grabbing"
        style={{ background: 'radial-gradient(circle at 50% 30%, #123039, #071620 75%)' }}
      />

      <div className="mt-2.5 grid grid-cols-3 gap-2 text-[11px] text-slate-400">
        <span><span style={{ color: `#${AXIS_COLORS.temperature.toString(16).padStart(6, '0')}` }}>●</span> Temp: {temperature[0].toFixed(1)}–{temperature[1].toFixed(1)} °C</span>
        <span><span style={{ color: `#${AXIS_COLORS.depth.toString(16).padStart(6, '0')}` }}>●</span> Depth: {depth[0].toFixed(0)}–{depth[1].toFixed(0)} m</span>
        <span><span style={{ color: `#${AXIS_COLORS.salinity.toString(16).padStart(6, '0')}` }}>●</span> Salinity: {salinity[0].toFixed(1)}–{salinity[1].toFixed(1)} PSU</span>
      </div>
      <p className="mt-1.5 text-[11px] text-slate-500">
        Drag to rotate · scroll to zoom · path follows the profile from shallow (light) to deep (dark)
      </p>
    </div>
  );
}

export default TempSalinityDepth3D;
