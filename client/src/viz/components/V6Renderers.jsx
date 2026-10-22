import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { prepareV6ProductInput } from '../v6Products.js';
import { buildV6IsosurfaceInWorker, buildV6ProductInWorker } from '../v6ProductWorkerClient.js';
import { createV6ProductLifecycle } from '../v6ProductLifecycle.js';
import { colorToUnitRgb, createColorScaleFromRange, paletteForVariable, scaleSwatchColor } from '../colorScale.js';
import ColorLegend from './ColorLegend.jsx';

// Same sequential/diverging scale as the 2D views (no rainbow), cached per range.
const scaleCache = new Map();
function scaleForRange(range, palette = null) {
  const key = `${range?.min}|${range?.max}|${palette || ''}`;
  if (!scaleCache.has(key)) {
    if (scaleCache.size > 32) scaleCache.clear();
    scaleCache.set(key, createColorScaleFromRange(range?.min, range?.max, { palette }));
  }
  return scaleCache.get(key);
}

function valueColor(value, range, palette = null) {
  const [r, g, b] = colorToUnitRgb(scaleForRange(range, palette).color(value));
  return new THREE.Color(r, g, b);
}

function sceneTransform(points, { xKey = 'x', yKey = 'y', zKey = 'z', verticalScale = 0.65 } = {}) {
  const xs = points.map((point) => Number(point[xKey])).filter(Number.isFinite);
  const ys = points.map((point) => Number(point[yKey])).filter(Number.isFinite);
  const zs = points.map((point) => Number(point[zKey])).filter(Number.isFinite);
  const bounds = {
    minX: Math.min(...xs, 0), maxX: Math.max(...xs, 1),
    minY: Math.min(...ys, 0), maxY: Math.max(...ys, 1),
    minZ: Math.min(...zs, 0), maxZ: Math.max(...zs, 1),
  };
  const sx = Math.max(1e-9, bounds.maxX - bounds.minX);
  const sy = Math.max(1e-9, bounds.maxY - bounds.minY);
  const sz = Math.max(1e-9, bounds.maxZ - bounds.minZ);
  const normalize = (point) => ({
    x: ((Number(point[xKey]) - bounds.minX) / sx - 0.5) * 10,
    y: ((Number(point[yKey]) - bounds.minY) / sy - 0.5) * 10 * verticalScale,
    z: ((Number(point[zKey]) - bounds.minZ) / sz - 0.5) * 10,
  });
  return { normalize, bounds };
}

function addPointCloud(scene, points, valueRange, { size = 0.07, opacity = 0.78, position = (point) => point, palette = null } = {}) {
  if (!points.length) return null;
  const positions = new Float32Array(points.length * 3);
  const colors = new Float32Array(points.length * 3);
  for (let index = 0; index < points.length; index += 1) {
    const p = position(points[index]);
    positions[index * 3] = p.x; positions[index * 3 + 1] = p.y; positions[index * 3 + 2] = p.z;
    const color = valueColor(points[index].value, valueRange, palette);
    colors[index * 3] = color.r; colors[index * 3 + 1] = color.g; colors[index * 3 + 2] = color.b;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({ size, vertexColors: true, transparent: opacity < 1, opacity, sizeAttenuation: true });
  const cloud = new THREE.Points(geometry, material); scene.add(cloud); return cloud;
}

function addMeasuredPoints(scene, points, position) {
  if (!points?.length) return null;
  const positions = new Float32Array(points.length * 3);
  for (let index = 0; index < points.length; index += 1) {
    const p = position(points[index]);
    positions[index * 3] = p.x; positions[index * 3 + 1] = p.y; positions[index * 3 + 2] = p.z;
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({ size: 0.11, color: 0xffffff, sizeAttenuation: true });
  const cloud = new THREE.Points(geometry, material); scene.add(cloud); return cloud;
}

function buildSurfaceScene(scene, product) {
  const cells = product.cells || [];
  const transform = sceneTransform(cells.map((cell) => ({ x: cell.x, y: cell.value, z: cell.y })), { verticalScale: 0.55 });
  const byCell = new Map(cells.map((cell) => [`${cell.ix}:${cell.iy}`, cell]));
  const triangles = []; const colors = [];
  const pushVertex = (cell) => {
    const p = transform.normalize({ x: cell.x, y: cell.value, z: cell.y }); triangles.push(p.x, p.y, p.z);
    const color = valueColor(cell.value, product.valueRange, paletteForVariable(product)); colors.push(color.r, color.g, color.b);
  };
  for (const cell of cells) {
    const right = byCell.get(`${cell.ix + 1}:${cell.iy}`); const up = byCell.get(`${cell.ix}:${cell.iy + 1}`); const diagonal = byCell.get(`${cell.ix + 1}:${cell.iy + 1}`);
    if (!right || !up || !diagonal) continue;
    pushVertex(cell); pushVertex(right); pushVertex(up); pushVertex(right); pushVertex(diagonal); pushVertex(up);
  }
  if (triangles.length) {
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(triangles, 3)); geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geometry.computeVertexNormals();
    scene.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.86, roughness: 0.68, metalness: 0.02 })));
  }
  addMeasuredPoints(scene, product.measured || [], (point) => transform.normalize({ x: point.x, y: point.value, z: point.y }));
}

