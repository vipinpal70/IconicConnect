'use client';

import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import * as THREE from 'three';
import { MeshBVH, type SerializedBVH } from 'three-mesh-bvh';
import { useThree } from '@react-three/fiber';
import { initBvhAcceleration } from './bvh-setup';
import { loadModel, type ModelHandle, type ModelState, type ViewerFileStatus } from './model-cache';
import type { LoadedMesh } from './model-pipeline';
import type { MeshCategory, ModelPurpose, ScanArchiveProgress } from './scan-archive';
import { inferUpAxis, type Axis3 } from './view-orientation';

initBvhAcceleration();

export interface ScanFileInfo {
  name: string;
  category: MeshCategory;
  color: string;
  vertices: number;
  triangles: number;
  byteSize: number;
  status: ViewerFileStatus;
  reason?: string;
  defaultVisible: boolean;
}

/** Where the camera should look: bounds of the visible model plus its "up" axis. */
export interface ModelFrame {
  /** Changes when a different model is loaded; the camera is re-framed only then. */
  key: string;
  center: { x: number; y: number; z: number };
  radius: number;
  up: Axis3;
}

export type MaterialMode = 'enamel' | 'clay' | 'normal';

interface ModelMeshProps {
  modelUrl?: string | null;
  /** Real file name, used to detect the format when the URL doesn't carry the extension. */
  fileName?: string;
  purpose?: ModelPurpose;
  wireframe?: boolean;
  opacity?: number;
  materialMode?: MaterialMode;
  onLoadError?: (error: string | null) => void;
  onLoadProgress?: (progress: ScanArchiveProgress | null) => void;
  /** Explicit visibility per file; files missing from the map use their default. */
  visibleScanFiles?: Record<string, boolean>;
  onScanFilesChange?: (files: ScanFileInfo[]) => void;
  onFrameChange?: (frame: ModelFrame | null) => void;
  /** True once every visible mesh can be drawn on (its raycast BVH is ready). */
  onSurfaceReadyChange?: (ready: boolean) => void;
}

const EMPTY_STATE: ModelState = { files: [], meshes: [], bvh: new Map(), lod: new Map(), transportLost: false };
const noopSubscribe = () => () => {};

/**
 * Procedural dental arch geometry fallback when no remote file is loaded.
 */
function createProceduralDentalArch(): THREE.BufferGeometry {
  const points: THREE.Vector3[] = [];
  const segments = 32;
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * Math.PI;
    points.push(new THREE.Vector3(Math.cos(t) * 24, Math.sin(t * 8) * 1.5, Math.sin(t) * 28 - 10));
  }
  const tubeGeometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 64, 4.5, 16, false);
  tubeGeometry.computeVertexNormals();
  tubeGeometry.center();
  tubeGeometry.computeBoundingBox();
  tubeGeometry.computeBoundingSphere();
  tubeGeometry.computeBoundsTree?.();
  return tubeGeometry;
}

/** Wrap worker-produced arrays in a BufferGeometry (O(1): normals and bounds came from the worker). */
function createMeshGeometry(mesh: LoadedMesh): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
  if (mesh.colors) {
    // DCM colors are 0–255 bytes; PLY colors are already 0–1 floats
    geometry.setAttribute('color', new THREE.BufferAttribute(mesh.colors, 3, mesh.colors instanceof Uint8Array));
  }
  geometry.setIndex(new THREE.BufferAttribute(mesh.index, 1));
  const [minX, minY, minZ, maxX, maxY, maxZ] = mesh.bbox;
  geometry.boundingBox = new THREE.Box3(new THREE.Vector3(minX, minY, minZ), new THREE.Vector3(maxX, maxY, maxZ));
  geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
  return geometry;
}

/** Same vertex buffers (uploaded to the GPU once), simplified triangle list. */
function createDisplayGeometry(full: THREE.BufferGeometry, index: Uint32Array): THREE.BufferGeometry {
  const display = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(full.attributes)) display.setAttribute(name, attribute);
  display.setIndex(new THREE.BufferAttribute(index, 1));
  display.boundingBox = full.boundingBox;
  display.boundingSphere = full.boundingSphere;
  return display;
}

function disposeGeometry(geometry: THREE.BufferGeometry): void {
  geometry.disposeBoundsTree?.();
  geometry.dispose();
}

