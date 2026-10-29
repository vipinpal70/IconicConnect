'use client';

import React, { useEffect, useState, useMemo, useRef, forwardRef } from 'react';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import type { ThreeEvent } from '@react-three/fiber';
import { initBvhAcceleration } from './bvh-setup';
import {
  load3ShapeDcmFile,
  load3ShapeScanArchive,
  type ScanArchiveProgress,
  type ScanMeshFile,
} from './scan-archive';

initBvhAcceleration();

interface ModelMeshProps {
  modelUrl?: string | null;
  wireframe?: boolean;
  opacity?: number;
  materialMode?: 'enamel' | 'clay' | 'normal';
  onPointerDown?: (e: ThreeEvent<PointerEvent>) => void;
  onPointerMove?: (e: ThreeEvent<PointerEvent>) => void;
  onPointerUp?: (e: ThreeEvent<PointerEvent>) => void;
  onLoadError?: (error: string | null) => void;
  onLoadProgress?: (progress: ScanArchiveProgress | null) => void;
  visibleScanFiles?: Record<string, boolean>;
  onScanFilesChange?: (files: Array<{ name: string; color: string; vertices: number; triangles: number }>) => void;
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

function createScanGeometry(file: ScanMeshFile): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(file.mesh.vertices, 3));
  geometry.setIndex(new THREE.BufferAttribute(file.mesh.indices, 1));
  if (file.mesh.colors) {
    geometry.setAttribute('color', new THREE.BufferAttribute(file.mesh.colors, 3, true));
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  if (typeof geometry.computeBoundsTree === 'function') {
    geometry.computeBoundsTree();
  }
  return geometry;
}

function disposeGeometry(geometry: THREE.BufferGeometry): void {
  (geometry as THREE.BufferGeometry & { disposeBoundsTree?: () => void }).disposeBoundsTree?.();
  geometry.dispose();
}

