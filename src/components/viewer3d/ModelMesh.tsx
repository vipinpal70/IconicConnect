'use client';

import React, { useEffect, useState, useMemo, forwardRef } from 'react';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { initBvhAcceleration } from './bvh-setup';

initBvhAcceleration();

interface ModelMeshProps {
  modelUrl?: string | null;
  wireframe?: boolean;
  opacity?: number;
  materialMode?: 'enamel' | 'clay' | 'normal';
  onPointerDown?: (e: any) => void;
  onPointerMove?: (e: any) => void;
  onPointerUp?: (e: any) => void;
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
  if (typeof (tubeGeometry as any).computeBoundsTree === 'function') {
    (tubeGeometry as any).computeBoundsTree();
  }

  return tubeGeometry;
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
  },
  ref
) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Load geometry based on file extension
  useEffect(() => {
    if (!modelUrl) {
      setGeometry(createProceduralDentalArch());
      return;
    }

    setIsLoading(true);
    setLoadError(null);

    const cleanUrl = modelUrl.split('?')[0].toLowerCase();
    let isStl = cleanUrl.endsWith('.stl');
    let isPly = cleanUrl.endsWith('.ply');
    let isObj = cleanUrl.endsWith('.obj');

    // If query string has fileName parameter
    if (modelUrl.includes('fileName=')) {
      const match = modelUrl.match(/fileName=([^&]+)/i);
      if (match && match[1]) {
        const fn = decodeURIComponent(match[1]).toLowerCase();
        if (fn.endsWith('.stl')) isStl = true;
        if (fn.endsWith('.ply')) isPly = true;
        if (fn.endsWith('.obj')) isObj = true;
      }
    }

    let isMounted = true;

    if (isStl) {
      const loader = new STLLoader();
      loader.load(
        modelUrl,
        (geom) => {
          if (!isMounted) return;
          geom.computeVertexNormals();
          geom.center();
          if (typeof (geom as any).computeBoundsTree === 'function') {
            (geom as any).computeBoundsTree();
          }
          setGeometry(geom);
          setIsLoading(false);
        },
        undefined,
        (err) => {
          if (!isMounted) return;
          console.error('Error loading STL:', err);
          setLoadError('Failed to load STL model. Falling back to dental preview.');
          setGeometry(createProceduralDentalArch());
          setIsLoading(false);
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
          if (typeof (geom as any).computeBoundsTree === 'function') {
            (geom as any).computeBoundsTree();
          }
          setGeometry(geom);
          setIsLoading(false);
        },
        undefined,
        (err) => {
          if (!isMounted) return;
          console.error('Error loading PLY:', err);
          setLoadError('Failed to load PLY model. Falling back to dental preview.');
          setGeometry(createProceduralDentalArch());
          setIsLoading(false);
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
            (mergedGeom as THREE.BufferGeometry).computeVertexNormals();
            (mergedGeom as THREE.BufferGeometry).center();
            if (typeof (mergedGeom as any).computeBoundsTree === 'function') {
              (mergedGeom as any).computeBoundsTree();
            }
            setGeometry(mergedGeom);
          } else {
            setGeometry(createProceduralDentalArch());
          }
          setIsLoading(false);
        },
        undefined,
        (err) => {
          if (!isMounted) return;
          console.error('Error loading OBJ:', err);
          setLoadError('Failed to load OBJ model.');
          setGeometry(createProceduralDentalArch());
          setIsLoading(false);
        }
      );
    } else {
      // Default / unsupported format preview
      setGeometry(createProceduralDentalArch());
      setIsLoading(false);
    }

    return () => {
      isMounted = false;
    };
  }, [modelUrl]);

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

  if (!geometry) return null;

  return (
    <group>
      <mesh
        ref={ref}
        geometry={geometry}
        material={material}
        castShadow
        receiveShadow
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
      {loadError && (
        <mesh position={[0, 15, 0]}>
          {/* subtle feedback indication */}
        </mesh>
      )}
    </group>
  );
});