function scanColor(name: string, category: MeshCategory, index: number): string {
  const lowerName = name.toLowerCase();
  if (/antagonist|opposing|opposite/.test(lowerName)) return '#d9b887';
  if (/articulator|bitescan/.test(lowerName)) return '#9db9b2';
  if (/preparation|preparation scan/.test(lowerName)) return '#d8d4c8';
  if (category === 'cad' || /cad|crown|bridge|restoration|waxup|coping|veneer|inlay|onlay|abutment/.test(lowerName)) return '#b88762';
  if (/gingiva|tissue/.test(lowerName)) return '#c7857e';
  if (/raw|prepreparation/.test(lowerName)) return '#a9afb8';
  return ['#d8d4c8', '#c8c8c0', '#e3d8c6', '#bbc7c5'][index % 4];
}

interface MaterialSettings {
  color: string;
  hasVertexColors: boolean;
  materialMode: MaterialMode;
  wireframe: boolean;
  opacity: number;
}

/** Update a material in place; program-affecting flags force a recompile only when they change. */
function configureMaterial(material: THREE.Material, settings: MaterialSettings): void {
  const { color, hasVertexColors, materialMode, wireframe, opacity } = settings;
  const transparent = opacity < 1;
  let needsUpdate = material.transparent !== transparent;
  material.transparent = transparent;
  material.opacity = opacity;
  (material as THREE.MeshStandardMaterial | THREE.MeshNormalMaterial).wireframe = wireframe;
  if (material instanceof THREE.MeshStandardMaterial) {
    const useVertexColors = materialMode !== 'clay' && hasVertexColors;
    needsUpdate ||= material.vertexColors !== useVertexColors;
    material.vertexColors = useVertexColors;
    material.color.set(materialMode === 'clay' ? '#e2d9cc' : hasVertexColors ? '#ffffff' : color);
    material.roughness = materialMode === 'clay' ? 0.7 : 0.48;
  }
  if (needsUpdate) material.needsUpdate = true;
}

/**
 * Attach the raycast BVH to a geometry. Returns false while it is still being built in the worker.
 * `bvh === null` means the worker failed, so it is built here instead.
 */
function attachBvh(geometry: THREE.BufferGeometry, bvh: SerializedBVH | null | undefined, buildLocally: boolean): boolean {
  if (geometry.boundsTree) return true;
  if (bvh) {
    geometry.boundsTree = MeshBVH.deserialize(bvh, geometry, { setIndex: false });
  } else if (bvh === null || buildLocally) {
    geometry.computeBoundsTree?.({ indirect: true });
  } else {
    return false;
  }
  return true;
}

/**
 * One material per mesh, updated in place. Recreating materials on every opacity/mode change made
 * three recompile shaders (a visible stall); only switching to/from the normal-map view needs a new one.
 */
function useScanMaterial({
  color,
  hasVertexColors,
  materialMode,
  wireframe,
  opacity,
}: MaterialSettings): THREE.Material {
  const invalidate = useThree((s) => s.invalidate);
  const isNormal = materialMode === 'normal';
  const material = useMemo<THREE.Material>(
    () => (isNormal ? new THREE.MeshNormalMaterial() : new THREE.MeshStandardMaterial({ metalness: 0 })),
    [isNormal],
  );
  useEffect(() => () => material.dispose(), [material]);

  useEffect(() => {
    configureMaterial(material, { color, hasVertexColors, materialMode, wireframe, opacity });
    invalidate();
  }, [material, color, hasVertexColors, materialMode, opacity, wireframe, invalidate]);

  return material;
}

