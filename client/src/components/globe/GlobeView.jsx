import React, { useRef, useEffect, useMemo, useState } from 'react';
import Globe from 'react-globe.gl';
import * as THREE from 'three';
import { fetchResearchStations } from '../../api/stations.js';

// Phase 4 — the actual WebGL globe, split into its own module so it (and
// react-globe.gl / three, which are the heavy part of the bundle) is only
// ever downloaded when LandingPage lazy-loads this file. Fast and medium
// tiers both render this component; slow/offline never import it at all.
//
// `reduced` is the only behavior toggle. FAST passes reduced={false} and
// must look and behave exactly like the pre-Phase-4 globe. MEDIUM passes
// reduced={true}, which drops the bump/topology texture, the atmosphere,
// and the auto-rotate animation — all render/GPU cost, not features — while
// keeping pins, rings, click-to-select, and camera fly-to fully working.

const STATION_MATERIALS = {
  foundation: new THREE.MeshStandardMaterial({
    color: 0x2a3942,
    roughness: 0.82,
    metalness: 0.22,
  }),
  structure: new THREE.MeshStandardMaterial({
    color: 0xd6dde2,
    roughness: 0.68,
    metalness: 0.12,
  }),
  structureDark: new THREE.MeshStandardMaterial({
    color: 0x79909d,
    roughness: 0.7,
    metalness: 0.18,
  }),
  window: new THREE.MeshStandardMaterial({
    color: 0x73c6dd,
    emissive: 0x163c47,
    emissiveIntensity: 0.42,
    roughness: 0.3,
    metalness: 0.05,
  }),
  antenna: new THREE.MeshStandardMaterial({
    color: 0xb9c8cf,
    roughness: 0.46,
    metalness: 0.52,
  }),
  beacon: new THREE.MeshStandardMaterial({
    color: 0xc9f4ff,
    emissive: 0x4fc9ea,
    emissiveIntensity: 0.7,
    roughness: 0.28,
    metalness: 0.05,
  }),
  stationRing: new THREE.MeshStandardMaterial({
    color: 0xe8c688,
    emissive: 0x5b431b,
    emissiveIntensity: 0.48,
    roughness: 0.42,
    metalness: 0.28,
    transparent: true,
    opacity: 0.92,
  }),
};

function isHistoricalStation(station) {
  const key = String(station?.id || station?.name || '').toLowerCase();
  return station?.status === 'historical' || key.includes('dakshin-gangotri') || key.includes('dakshin gangotri');
}

function addBox(group, size, position, material, rotation = null) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  if (rotation) mesh.rotation.set(...rotation);
  group.add(mesh);
  return mesh;
}

function addMast(group, position, height, reduced) {
  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(reduced ? 0.08 : 0.09, reduced ? 0.08 : 0.1, height, 6),
    STATION_MATERIALS.antenna,
  );
  mast.position.set(position[0], position[1] + height / 2, position[2]);
  group.add(mast);

  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(reduced ? 0.13 : 0.16, reduced ? 6 : 8, reduced ? 4 : 6),
    STATION_MATERIALS.beacon,
  );
  beacon.position.set(position[0], position[1] + height + 0.1, position[2]);
  group.add(beacon);
}

function finishStationModel(model, reduced) {
  // three-globe positions surface-facing objects with local +Z pointing
  // away from Earth. The station geometry is authored Y-up, so rotate the
  // entire model once so its roofs/platform stay tangent to the globe and
  // the mast/building height points radially outward instead of sideways.
  const surfaceRoot = new THREE.Group();
  surfaceRoot.add(model);
  surfaceRoot.rotation.x = Math.PI / 2;
  surfaceRoot.scale.setScalar(reduced ? 1.18 : 1.38);
  return surfaceRoot;
}

