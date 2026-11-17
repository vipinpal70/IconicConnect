'use client';

import React, { useEffect, useState, useMemo, forwardRef } from 'react';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { ThreeEvent } from '@react-three/fiber';
import { initBvhAcceleration } from './bvh-setup';
import { loadModel } from './model-cache';
import type { LoadedMesh } from './model-pipeline';
import type { MeshCategory, ModelPurpose, ScanArchiveProgress } from './scan-archive';

initBvhAcceleration();

export interface ScanFileInfo {
  name: string;
  category: MeshCategory;
  color: string;
  vertices: number;
  triangles: number;
}

interface ModelMeshProps {
  modelUrl?: string | null;
  /** Real file name, used to detect the format when the URL doesn't carry the extension. */
  fileName?: string;
  purpose?: ModelPurpose;
  wireframe?: boolean;
  opacity?: number;
  materialMode?: 'enamel' | 'clay' | 'normal';
  onPointerDown?: (e: ThreeEvent<PointerEvent>) => void;
  onPointerMove?: (e: ThreeEvent<PointerEvent>) => void;
  onPointerUp?: (e: ThreeEvent<PointerEvent>) => void;
  onLoadError?: (error: string | null) => void;
  onLoadProgress?: (progress: ScanArchiveProgress | null) => void;
  visibleScanFiles?: Record<string, boolean>;
  onScanFilesChange?: (files: ScanFileInfo[]) => void;
  onModelBoundsChange?: (bounds: { center: { x: number; y: number; z: number }; radius: number } | null) => void;
}

/**
 * Procedural dental arch geometry fallback when no remote file is loaded.
 * Creates an anatomical curved dental model with individual tooth mounds.
 */
function createProceduralDentalArch(): THREE.BufferGeometry {
  const points: THREE.Vector3[] = [];
  const archRadiusX = 24;
  const archRadiusZ = 28;
  const segments = 32;

  // Parabolic arch curve
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * Math.PI; // 0 to PI
    const x = Math.cos(t) * archRadiusX;
    const z = Math.sin(t) * archRadiusZ - 10;
    const y = Math.sin(t * 8) * 1.5; // tooth contour
    points.push(new THREE.Vector3(x, y, z));
  }

  const curve = new THREE.CatmullRomCurve3(points);
  const tubeGeometry = new THREE.TubeGeometry(curve, 64, 4.5, 16, false);

  tubeGeometry.computeVertexNormals();
  tubeGeometry.center();
  tubeGeometry.computeBoundingSphere();
  if (typeof tubeGeometry.computeBoundsTree === 'function') {
    tubeGeometry.computeBoundsTree();
  }

  return tubeGeometry;
}

/**
 * Wrap worker-produced arrays in a BufferGeometry. Normals, bounds and the BVH were all computed
 * in the worker, so this is O(1) work on the main thread.
 */
function createMeshGeometry(mesh: LoadedMesh): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
  if (mesh.colors) {
    // DCM colors are 0–255 bytes; PLY colors are already 0–1 floats
    geometry.setAttribute('color', new THREE.BufferAttribute(mesh.colors, 3, mesh.colors instanceof Uint8Array));
  }
  if (mesh.index) geometry.setIndex(new THREE.BufferAttribute(mesh.index, 1));
  const [minX, minY, minZ, maxX, maxY, maxZ] = mesh.bbox;
  geometry.boundingBox = new THREE.Box3(new THREE.Vector3(minX, minY, minZ), new THREE.Vector3(maxX, maxY, maxZ));
  geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
  if (mesh.bvh) {
    geometry.boundsTree = MeshBVH.deserialize(mesh.bvh, geometry, { setIndex: true });
  } else if (typeof geometry.computeBoundsTree === 'function') {
    geometry.computeBoundsTree();
  }
  return geometry;
}