function ScanMesh({
  surfaceKey,
  mesh,
  color,
  bvh,
  buildBvhLocally,
  lodIndex,
  visible,
  wireframe,
  opacity,
  materialMode,
  onSurfaceReady,
}: {
  surfaceKey: string;
  mesh: LoadedMesh;
  color: string;
  /** undefined = still being built in the worker; null = the worker failed to build it. */
  bvh: SerializedBVH | null | undefined;
  buildBvhLocally: boolean;
  lodIndex: Uint32Array | undefined;
  visible: boolean;
  wireframe: boolean;
  opacity: number;
  materialMode: MaterialMode;
  onSurfaceReady: (surfaceKey: string) => void;
}) {
  const full = useMemo(() => createMeshGeometry(mesh), [mesh]);
  useEffect(() => () => disposeGeometry(full), [full]);

  // Attach the raycast BVH when it arrives; drawing is enabled per mesh once this is done
  useEffect(() => {
    if (attachBvh(full, bvh, buildBvhLocally)) onSurfaceReady(surfaceKey);
  }, [bvh, buildBvhLocally, full, surfaceKey, onSurfaceReady]);

  const display = useMemo(() => (lodIndex ? createDisplayGeometry(full, lodIndex) : full), [full, lodIndex]);
  useEffect(() => () => {
    // Shared attributes belong to `full`; only the simplified index is freed here
    if (display !== full) display.dispose();
  }, [display, full]);

  // Drawing must land on the real surface, so a simplified mesh raycasts through the full geometry
  const userData = useMemo(
    () => ({ isDentalModel: true, raycastTarget: display === full ? null : new THREE.Mesh(full) }),
    [display, full],
  );

  const material = useScanMaterial({
    color,
    hasVertexColors: mesh.colors !== null,
    materialMode,
    wireframe,
    opacity,
  });

  return (
    <mesh name={mesh.name} userData={userData} geometry={display} material={material} visible={visible} />
  );
}

/** Camera framing for the visible meshes (raw model coordinates: nothing is re-centered). */
function computeFrame(
  loadKey: string | null,
  proceduralRadius: number | null,
  visibleMeshes: LoadedMesh[],
  up: Axis3,
): ModelFrame | null {
  if (proceduralRadius !== null) return { key: 'procedural', center: { x: 0, y: 0, z: 0 }, radius: proceduralRadius, up: [0, 1, 0] };
  if (!loadKey || visibleMeshes.length === 0) return null;
  const box = new THREE.Box3();
  const point = new THREE.Vector3();
  for (const mesh of visibleMeshes) {
    box.expandByPoint(point.set(mesh.bbox[0], mesh.bbox[1], mesh.bbox[2]));
    box.expandByPoint(point.set(mesh.bbox[3], mesh.bbox[4], mesh.bbox[5]));
  }
  const center = box.getCenter(new THREE.Vector3());
  return {
    key: loadKey,
    center: { x: center.x, y: center.y, z: center.z },
    radius: Math.max(box.getBoundingSphere(new THREE.Sphere()).radius, 1),
    up,
  };
}

