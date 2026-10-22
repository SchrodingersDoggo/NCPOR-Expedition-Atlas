import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Delaunay } from 'd3-delaunay';
import { Box, Thermometer, Droplets, RotateCcw } from 'lucide-react';

// World-space size of the triangulated slab. Kept fixed regardless of the
// data's real units — axes are normalized 0..1 before being mapped in here,
// so wildly different depth ranges / transect lengths always fill the view.
const SLAB_WIDTH = 5.2;
const SLAB_HEIGHT = 3.6;
const SLAB_THICKNESS = 0.55;

const NO_DATA_COLOR = [0.32, 0.34, 0.37];

// Small hand-picked colormaps (not a real oceanographic standard — just two
// visually distinct gradients so temperature and salinity read differently
// as you switch between them).
const COLOR_STOPS = {
  temperature: [
    [0.0, [0.04, 0.12, 0.36]],
    [0.25, [0.05, 0.42, 0.56]],
    [0.5, [0.18, 0.68, 0.52]],
    [0.75, [0.92, 0.76, 0.22]],
    [1.0, [0.86, 0.21, 0.16]],
  ],
  salinity: [
    [0.0, [0.09, 0.16, 0.44]],
    [0.33, [0.09, 0.44, 0.55]],
    [0.66, [0.54, 0.68, 0.46]],
    [1.0, [0.95, 0.86, 0.56]],
  ],
};

const PROPERTY_META = {
  temperature: { label: 'Temperature', icon: Thermometer, unit: '\u00b0C' },
  salinity: { label: 'Salinity', icon: Droplets, unit: 'PSU' },
};

function sampleColormap(stops, t) {
  const clamped = Math.min(1, Math.max(0, t));
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (clamped >= t0 && clamped <= t1) {
      const f = t1 === t0 ? 0 : (clamped - t0) / (t1 - t0);
      return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f];
    }
  }
  return stops[stops.length - 1][1];
}

function legendGradientCss(prop) {
  const stops = COLOR_STOPS[prop] || COLOR_STOPS.temperature;
  const parts = stops.map(([t, [r, g, b]]) => `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)}) ${Math.round(t * 100)}%`);
  return `linear-gradient(90deg, ${parts.join(', ')})`;
}

// Delaunay-triangulates the (x, depth) point cloud into a thin extruded
// slab: a front face + a mirrored back face + side walls stitched around
// the convex hull, so it reads as a real 3D object from any angle rather
// than a flat plane. Colors are precomputed per available property so
// toggling temperature/salinity only swaps a color attribute, not the mesh.
function buildSlabGeometry(section) {
  const { points, availableProperties } = section;
  const n = points.length;

  const xs = points.map((p) => p.x);
  const depths = points.map((p) => p.depth);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const dMin = Math.min(...depths);
  const dMax = Math.max(...depths);
  const xSpan = xMax - xMin || 1;
  const dSpan = dMax - dMin || 1;

  // nx/ny: normalized plotting coordinates. Depth grows downward (negative
  // y), matching how a researcher expects a section to read.
  const nx = points.map((p) => ((p.x - xMin) / xSpan - 0.5) * SLAB_WIDTH);
  const ny = points.map((p) => -((p.depth - dMin) / dSpan) * SLAB_HEIGHT);

  const delaunay = Delaunay.from(points.map((_, i) => [nx[i], ny[i]]));
  const tris = delaunay.triangles;
  const hull = Array.from(delaunay.hull);

  const positions = new Float32Array(n * 2 * 3);
  for (let i = 0; i < n; i++) {
    positions[i * 3] = nx[i];
    positions[i * 3 + 1] = ny[i];
    positions[i * 3 + 2] = SLAB_THICKNESS / 2;
    const bi = n + i;
    positions[bi * 3] = nx[i];
    positions[bi * 3 + 1] = ny[i];
    positions[bi * 3 + 2] = -SLAB_THICKNESS / 2;
  }

  const indices = [];
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t];
    const b = tris[t + 1];
    const c = tris[t + 2];
    indices.push(a, b, c); // front
    indices.push(n + a, n + c, n + b); // back, reversed winding
  }
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    indices.push(a, b, n + b);
    indices.push(a, n + b, n + a);
  }

  const colors = {};
  const ranges = {};
  for (const prop of availableProperties) {
    const vals = points.map((p) => p[prop]).filter((v) => v !== null && v !== undefined);
    const vMin = vals.length ? Math.min(...vals) : 0;
    const vMax = vals.length ? Math.max(...vals) : 1;
    const vSpan = vMax - vMin || 1;
    ranges[prop] = [vMin, vMax];

    const arr = new Float32Array(n * 2 * 3);
    for (let i = 0; i < n; i++) {
      const v = points[i][prop];
      const rgb = v === null || v === undefined ? NO_DATA_COLOR : sampleColormap(COLOR_STOPS[prop] || COLOR_STOPS.temperature, (v - vMin) / vSpan);
      arr[i * 3] = rgb[0];
      arr[i * 3 + 1] = rgb[1];
      arr[i * 3 + 2] = rgb[2];
      const bi = n + i;
      arr[bi * 3] = rgb[0];
      arr[bi * 3 + 1] = rgb[1];
      arr[bi * 3 + 2] = rgb[2];
    }
    colors[prop] = arr;
  }

  return { positions, indices, colors, ranges };
}