function createStationBaseObject(station, reduced) {
  const group = new THREE.Group();
  const stationKey = String(station?.id || station?.name || '').toLowerCase();
  const isBharati = stationKey.includes('bharati');
  const isMaitri = stationKey.includes('maitri');
  const isDakshin = stationKey.includes('dakshin');

  // Globe.gl's globe radius is ~100 Three.js units. These intentionally
  // stay around 1–4 units so the bases read clearly without becoming toys.
  const platform = new THREE.Mesh(
    new THREE.CylinderGeometry(reduced ? 1.15 : 1.45, reduced ? 1.28 : 1.6, reduced ? 0.3 : 0.38, reduced ? 8 : 12),
    STATION_MATERIALS.foundation,
  );
  platform.position.y = 0.18;
  group.add(platform);

  // A thin brass locator ring makes the permanent base easy to find at the
  // landing-page zoom without turning it into a giant map pin.
  const ringMaterial = isDakshin
    ? STATION_MATERIALS.stationRing.clone()
    : STATION_MATERIALS.stationRing;
  if (isDakshin) {
    // Dakshin Gangotri is a historical base, so keep its locator present
    // but intentionally quieter than the active Maitri/Bharati markers.
    ringMaterial.opacity = 0.5;
    ringMaterial.emissiveIntensity = 0.2;
  }

  const locatorRing = new THREE.Mesh(
    new THREE.TorusGeometry(reduced ? 1.48 : 1.82, reduced ? 0.065 : 0.085, 6, reduced ? 16 : 24),
    ringMaterial,
  );
  locatorRing.rotation.x = Math.PI / 2;
  locatorRing.position.y = 0.17;
  group.add(locatorRing);

  if (reduced) {
    addBox(
      group,
      [isBharati ? 2.5 : 2.15, 0.85, isMaitri ? 1.55 : 1.35],
      [0, 0.82, 0],
      STATION_MATERIALS.structure,
    );
    addBox(
      group,
      [isBharati ? 2.34 : 2.02, 0.15, isMaitri ? 1.43 : 1.23],
      [0, 1.33, 0],
      STATION_MATERIALS.structureDark,
    );
    addMast(group, [isBharati ? 0.7 : -0.68, 1.28, -0.25], 1.05, true);
    group.rotation.y = isBharati ? 0.45 : isMaitri ? -0.28 : 0.18;
    return finishStationModel(group, reduced);
  }

  // Full mode: each Indian Antarctic station gets a slightly different
  // silhouette while reusing simple low-poly primitives.
  if (isBharati) {
    addBox(group, [2.8, 1.05, 1.55], [-0.25, 0.98, 0], STATION_MATERIALS.structure);
    addBox(group, [1.6, 0.8, 1.25], [1.55, 0.82, 0.18], STATION_MATERIALS.structure);
    addBox(group, [0.7, 0.42, 0.75], [0.82, 0.66, 0.1], STATION_MATERIALS.structureDark);
    addBox(group, [2.62, 0.16, 1.4], [-0.25, 1.59, 0], STATION_MATERIALS.structureDark);
    addBox(group, [1.42, 0.14, 1.1], [1.55, 1.29, 0.18], STATION_MATERIALS.structureDark);
    addBox(group, [0.12, 0.38, 0.95], [-1.67, 1.0, 0], STATION_MATERIALS.window);
    addBox(group, [0.12, 0.3, 0.7], [2.36, 0.85, 0.18], STATION_MATERIALS.window);
    addMast(group, [-0.92, 1.62, -0.42], 1.5, false);
    group.rotation.y = 0.44;
  } else if (isMaitri) {
    addBox(group, [2.2, 0.95, 1.7], [-0.62, 0.92, 0], STATION_MATERIALS.structure);
    addBox(group, [1.65, 0.8, 1.25], [1.25, 0.82, -0.18], STATION_MATERIALS.structure);
    addBox(group, [0.72, 0.4, 0.62], [0.42, 0.63, -0.08], STATION_MATERIALS.structureDark);
    addBox(group, [2.0, 0.15, 1.52], [-0.62, 1.46, 0], STATION_MATERIALS.structureDark);
    addBox(group, [1.48, 0.14, 1.08], [1.25, 1.27, -0.18], STATION_MATERIALS.structureDark);
    addBox(group, [0.12, 0.34, 0.92], [-1.73, 0.95, 0], STATION_MATERIALS.window);
    addMast(group, [1.55, 1.25, -0.5], 1.35, false);
    group.rotation.y = -0.3;
  } else if (isDakshin) {
    // Historical Dakshin Gangotri: intentionally lower and more compact.
    addBox(group, [2.35, 0.72, 1.55], [0, 0.78, 0], STATION_MATERIALS.structureDark);
    addBox(group, [1.55, 0.58, 1.18], [-0.6, 1.39, -0.06], STATION_MATERIALS.structure);
    addBox(group, [1.45, 0.13, 1.08], [-0.6, 1.75, -0.06], STATION_MATERIALS.structureDark);
    addBox(group, [0.12, 0.28, 0.72], [-1.38, 1.42, -0.06], STATION_MATERIALS.window);
    addMast(group, [0.88, 1.12, 0.25], 1.18, false);
    group.rotation.y = 0.18;
  } else {
    addBox(group, [2.35, 0.92, 1.45], [0, 0.91, 0], STATION_MATERIALS.structure);
    addBox(group, [1.35, 0.7, 1.05], [1.45, 0.78, 0.08], STATION_MATERIALS.structure);
    addBox(group, [0.68, 0.36, 0.58], [0.83, 0.63, 0.04], STATION_MATERIALS.structureDark);
    addBox(group, [2.18, 0.14, 1.3], [0, 1.45, 0], STATION_MATERIALS.structureDark);
    addMast(group, [-0.82, 1.45, -0.38], 1.35, false);
  }

  return finishStationModel(group, reduced);
}