function useModelHandle(loadKey: string | null, modelUrl: string | null | undefined, fileName: string, purpose: ModelPurpose, onLoadError?: (e: string | null) => void, onLoadProgress?: (p: ScanArchiveProgress | null) => void) {
  const [loaded, setLoaded] = useState<{ key: string; handle: ModelHandle } | null>(null);

  useEffect(() => {
    onLoadError?.(null);
    onLoadProgress?.(null);
    if (!modelUrl || !loadKey) return;

    let isMounted = true;
    const load = loadModel({ url: modelUrl, fileName, purpose });
    const unsubscribe = load.subscribe((progress) => {
      if (isMounted) onLoadProgress?.(progress);
    });
    load.promise
      .then((handle) => {
        if (isMounted) setLoaded({ key: loadKey, handle });
      })
      .catch((err: unknown) => {
        if (!isMounted) return;
        console.error('Error loading 3D model:', err);
        onLoadError?.(err instanceof Error ? err.message : 'Failed to load the 3D model.');
      });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [modelUrl, fileName, purpose, loadKey, onLoadError, onLoadProgress]);

  return loaded && loaded.key === loadKey ? loaded.handle : null;
}

export function ModelMesh({
  modelUrl,
  fileName = '',
  purpose = 'case-submission',
  wireframe = false,
  opacity = 1.0,
  materialMode = 'enamel',
  onLoadError,
  onLoadProgress,
  visibleScanFiles = {},
  onScanFilesChange,
  onFrameChange,
  onSurfaceReadyChange,
}: ModelMeshProps) {
  const loadKey = modelUrl ? `${purpose}|${modelUrl}` : null;
  const handle = useModelHandle(loadKey, modelUrl, fileName, purpose, onLoadError, onLoadProgress);
  const state = useSyncExternalStore(
    handle?.subscribe ?? noopSubscribe,
    handle?.getState ?? (() => EMPTY_STATE),
    () => EMPTY_STATE,
  );

  const isFileVisible = (file: string) =>
    visibleScanFiles[file] ?? state.files.find((f) => f.name === file)?.defaultVisible ?? true;

  // Colors and per-file stats for the Layers panel
  const fileColors = useMemo(
    () => new Map(state.files.map((f, i) => [f.name, scanColor(f.name, f.category, i)])),
    [state.files],
  );
  const scanFiles = useMemo<ScanFileInfo[]>(
    () =>
      state.files.map((file) => {
        const meshes = state.meshes.filter((m) => m.file === file.name);
        return {
          name: file.name,
          category: file.category,
          color: fileColors.get(file.name)!,
          vertices: meshes.reduce((n, m) => n + m.vertexCount, 0),
          triangles: meshes.reduce((n, m) => n + m.triangleCount, 0),
          byteSize: file.byteSize,
          status: file.status,
          reason: file.reason,
          defaultVisible: file.defaultVisible,
        };
      }),
    [fileColors, state.files, state.meshes],
  );
  useEffect(() => {
    onScanFilesChange?.(scanFiles);
  }, [onScanFilesChange, scanFiles]);

  // Hidden files are decoded the first time they are switched on
  useEffect(() => {
    if (!handle) return;
    for (const file of state.files) {
      if (file.status === 'deferred' && (visibleScanFiles[file.name] ?? file.defaultVisible)) handle.decode(file.name);
    }
  }, [handle, state.files, visibleScanFiles]);

  // Up axis from the default view (stable while files are toggled); bounds from what is visible now
  const upAxis = useMemo(() => {
    const defaults = new Set(state.files.filter((f) => f.defaultVisible).map((f) => f.name));
    return inferUpAxis(state.meshes.filter((m) => defaults.has(m.file)));
  }, [state.files, state.meshes]);

  const proceduralGeometry = useMemo(() => (modelUrl ? null : createProceduralDentalArch()), [modelUrl]);
  useEffect(() => () => proceduralGeometry?.dispose(), [proceduralGeometry]);

  const visibleMeshes = state.meshes.filter((m) => isFileVisible(m.file));
  // Serialized so the effect below only fires when the framing actually changes
  const frameSignature = JSON.stringify(
    computeFrame(loadKey, proceduralGeometry?.boundingSphere?.radius ?? null, visibleMeshes, upAxis),
  );
  useEffect(() => {
    onFrameChange?.(JSON.parse(frameSignature) as ModelFrame | null);
  }, [frameSignature, onFrameChange]);

  // Drawing readiness: every visible mesh has its BVH attached
  const [surfaceMeshes, setSurfaceMeshes] = useState<ReadonlySet<string>>(() => new Set());
  const handleSurfaceReady = useMemo(
    () => (name: string) => setSurfaceMeshes((current) => (current.has(name) ? current : new Set(current).add(name))),
    [],
  );
  // Keyed per model: the case submission and the design output often contain identically named scans
  const surfaceReady =
    proceduralGeometry !== null || visibleMeshes.every((m) => surfaceMeshes.has(`${loadKey}|${m.name}`));
  useEffect(() => {
    onSurfaceReadyChange?.(surfaceReady);
  }, [onSurfaceReadyChange, surfaceReady]);

  const proceduralMaterial = useScanMaterial({
    color: '#f8f6f0',
    hasVertexColors: false,
    materialMode,
    wireframe,
    opacity,
  });

  if (proceduralGeometry) {
    return (
      <mesh
        name="Dental model"
        userData={{ isDentalModel: true }}
        geometry={proceduralGeometry}
        material={proceduralMaterial}
      />
    );
  }

  return (
    <group>
      {state.meshes.map((mesh) => (
        <ScanMesh
          key={`${loadKey}|${mesh.name}`}
          surfaceKey={`${loadKey}|${mesh.name}`}
          mesh={mesh}
          color={fileColors.get(mesh.file) ?? '#d8d4c8'}
          bvh={state.bvh.get(mesh.name)}
          buildBvhLocally={state.transportLost}
          lodIndex={state.lod.get(mesh.name)?.index}
          visible={isFileVisible(mesh.file)}
          wireframe={wireframe}
          opacity={opacity}
          materialMode={materialMode}
          onSurfaceReady={handleSurfaceReady}
        />
      ))}
    </group>
  );
}