function buildCurtainScene(scene, product) {
  const toSceneAxes = (point) => ({ x: point.x, y: point.z, z: point.y });
  const transform = sceneTransform((product.points || []).map(toSceneAxes), { verticalScale: 0.8 });
  addPointCloud(scene, product.points || [], product.valueRange, { palette: paletteForVariable(product), size: 0.075, position: (point) => transform.normalize(toSceneAxes(point)) });
  const groups = new Map();
  for (const point of product.points || []) { const key = String(point.castId); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(point); }
  const linePositions = [];
  for (const points of groups.values()) {
    points.sort((a, b) => a.z - b.z);
    for (let index = 1; index < points.length; index += 1) {
      const a = transform.normalize(toSceneAxes(points[index - 1])); const b = transform.normalize(toSceneAxes(points[index])); linePositions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }
  if (linePositions.length) { const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3)); scene.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.5 }))); }
  if (product.track?.length > 1) {
    const trackPositions = [];
    for (let index = 1; index < product.track.length; index += 1) { const a = transform.normalize(toSceneAxes(product.track[index - 1])); const b = transform.normalize(toSceneAxes(product.track[index])); trackPositions.push(a.x, a.y, a.z, b.x, b.y, b.z); }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(trackPositions, 3)); scene.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x22d3ee, opacity: 0.8, transparent: true })));
  }
}

function volumeTransform(product) {
  return sceneTransform((product.cells || []).map((cell) => ({ x: cell.x, y: -cell.z, z: cell.y })), { verticalScale: 0.75 });
}

function buildVolumeScene(scene, product) {
  const transform = volumeTransform(product);
  addPointCloud(scene, product.cells || [], product.valueRange, { palette: paletteForVariable(product), size: 0.08, opacity: 0.45, position: (cell) => transform.normalize({ x: cell.x, y: -cell.z, z: cell.y }) });
  addMeasuredPoints(scene, product.measured || [], (point) => transform.normalize({ x: point.x, y: -point.z, z: point.y }));
}

function buildIsoMeshObject(product, isoMesh) {
  if (!isoMesh?.valid || !isoMesh.positions?.length) return null;
  const transform = volumeTransform(product);
  const source = isoMesh.positions;
  const transformed = new Float32Array(source.length);
  for (let i = 0; i < source.length; i += 3) {
    const p = transform.normalize({ x: source[i], y: -source[i + 2], z: source[i + 1] });
    transformed[i] = p.x; transformed[i + 1] = p.y; transformed[i + 2] = p.z;
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(transformed, 3)); geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ color: 0x22d3ee, roughness: 0.55, metalness: 0.03, transparent: true, opacity: 0.82, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material); mesh.name = 'v6-isosurface-mesh'; return mesh;
}