function disposeGeometry(geometry: THREE.BufferGeometry): void {
  (geometry as THREE.BufferGeometry & { disposeBoundsTree?: () => void }).disposeBoundsTree?.();
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

function ScanMesh({
  name,
  geometry,
  color,
  hasVertexColors,
  visible,
  wireframe,
  opacity,
  materialMode,
  meshRef,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  name: string;
  geometry: THREE.BufferGeometry;
  color: string;
  hasVertexColors: boolean;
  visible: boolean;
  wireframe: boolean;
  opacity: number;
  materialMode: 'enamel' | 'clay' | 'normal';
  meshRef?: React.Ref<THREE.Mesh>;
  onPointerDown?: (e: ThreeEvent<PointerEvent>) => void;
  onPointerMove?: (e: ThreeEvent<PointerEvent>) => void;
  onPointerUp?: (e: ThreeEvent<PointerEvent>) => void;
}) {
  const material = useMemo(() => {
    if (materialMode === 'normal') {
      return new THREE.MeshNormalMaterial({ wireframe, transparent: opacity < 1, opacity });
    }
    return new THREE.MeshStandardMaterial({
      color: materialMode === 'clay' ? '#e2d9cc' : hasVertexColors ? '#ffffff' : color,
      vertexColors: materialMode !== 'clay' && hasVertexColors,
      roughness: materialMode === 'clay' ? 0.7 : 0.48,
      metalness: 0,
      wireframe,
      transparent: opacity < 1,
      opacity,
    });
  }, [color, hasVertexColors, materialMode, opacity, wireframe]);

  useEffect(() => () => material.dispose(), [material]);

  return (
    <mesh
      ref={meshRef}
      name={name}
      userData={{ isDentalModel: true }}
      geometry={geometry}
      material={material}
      visible={visible}
      castShadow
      receiveShadow
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  );
}

interface SceneMesh {
  name: string;
  geometry: THREE.BufferGeometry;
  color: string;
  hasVertexColors: boolean;
}

export const ModelMesh = forwardRef<THREE.Mesh, ModelMeshProps>(function ModelMesh(
  {
    modelUrl,
    fileName = '',
    purpose = 'case-submission',
    wireframe = false,
    opacity = 1.0,
    materialMode = 'enamel',
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onLoadError,
    onLoadProgress,
    visibleScanFiles = {},
    onScanFilesChange,
    onModelBoundsChange,
  },
  ref
) {
  const loadKey = modelUrl ? `${purpose}|${modelUrl}` : null;
  const [loaded, setLoaded] = useState<{ key: string; meshes: SceneMesh[]; center: THREE.Vector3 } | null>(null);
  const proceduralGeometry = useMemo(() => createProceduralDentalArch(), []);
  useEffect(() => () => proceduralGeometry.dispose(), [proceduralGeometry]);

  const active = loaded && loaded.key === loadKey ? loaded : null;

  const activeBounds = useMemo(() => {
    if (!active) return null;
    const bounds = new THREE.Box3();
    for (const item of active.meshes) {
      if (visibleScanFiles[item.name] !== false && item.geometry.boundingBox) bounds.union(item.geometry.boundingBox);
    }
    if (bounds.isEmpty()) return null;
    const center = bounds.getCenter(new THREE.Vector3()).sub(active.center);
    return {
      center: { x: center.x, y: center.y, z: center.z },
      radius: Math.max(bounds.getBoundingSphere(new THREE.Sphere()).radius, 1),
    };
  }, [active, visibleScanFiles]);

  useEffect(() => {
    onModelBoundsChange?.(
      modelUrl
        ? activeBounds
        : proceduralGeometry.boundingSphere
          ? { center: { x: 0, y: 0, z: 0 }, radius: proceduralGeometry.boundingSphere.radius }
          : null,
    );
  }, [activeBounds, modelUrl, onModelBoundsChange, proceduralGeometry]);

  // Load through the shared worker-backed cache (instant when already loaded or prefetched)
  useEffect(() => {
    onScanFilesChange?.([]);
    onLoadError?.(null);
    onLoadProgress?.(null);
    if (!modelUrl || !loadKey) return;

    let isMounted = true;
    let created: SceneMesh[] = [];
    const load = loadModel({ url: modelUrl, fileName, purpose });
    const unsubscribe = load.subscribe((progress) => {
      if (isMounted) onLoadProgress?.(progress);
    });

    load.promise
      .then((model) => {
        if (!isMounted) return;
        created = model.meshes.map((mesh, index) => ({
          name: mesh.name,
          geometry: createMeshGeometry(mesh),
          color: scanColor(mesh.name, mesh.category, index),
          hasVertexColors: mesh.colors !== null,
        }));
        const bounds = new THREE.Box3();
        for (const item of created) if (item.geometry.boundingBox) bounds.union(item.geometry.boundingBox);
        setLoaded({ key: loadKey, meshes: created, center: bounds.getCenter(new THREE.Vector3()) });
        onScanFilesChange?.(
          model.meshes.map((mesh, index) => ({
            name: mesh.name,
            category: mesh.category,
            color: created[index].color,
            vertices: mesh.vertexCount,
            triangles: mesh.triangleCount,
          })),
        );
      })
      .catch((err: unknown) => {
        if (!isMounted) return;
        console.error('Error loading 3D model:', err);
        onLoadError?.(err instanceof Error ? err.message : 'Failed to load the 3D model.');
      });

    return () => {
      isMounted = false;
      unsubscribe();
      // GPU buffers only; the typed arrays stay in the session cache for instant reopen
      for (const item of created) disposeGeometry(item.geometry);
    };
  }, [modelUrl, fileName, purpose, loadKey, onLoadError, onLoadProgress, onScanFilesChange]);

  // Procedural placeholder material (no model URL)
  const material = useMemo(() => {
    if (materialMode === 'normal') {
      return new THREE.MeshNormalMaterial({ wireframe, transparent: opacity < 1.0, opacity });
    }
    return new THREE.MeshStandardMaterial({
      color: materialMode === 'clay' ? '#e2d9cc' : '#f8f6f0',
      roughness: materialMode === 'clay' ? 0.7 : 0.25,
      metalness: materialMode === 'clay' ? 0.05 : 0.1,
      wireframe,
      transparent: opacity < 1.0,
      opacity,
    });
  }, [materialMode, wireframe, opacity]);
  useEffect(() => () => material.dispose(), [material]);

  if (!modelUrl) {
    return (
      <mesh
        ref={ref}
        name="Dental model"
        userData={{ isDentalModel: true }}
        geometry={proceduralGeometry}
        material={material}
        castShadow
        receiveShadow
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
    );
  }

  if (!active) return null;

  return (
    <group position={[-active.center.x, -active.center.y, -active.center.z]}>
      {active.meshes.map((item, index) => (
        <ScanMesh
          key={item.name}
          meshRef={index === 0 ? ref : undefined}
          name={item.name}
          geometry={item.geometry}
          color={item.color}
          hasVertexColors={item.hasVertexColors}
          visible={visibleScanFiles[item.name] !== false}
          wireframe={wireframe}
          opacity={opacity}
          materialMode={materialMode}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
      ))}
    </group>
  );
});