function stationTooltip(station) {
  const name = station?.name || 'Research station';
  const description = station?.description || '';
  const historical = isHistoricalStation(station);
  return `
    <div style="font-family:Inter,ui-sans-serif,sans-serif;padding:7px 9px;color:#f5faff;background:rgba(7,22,32,.94);border:1px solid rgba(232,198,136,.5);border-radius:7px;box-shadow:0 8px 24px rgba(0,0,0,.35);max-width:230px;">
      <div style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:${historical ? '#b9a277' : '#e8c688'};margin-bottom:3px;">${historical ? 'Historical research base' : 'Research station'}</div>
      <div style="font-weight:700;font-size:13px;">${name}</div>
      ${description ? `<div style="opacity:.76;font-size:11px;line-height:1.35;margin-top:4px;">${description}</div>` : ''}
    </div>
  `;
}

export default function GlobeView({ width, height, expeditions, selectedPin, onSelectPin, reduced }) {
  const globeRef = useRef();
  const [stations, setStations] = useState([]);

  useEffect(() => {
    let cancelled = false;

    fetchResearchStations()
      .then((data) => {
        if (!cancelled) setStations(Array.isArray(data) ? data : []);
      })
      .catch((error) => {
        console.warn('[NCPOR globe] research stations unavailable', error);
        if (!cancelled) setStations([]);
      });

    return () => { cancelled = true; };
  }, []);

  // `reduced` is intentionally in this dependency list even though it never
  // changes *which* stations exist. react-globe.gl/three-globe only calls
  // `objectThreeObject` again for a datum when it treats that datum as
  // "new" in its internal data-join — which it decides by object identity,
  // not by the `reduced` prop. Without this, flipping `reduced` (fast ->
  // medium network tier, same station data, same array the whole time)
  // left the *already-built* full-size Three.js meshes in the scene as-is:
  // depending on the exact three-globe version, that stale mesh could end
  // up positioned using the *new* objectAltitude/objectFacesSurface pass
  // without ever being rebuilt for it, which is what made the bases
  // appear to vanish at the medium tier instead of switching to their
  // smaller/simplified model. Giving every station object a fresh identity
  // whenever `reduced` flips forces a full rebuild of the objects layer,
  // so the models actually swap (and reappear) instead of going stale.
  const stationObjects = useMemo(() => (
    stations
      .map((station) => ({
        ...station,
        lat: Number(station.lat ?? station.latitude),
        lng: Number(station.lng ?? station.longitude),
        status: station.status || (isHistoricalStation(station) ? 'historical' : 'active'),
        __renderMode: reduced ? 'reduced' : 'full',
      }))
      .filter((station) => Number.isFinite(station.lat) && Number.isFinite(station.lng))
  ), [stations, reduced]);

  // Rotates to selectedPin whenever it changes, regardless of *why* it
  // changed — clicking a pin directly on the globe, or (new) picking an
  // expedition from the navbar's quick search while on this page. Both
  // paths just set the same selectedPin state in the parent; this is the
  // one place that reacts to it, instead of duplicating the rotation call
  // inside every possible place selectedPin could be set.
  useEffect(() => {
    if (!selectedPin || !globeRef.current) return;
    globeRef.current.controls().autoRotate = false;
    globeRef.current.pointOfView({ lat: selectedPin.lat, lng: selectedPin.lng, altitude: 1.5 }, 1000);
  }, [selectedPin]);

  return (
    <Globe
      ref={globeRef}
      width={width}
      height={height}
      globeImageUrl="//unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
      bumpImageUrl={reduced ? undefined : '//unpkg.com/three-globe/example/img/earth-topology.png'}
      backgroundColor="rgba(0,0,0,0)"
      showAtmosphere={!reduced}
      atmosphereColor="#5ec8ff"
      atmosphereAltitude={0.22}
      pointsData={expeditions}
      pointLat="lat"
      pointLng="lng"
      pointColor="hex"
      pointAltitude={0.1}
      pointRadius={(d) => (d.dangerLevel && d.dangerLevel !== 'low' ? 0.9 : 0.7)}
      pointLabel={(d) => `
        <div style="font-family: sans-serif; padding: 4px 2px; color: #fff;">
          <div style="font-weight:600;">${d.name}</div>
          ${d.dangerLevel && d.dangerLevel !== 'low' ? `<div style="color:#f87171;">⚠ ${d.dangerLevel.toUpperCase()}</div>` : ''}
        </div>
      `}
      pointsMerge={false}

      // Permanent research stations use a separate Three.js object layer so
      // they read as actual field bases instead of another expedition pin.
      // SLOW/OFFLINE never load this component; MEDIUM gets the reduced model.
      objectsData={stationObjects}
      objectLat="lat"
      objectLng="lng"
      objectAltitude={reduced ? 0.004 : 0.006}
      objectFacesSurface={true}
      objectLabel={stationTooltip}
      objectThreeObject={(station) => createStationBaseObject(station, reduced)}

      // Only three permanent bases are shown, so subtle names in full mode
      // improve discoverability without clutter. Reduced mode skips the text
      // geometry to keep the GPU/network-conscious path lightweight.
      labelsData={reduced ? [] : stationObjects}
      labelLat="lat"
      labelLng="lng"
      labelText="name"
      labelAltitude={0.046}
      labelSize={0.42}
      labelColor={(station) => isHistoricalStation(station) ? 'rgba(185,162,119,0.78)' : '#e8c688'}
      labelIncludeDot={false}
      labelResolution={2}
      labelsTransitionDuration={0}

      ringsData={selectedPin ? [selectedPin] : []}
      ringLat="lat"
      ringLng="lng"
      ringColor={() => t => `rgba(232, 198, 136, ${1 - t})`}
      ringMaxRadius={4}
      ringPropagationSpeed={2.4}
      ringRepeatPeriod={900}
      onGlobeReady={() => {
        if (!globeRef.current) return;
        const scene = globeRef.current.scene();
        scene.add(new THREE.AmbientLight(0xffffff, 1.2));
        const sun = new THREE.DirectionalLight(0xffffff, 1.4);
        sun.position.set(1, 1, 1);
        scene.add(sun);

        // Idle drift, like a globe left turning on a chart table — stops
        // feeling inert without demanding attention. Skipped on medium:
        // a continuously re-rendering scene is exactly the ongoing GPU/
        // battery cost that tier is meant to avoid.
        if (!reduced) {
          const controls = globeRef.current.controls();
          controls.autoRotate = true;
          controls.autoRotateSpeed = 0.35;
        }
      }}
      onPointClick={(point) => onSelectPin(point)}
    />
  );
}