function buildVectorScene(scene, product) {
  const arrows = product.arrows || [];
  const transform = sceneTransform(arrows.map((arrow) => ({ x: arrow.x, y: arrow.z, z: arrow.y })), { verticalScale: 0.6 });
  const maxSpeed = Math.max(...arrows.map((arrow) => Number(arrow.speed) || 0), 1e-9); const positions = [];
  for (const arrow of arrows) {
    const start = transform.normalize({ x: arrow.x, y: arrow.z, z: arrow.y }); const length = 0.35 + 0.7 * Math.min(1, arrow.speed / maxSpeed); const angle = Math.atan2(arrow.v, arrow.u);
    const end = { x: start.x + Math.cos(angle) * length, y: start.y, z: start.z + Math.sin(angle) * length }; positions.push(start.x, start.y, start.z, end.x, end.y, end.z);
    const head = 0.18; positions.push(end.x, end.y, end.z, end.x - Math.cos(angle - 0.55) * head, end.y, end.z - Math.sin(angle - 0.55) * head); positions.push(end.x, end.y, end.z, end.x - Math.cos(angle + 0.55) * head, end.y, end.z - Math.sin(angle + 0.55) * head);
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); scene.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.9 })));
}

function disposeObject(object) {
  object?.geometry?.dispose?.();
  if (Array.isArray(object?.material)) object.material.forEach((material) => material.dispose?.());
  else object?.material?.dispose?.();
}

function ThreeProductScene({ view, product, isoMesh, onFailure, resetToken = 0 }) {
  const mountRef = useRef(null); const sceneRef = useRef(null); const isoObjectRef = useRef(null); const cameraRef = useRef(null); const controlsRef = useRef(null);
  useEffect(() => {
    const mount = mountRef.current; if (!mount || !product?.valid) return undefined;
    let renderer; let frame = 0; let observer; let disposed = false;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' }); }
    catch (error) { onFailure?.(error); return undefined; }
    renderer.setPixelRatio(Math.min(1.5, globalThis.devicePixelRatio || 1)); renderer.setClearColor(0x06121a, 1);
    const canvas = renderer.domElement; const contextLost = (event) => { event.preventDefault(); onFailure?.(new Error('WebGL context was lost.')); };
    canvas.addEventListener('webglcontextlost', contextLost, false); mount.replaceChildren(canvas);
    const scene = new THREE.Scene(); sceneRef.current = scene;
    scene.add(new THREE.AmbientLight(0xffffff, 1.3)); const light = new THREE.DirectionalLight(0xffffff, 1.5); light.position.set(5, 8, 6); scene.add(light); scene.add(new THREE.AxesHelper(4.5)); scene.add(new THREE.GridHelper(10, 10, 0x2a5165, 0x163041));
    const camera = new THREE.PerspectiveCamera(48, 1, 0.01, 1000); camera.position.set(10, 8, 12); const controls = new OrbitControls(camera, canvas); controls.enableDamping = true; controls.dampingFactor = 0.08; cameraRef.current = camera; controlsRef.current = controls;
    if (view === 'surface3D') buildSurfaceScene(scene, product); else if (view === 'curtain3D') buildCurtainScene(scene, product); else if (view === 'volume3D') buildVolumeScene(scene, product); else if (view === 'isosurface') { const transform = volumeTransform(product); addMeasuredPoints(scene, product.measured || [], (point) => transform.normalize({ x: point.x, y: -point.z, z: point.y })); } else if (view === 'vector3D') buildVectorScene(scene, product);
    const resize = () => { if (disposed) return; const width = Math.max(320, mount.clientWidth || 800); const height = Math.max(360, Math.min(620, width * 0.62)); renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); };
    resize(); observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null; observer?.observe(mount);
    const animate = () => { if (disposed) return; controls.update(); renderer.render(scene, camera); frame = requestAnimationFrame(animate); }; animate();
    return () => {
      disposed = true; cancelAnimationFrame(frame); observer?.disconnect(); controls.dispose(); canvas.removeEventListener('webglcontextlost', contextLost);
      scene.traverse(disposeObject); sceneRef.current = null; isoObjectRef.current = null; cameraRef.current = null; controlsRef.current = null; renderer.dispose(); if (mount.contains(canvas)) mount.removeChild(canvas);
    };
  }, [view, product, onFailure]);

  useEffect(() => {
    const camera = cameraRef.current; const controls = controlsRef.current;
    if (!camera || !controls || !resetToken) return;
    camera.position.set(10, 8, 12); controls.target.set(0, 0, 0); controls.update();
  }, [resetToken]);

  useEffect(() => {
    if (view !== 'isosurface' || !sceneRef.current) return;
    const scene = sceneRef.current;
    if (isoObjectRef.current) { scene.remove(isoObjectRef.current); disposeObject(isoObjectRef.current); isoObjectRef.current = null; }
    const object = buildIsoMeshObject(product, isoMesh);
    if (object) { scene.add(object); isoObjectRef.current = object; }
  }, [view, product, isoMesh]);

  return <div ref={mountRef} className="viz-plot min-h-[360px] w-full" />;
}