/**
 * Props:
 *  - section: return value of utils/oceanSection.js's buildOceanSection()
 */
function OceanSection3D({ section }) {
  const mountRef = useRef(null);
  const ctxRef = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [colorBy, setColorBy] = useState(section.availableProperties[0]);

  const built = useMemo(() => buildSlabGeometry(section), [section]);

  useEffect(() => {
    if (!section.availableProperties.includes(colorBy)) {
      setColorBy(section.availableProperties[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);

  // Track container size for the renderer/camera.
  useEffect(() => {
    if (!mountRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setSize({ width, height });
    });
    ro.observe(mountRef.current);
    return () => ro.disconnect();
  }, []);

  // Build the three.js scene once per geometry (i.e. once per uploaded
  // dataset — switching color property just updates a color attribute).
  useEffect(() => {
    if (!mountRef.current) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(4.2, 2.6, 5.2);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    // Size immediately from the mount node's current box instead of waiting
    // for the (async) ResizeObserver callback below — otherwise the first
    // frame(s) render at three.js's default 300x150 backing size with the
    // wrong aspect ratio, and if a rebuild ever races with that correction
    // it can look like a second, wrongly-shaped mesh floating nearby.
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

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, -SLAB_HEIGHT / 2 + 0.4, 0);
    controls.minDistance = 2.5;
    controls.maxDistance = 16;
    controls.update();

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(built.positions, 3));
    const initialColorProp = section.availableProperties.includes(colorBy) ? colorBy : section.availableProperties[0];
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(built.colors[initialColorProp].slice(), 3));
    geometry.setIndex(built.indices);

    const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    // Faint wireframe so the triangulation itself is visible, not just a
    // smooth-shaded blob.
    const wireGeometry = new THREE.WireframeGeometry(geometry);
    const wireMaterial = new THREE.LineBasicMaterial({ color: 0x081820, transparent: true, opacity: 0.28 });
    const wireframe = new THREE.LineSegments(wireGeometry, wireMaterial);
    scene.add(wireframe);

    const edges = new THREE.BoxHelper(mesh, 0x2b5561);
    scene.add(edges);

    let frameId;
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      frameId = requestAnimationFrame(animate);
    };
    animate();

    ctxRef.current = { scene, camera, renderer, controls, geometry };

    return () => {
      cancelAnimationFrame(frameId);
      controls.dispose();
      geometry.dispose();
      material.dispose();
      wireGeometry.dispose();
      wireMaterial.dispose();
      edges.geometry.dispose();
      edges.material.dispose();
      renderer.dispose();
      if (mountRef.current) mountRef.current.innerHTML = '';
      ctxRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built]);

  // Resize.
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx || size.width === 0 || size.height === 0) return;
    ctx.camera.aspect = size.width / size.height;
    ctx.camera.updateProjectionMatrix();
    ctx.renderer.setSize(size.width, size.height);
  }, [size, built]);

  // Swap color attribute when colorBy changes — no geometry rebuild needed.
  useEffect(() => {
    const ctx = ctxRef.current;
    const colorArr = built.colors[colorBy];
    if (!ctx || !colorArr) return;
    ctx.geometry.attributes.color.set(colorArr);
    ctx.geometry.attributes.color.needsUpdate = true;
  }, [colorBy, built]);

  const resetView = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    ctx.camera.position.set(4.2, 2.6, 5.2);
    ctx.controls.target.set(0, -SLAB_HEIGHT / 2 + 0.4, 0);
    ctx.controls.update();
  }, []);

  const range = built.ranges[colorBy];
  const meta = PROPERTY_META[colorBy] || PROPERTY_META.temperature;

  return (
    <div className="mt-4 pt-4 border-t border-slate-700/70">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Box className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-white">3D depth section</h3>
        </div>
        <div className="flex items-center gap-2">
          {section.availableProperties.map((prop) => {
            const propMeta = PROPERTY_META[prop];
            const Icon = propMeta.icon;
            const active = colorBy === prop;
            return (
              <button
                key={prop}
                type="button"
                onClick={() => setColorBy(prop)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  active ? 'bg-cyan-600 border-cyan-500 text-white' : 'bg-slate-800/70 border-slate-700 text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" /> {propMeta.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={resetView}
            title="Reset view"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs bg-slate-800/70 border border-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div
        ref={mountRef}
        className="relative w-full h-72 rounded-lg overflow-hidden border border-slate-700/70 cursor-grab active:cursor-grabbing"
        style={{ background: 'radial-gradient(circle at 50% 30%, #123039, #071620 75%)' }}
      />

      <div className="mt-2.5 flex items-center gap-3 text-[11px] text-slate-400">
        <span className="whitespace-nowrap">
          {meta.label} ({meta.unit})
        </span>
        <div className="flex-1 h-2 rounded-full" style={{ background: legendGradientCss(colorBy) }} />
        <span className="whitespace-nowrap">{range ? `${range[0].toFixed(1)} \u2013 ${range[1].toFixed(1)}` : '\u2014'}</span>
      </div>
      <p className="mt-1.5 text-[11px] text-slate-500">
        Drag to rotate · scroll to zoom{section.hasPosition ? ` · horizontal axis: ${section.xLabel}` : ''} · vertical axis: {section.depthLabel}
      </p>
    </div>
  );
}

export default OceanSection3D;