function scanColor(name: string, index: number): string {
  const lowerName = name.toLowerCase();
  if (/antagonist|opposing|opposite/.test(lowerName)) return '#d9b887';
  if (/articulator|bitescan/.test(lowerName)) return '#9db9b2';
  if (/preparation|preparation scan/.test(lowerName)) return '#d8d4c8';
  if (/cad|crown|bridge|restoration|waxup/.test(lowerName)) return '#b88762';
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

export const ModelMesh = forwardRef<THREE.Mesh, ModelMeshProps>(function ModelMesh(
  {
    modelUrl,
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
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [geometryUrl, setGeometryUrl] = useState<string | null>(null);
  const [scanGeometries, setScanGeometries] = useState<
    Array<{ name: string; geometry: THREE.BufferGeometry; color: string; hasVertexColors: boolean }>
  >([]);
  const [scanGeometriesUrl, setScanGeometriesUrl] = useState<string | null>(null);
  const [scanCenter, setScanCenter] = useState<THREE.Vector3 | null>(null);
  const geometryRef = useRef<THREE.BufferGeometry | null>(null);
  const scanGeometriesRef = useRef<Array<{ geometry: THREE.BufferGeometry }>>([]);
  const proceduralGeometry = useMemo(() => createProceduralDentalArch(), []);
  const activeScanBounds = useMemo(() => {
    if (!scanCenter || scanGeometriesUrl !== modelUrl || scanGeometries.length === 0) return null;
    const bounds = new THREE.Box3();
    for (const item of scanGeometries) {
      if (visibleScanFiles[item.name] !== false && item.geometry.boundingBox) bounds.union(item.geometry.boundingBox);
    }
    if (bounds.isEmpty()) return null;
    const center = bounds.getCenter(new THREE.Vector3()).sub(scanCenter);
    return {
      center: { x: center.x, y: center.y, z: center.z },
      radius: Math.max(bounds.getBoundingSphere(new THREE.Sphere()).radius, 1),
    };
  }, [modelUrl, scanCenter, scanGeometries, scanGeometriesUrl, visibleScanFiles]);

  useEffect(() => () => proceduralGeometry.dispose(), [proceduralGeometry]);
  useEffect(() => {
    onModelBoundsChange?.(
      modelUrl
        ? geometryUrl === modelUrl && geometry?.boundingSphere
          ? {
              center: { x: 0, y: 0, z: 0 },
              radius: geometry.boundingSphere.radius,
            }
          : activeScanBounds
        : proceduralGeometry.boundingSphere
          ? {
              center: { x: 0, y: 0, z: 0 },
              radius: proceduralGeometry.boundingSphere.radius,
            }
          : null,
    );
  }, [activeScanBounds, geometry, geometryUrl, modelUrl, onModelBoundsChange, proceduralGeometry]);

  // Load geometry based on file extension
  useEffect(() => {
    if (!modelUrl) {
      onScanFilesChange?.([]);
      onLoadError?.(null);
      onLoadProgress?.(null);
      return;
    }

    onScanFilesChange?.([]);
    onModelBoundsChange?.(null);
    onLoadError?.(null);
    onLoadProgress?.(null);

    const cleanUrl = modelUrl.split('?')[0].toLowerCase();
    let isStl = cleanUrl.endsWith('.stl');
    let isPly = cleanUrl.endsWith('.ply');
    let isObj = cleanUrl.endsWith('.obj');
    let isDcm = cleanUrl.endsWith('.dcm');
    let isZip = cleanUrl.endsWith('.zip');

    // If query string has fileName parameter
    if (modelUrl.includes('fileName=')) {
      const match = modelUrl.match(/fileName=([^&]+)/i);
      if (match && match[1]) {
        const fn = decodeURIComponent(match[1]).toLowerCase();
        if (fn.endsWith('.stl')) isStl = true;
        if (fn.endsWith('.ply')) isPly = true;
        if (fn.endsWith('.obj')) isObj = true;
        if (fn.endsWith('.dcm')) isDcm = true;
        if (fn.endsWith('.zip')) isZip = true;
      }
    }

    let isMounted = true;
    const controller = new AbortController();

    if (isZip || isDcm) {
      onLoadProgress?.({ loadedBytes: 0, totalBytes: null });
      const loadMeshes = isZip
        ? load3ShapeScanArchive(modelUrl, controller.signal, onLoadProgress)
        : load3ShapeDcmFile(modelUrl, controller.signal);
      void loadMeshes
        .then((files) => {
          if (!isMounted) return;
          const nextGeometries = files.map((file, index) => ({
            name: file.name,
            geometry: createScanGeometry(file),
            color: scanColor(file.name, index),
            hasVertexColors: file.mesh.colors !== null,
          }));
          scanGeometriesRef.current = nextGeometries;
          const bounds = new THREE.Box3();
          for (const item of nextGeometries) {
            if (item.geometry.boundingBox) bounds.union(item.geometry.boundingBox);
          }
          const center = bounds.getCenter(new THREE.Vector3());
          setScanGeometries(nextGeometries);
          setScanGeometriesUrl(modelUrl);
          setScanCenter(center);
          onScanFilesChange?.(
            files.map((file, index) => ({
              name: file.name,
              color: nextGeometries[index].color,
              vertices: file.mesh.vertices.length / 3,
              triangles: file.mesh.indices.length / 3,
            })),
          );
          onLoadProgress?.(null);
        })
        .catch((err: unknown) => {
          if (!isMounted || controller.signal.aborted) return;
          const message = err instanceof Error ? err.message : 'Failed to load the 3Shape scan.';
          console.error('Error loading 3Shape scan:', err);
          onLoadError?.(message);
          onLoadProgress?.(null);
        });
    } else if (isStl) {
      const loader = new STLLoader();
      loader.load(
        modelUrl,
        (geom) => {
          if (!isMounted) return;
          geom.computeVertexNormals();
          geom.center();
          if (typeof geom.computeBoundsTree === 'function') {
            geom.computeBoundsTree();
          }
          geom.computeBoundingSphere();
          setGeometry(geom);
          geometryRef.current = geom;
          setGeometryUrl(modelUrl);
        },
        undefined,
        (err) => {
          if (!isMounted) return;
          console.error('Error loading STL:', err);
          const message = 'Failed to load STL model.';
          onLoadError?.(message);
        }
      );
    } else if (isPly) {
      const loader = new PLYLoader();
      loader.load(
        modelUrl,
        (geom) => {
          if (!isMounted) return;
          geom.computeVertexNormals();
          geom.center();
          if (typeof geom.computeBoundsTree === 'function') {
            geom.computeBoundsTree();
          }
          geom.computeBoundingSphere();
          setGeometry(geom);
          geometryRef.current = geom;
          setGeometryUrl(modelUrl);
        },
        undefined,
        (err) => {
          if (!isMounted) return;
          console.error('Error loading PLY:', err);
          const message = 'Failed to load PLY model.';
          onLoadError?.(message);
        }
      );
    } else if (isObj) {
      const loader = new OBJLoader();
      loader.load(
        modelUrl,
        (obj) => {
          if (!isMounted) return;
          let mergedGeom: THREE.BufferGeometry | null = null;
          obj.traverse((child) => {
            if ((child as THREE.Mesh).isMesh && !mergedGeom) {
              mergedGeom = (child as THREE.Mesh).geometry.clone();
            }
          });

          if (mergedGeom) {
            const mg: THREE.BufferGeometry = mergedGeom;
            mg.computeVertexNormals();
            mg.center();
            if (typeof mg.computeBoundsTree === 'function') {
              mg.computeBoundsTree();
            }
            mg.computeBoundingSphere();
            setGeometry(mg);
            geometryRef.current = mg;
            setGeometryUrl(modelUrl);
          } else {
            if (!isMounted) return;
            const message = 'The OBJ file does not contain a mesh.';
            onLoadError?.(message);
          }
        },
        undefined,
        (err) => {
          if (!isMounted) return;
          console.error('Error loading OBJ:', err);
          const message = 'Failed to load OBJ model.';
          onLoadError?.(message);
        }
      );
    } else {
      const message = 'This 3D file format is not supported by the viewer.';
      onLoadError?.(message);
    }

    return () => {
      isMounted = false;
      controller.abort();
      if (geometryRef.current) {
        disposeGeometry(geometryRef.current);
        geometryRef.current = null;
      }
      for (const item of scanGeometriesRef.current) {
        disposeGeometry(item.geometry);
      }
      scanGeometriesRef.current = [];
    };
  }, [modelUrl, onLoadError, onLoadProgress, onScanFilesChange, onModelBoundsChange]);

  // Dental Tooth Enamel Material
  const material = useMemo(() => {
    if (materialMode === 'normal') {
      return new THREE.MeshNormalMaterial({
        wireframe,
        transparent: opacity < 1.0,
        opacity,
      });
    }

    if (materialMode === 'clay') {
      return new THREE.MeshStandardMaterial({
        color: '#e2d9cc',
        roughness: 0.7,
        metalness: 0.05,
        wireframe,
        transparent: opacity < 1.0,
        opacity,
      });
    }

    // Default dental porcelain / enamel look
    return new THREE.MeshStandardMaterial({
      color: '#f8f6f0',
      roughness: 0.25,
      metalness: 0.1,
      wireframe,
      transparent: opacity < 1.0,
      opacity,
    });
  }, [materialMode, wireframe, opacity]);
  useEffect(() => () => material.dispose(), [material]);

  const activeGeometry = modelUrl ? (geometryUrl === modelUrl ? geometry : null) : proceduralGeometry;
  const activeScanGeometries = scanGeometriesUrl === modelUrl ? scanGeometries : [];
  const activeScanCenter = scanGeometriesUrl === modelUrl ? scanCenter : null;

  return (
    <group position={activeScanCenter ? [-activeScanCenter.x, -activeScanCenter.y, -activeScanCenter.z] : undefined}>
      {activeGeometry && (
        <mesh
          ref={ref}
          name="Dental model"
          userData={{ isDentalModel: true }}
          geometry={activeGeometry}
          material={material}
          castShadow
          receiveShadow
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
      )}
      {activeScanGeometries.map((item) => (
        <ScanMesh
          key={item.name}
          meshRef={item === activeScanGeometries[0] ? ref : undefined}
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