export default function Advanced3DView({ view, dataset, variableKey, pair, cachedProduct = null, productKey = '', onProductReady = null, onFallback = null, resetCameraToken = 0 }) {
  const lifecycleRef = useRef(null); if (!lifecycleRef.current) lifecycleRef.current = createV6ProductLifecycle();
  const isoLifecycleRef = useRef(null); if (!isoLifecycleRef.current) isoLifecycleRef.current = createV6ProductLifecycle();
  const [generated, setGenerated] = useState(cachedProduct || null); const [building, setBuilding] = useState(false); const [buildError, setBuildError] = useState(''); const [webglError, setWebglError] = useState('');
  const [isoMesh, setIsoMesh] = useState(null); const [isoBuilding, setIsoBuilding] = useState(false);
  const valueRange = generated?.valueRange || generated?.speedRange || null; const [isoValue, setIsoValue] = useState(0);

  useEffect(() => {
    setWebglError(''); setBuildError(''); setIsoMesh(null); setIsoBuilding(false);
    if (cachedProduct) { lifecycleRef.current.cancel(); setGenerated(cachedProduct); setBuilding(false); return undefined; }
    const preparedInput = prepareV6ProductInput(view, dataset, variableKey, pair);
    if (!preparedInput.valid) { lifecycleRef.current.cancel(); setGenerated(preparedInput); setBuilding(false); return undefined; }
    const { generation, signal } = lifecycleRef.current.begin(); setGenerated(null); setBuilding(true);
    buildV6ProductInWorker(preparedInput, { signal }).then((product) => {
      if (!lifecycleRef.current.isCurrent(generation)) return;
      setGenerated(product); setBuilding(false); if (product?.valid) onProductReady?.(product);
    }).catch((error) => {
      if (!lifecycleRef.current.isCurrent(generation)) return;
      setBuilding(false); if (error?.name !== 'AbortError') setBuildError(error?.message || '3D product generation failed.');
    });
    return () => { if (lifecycleRef.current.isCurrent(generation)) lifecycleRef.current.cancel(); };
  }, [cachedProduct, productKey, view, dataset, variableKey, pair?.u, pair?.v, onProductReady]);

  useEffect(() => { if (valueRange) setIsoValue((valueRange.min + valueRange.max) / 2); }, [valueRange?.min, valueRange?.max, productKey]);

  useEffect(() => {
    if (view !== 'isosurface' || !generated?.valid || !Number.isFinite(isoValue)) { isoLifecycleRef.current.cancel(); setIsoMesh(null); setIsoBuilding(false); return undefined; }
    const { generation, signal } = isoLifecycleRef.current.begin(); setIsoBuilding(true);
    buildV6IsosurfaceInWorker(generated, isoValue, { signal }).then((mesh) => {
      if (!isoLifecycleRef.current.isCurrent(generation)) return; setIsoMesh(mesh); setIsoBuilding(false);
    }).catch((error) => { if (!isoLifecycleRef.current.isCurrent(generation)) return; setIsoBuilding(false); if (error?.name !== 'AbortError') setBuildError(error?.message || 'Isosurface generation failed.'); });
    return () => { if (isoLifecycleRef.current.isCurrent(generation)) isoLifecycleRef.current.cancel(); };
  }, [view, generated, isoValue]);

  const handleWebglFailure = useCallback((error) => setWebglError(error?.message || 'WebGL failure'), []);

  if (building) return <div className="viz-empty"><div className="viz-empty-title">Building 3D scientific product…</div><p className="viz-empty-text">Bounded products are generated in a background worker, so the page stays responsive.</p><div className="viz-progress-track"><div className="viz-progress-fill viz-progress-indeterminate" /></div></div>;
  if (buildError) return <div className="viz-note" data-tone="warning">{buildError}{onFallback && <button onClick={onFallback} className="viz-btn viz-btn-sm ml-3">Open compatible view</button>}</div>;
  if (!generated?.valid) return <div className="viz-note" data-tone="warning">{generated?.reason || 'This 3D product could not be generated safely.'}{onFallback && <button onClick={onFallback} className="viz-btn viz-btn-sm ml-3">Open compatible view</button>}</div>;
  if (webglError) return <div className="viz-note" data-tone="warning"><div>WebGL could not render this view safely: {webglError}</div>{onFallback && <button onClick={onFallback} className="viz-btn viz-btn-sm mt-3">Open compatible 2D view</button>}</div>;

  return <div>
    <div className="viz-plot-meta">
      {generated.cells && <span>{generated.cells.length.toLocaleString()} bounded interpolated cells</span>}
      {generated.points && <span>{generated.points.length.toLocaleString()} bounded measured points</span>}
      {generated.arrows && <span>{generated.arrows.length.toLocaleString()} bounded vectors</span>}
      {view === 'isosurface' && isoMesh?.valid && <span>{isoMesh.triangleCount.toLocaleString()} bounded iso triangles</span>}
      {cachedProduct && <span className="viz-ok-text">restored from the local visualization cache</span>}
    </div>
    {view === 'volume3D' && <div className="viz-note mb-3" data-tone="info">Interpolated volume field — bounded, coverage-masked estimates. Measured observations remain separate.</div>}
    {view === 'isosurface' && valueRange && <div className="viz-card mb-3 p-3"><div className="flex justify-between text-xs"><span className="viz-label">Isovalue</span><span className="viz-num text-sm font-semibold viz-accent-text">{Number(isoValue.toPrecision(6))}{generated.unit ? ` ${generated.unit}` : ''}</span></div><input className="viz-range mt-2" type="range" min={valueRange.min} max={valueRange.max} step={Math.max(1e-9, (valueRange.max - valueRange.min) / 100)} value={isoValue} onChange={(event) => setIsoValue(Number(event.target.value))} aria-label="Isosurface value" /><p className="mt-2 text-[12px] viz-warn-text">The isosurface is derived from an interpolated, coverage-masked volume. It is not a directly measured boundary.</p>{isoBuilding && <p className="mt-1 text-[12px] viz-accent-text">Building bounded isosurface mesh…</p>}</div>}
    <ThreeProductScene view={view} product={generated} isoMesh={isoMesh} onFailure={handleWebglFailure} resetToken={resetCameraToken} />
    {valueRange && view !== 'vector3D' && view !== 'isosurface' && (() => { const legendScale = createColorScaleFromRange(valueRange.min, valueRange.max, { palette: paletteForVariable(generated) }); return <ColorLegend scale={legendScale} label={generated.variableName || 'Value'} unit={generated.unit} keys={[{ label: 'Measured observation', color: '#ffffff', stroke: '#ffffff' }, { kind: 'swatch', label: 'Derived / interpolated product', color: scaleSwatchColor(legendScale), opacity: 0.7 }]} />; })()}
    {valueRange && view === 'vector3D' && <ColorLegend scale={createColorScaleFromRange(valueRange.min, valueRange.max)} label="Current speed" unit={generated.unit} />}
    <p className="viz-plot-caption"><span className="viz-text-2 font-semibold">Scientific distinction:</span> white points are measured observations where available; coloured surfaces, volume cells and isosurface triangles are bounded derived/interpolated products. Vertical exaggeration is display-only.</p>
    {(generated.warning || generated.provenance?.length || isoMesh?.provenance?.length) && <div className="mt-2 space-y-1 text-xs viz-muted">{generated.warning && <div className="viz-warn-text">{generated.warning}</div>}{generated.provenance?.map((entry, index) => <div key={`${entry}-${index}`}>{entry}</div>)}{isoMesh?.provenance?.map((entry, index) => <div key={`iso-${entry}-${index}`}>{entry}</div>)}</div>}
  </div>;
}
