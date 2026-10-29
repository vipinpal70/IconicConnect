'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { Line as DreiLine } from '@react-three/drei';
import type { ToolMode, AnnotationItem, Vector3D } from '@/src/types/annotation';

interface OrbitControlsLike {
  enabled: boolean;
}

interface DrawingInteractionProps {
  activeTool: ToolMode;
  activeColor: string;
  strokeWidth: number;
  activeLayerId: string;
  onAddAnnotation: (annotation: AnnotationItem) => void;
  onRequestPinText: (point: Vector3D, normal?: Vector3D) => void;
  orbitControlsRef: React.RefObject<unknown>;
}

export function DrawingInteraction({
  activeTool,
  activeColor,
  strokeWidth,
  activeLayerId,
  onAddAnnotation,
  onRequestPinText,
  orbitControlsRef,
}: DrawingInteractionProps) {
  const { camera, raycaster, scene, gl } = useThree();

  // In-flight interactive states
  const [isBrushDrawing, setIsBrushDrawing] = useState(false);
  const [brushPoints, setBrushPoints] = useState<THREE.Vector3[]>([]);
  const brushPointsRef = useRef<THREE.Vector3[]>([]);
  const isBrushDrawingRef = useRef(false);
  const brushPreviewFrameRef = useRef<number | null>(null);
  const meshCacheRef = useRef<THREE.Mesh[]>([]);
  const [distanceStart, setDistanceStart] = useState<THREE.Vector3 | null>(null);
  const [distanceCurrent, setDistanceCurrent] = useState<THREE.Vector3 | null>(null);
  const [arrowTarget, setArrowTarget] = useState<THREE.Vector3 | null>(null);
  const [arrowCurrent, setArrowCurrent] = useState<THREE.Vector3 | null>(null);

  // Disable OrbitControls when drawing markup tools are active
  useEffect(() => {
    const controls = orbitControlsRef.current as OrbitControlsLike | null;
    if (controls) {
      controls.enabled = activeTool === 'orbit';
    }
  }, [activeTool, orbitControlsRef]);

  // Raycast helper to find intersection on dental mesh
  const getMeshIntersection = useCallback((e: PointerEvent): THREE.Intersection | null => {
    const rect = gl.domElement.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
      return null;
    }
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(new THREE.Vector2(x, y), camera);

    const cachedMeshes = meshCacheRef.current;
    if (cachedMeshes.length === 0 || cachedMeshes.some((mesh) => !mesh.parent)) {
      cachedMeshes.length = 0;
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh && mesh.userData.isDentalModel && mesh.geometry) cachedMeshes.push(mesh);
      });
    }

    const intersects = raycaster.intersectObjects(cachedMeshes.filter((mesh) => mesh.visible), false);
    return intersects[0] || null;
  }, [camera, gl, raycaster, scene]);

  useEffect(() => {
    const canvas = gl.domElement;
    const handlePointerDown = (e: PointerEvent) => {
      if (activeTool === 'orbit') return;

      const hit = getMeshIntersection(e);
      if (!hit) return;

      const pt = hit.point.clone();

      if (activeTool === 'brush') {
        e.preventDefault();
        canvas.setPointerCapture(e.pointerId);
        isBrushDrawingRef.current = true;
        brushPointsRef.current = [pt];
        setIsBrushDrawing(true);
        setBrushPoints([pt]);
      } else if (activeTool === 'distance') {
        if (!distanceStart) {
          setDistanceStart(pt);
          setDistanceCurrent(pt);
        } else {
          // Finish distance measurement
          const distMm = distanceStart.distanceTo(pt);
          if (distMm > 0.05) {
            onAddAnnotation({
              id: `dist-${Date.now()}`,
              layerId: activeLayerId,
              type: 'distance',
              color: activeColor,
              createdAt: new Date().toISOString(),
              startPoint: { x: distanceStart.x, y: distanceStart.y, z: distanceStart.z },
              endPoint: { x: pt.x, y: pt.y, z: pt.z },
              distanceMm: distMm,
            });
          }
          setDistanceStart(null);
          setDistanceCurrent(null);
        }
      } else if (activeTool === 'pin') {
        const normal = hit.face?.normal
          ? { x: hit.face.normal.x, y: hit.face.normal.y, z: hit.face.normal.z }
          : undefined;
        onRequestPinText({ x: pt.x, y: pt.y, z: pt.z }, normal);
      } else if (activeTool === 'arrow') {
        if (!arrowTarget) {
          setArrowTarget(pt);
          setArrowCurrent(pt);
        } else {
          onAddAnnotation({
            id: `arrow-${Date.now()}`,
            layerId: activeLayerId,
            type: 'arrow',
            color: activeColor,
            createdAt: new Date().toISOString(),
            startPoint: { x: pt.x, y: pt.y, z: pt.z }, // Origin tail
            endPoint: { x: arrowTarget.x, y: arrowTarget.y, z: arrowTarget.z }, // Arrow points to target
          });
          setArrowTarget(null);
          setArrowCurrent(null);
        }
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (activeTool === 'orbit') return;
      if (activeTool === 'brush' && !isBrushDrawingRef.current) return;

      const hit = getMeshIntersection(e);
      if (!hit) return;
      const pt = hit.point.clone();

      if (activeTool === 'brush' && isBrushDrawingRef.current) {
        const points = brushPointsRef.current;
        const last = points[points.length - 1];
        if (!last || last.distanceTo(pt) > 0.2) {
          points.push(pt);
          if (brushPreviewFrameRef.current === null) {
            brushPreviewFrameRef.current = requestAnimationFrame(() => {
              brushPreviewFrameRef.current = null;
              setBrushPoints([...brushPointsRef.current]);
            });
          }
        }
      } else if (activeTool === 'distance' && distanceStart) {
        setDistanceCurrent(pt);
      } else if (activeTool === 'arrow' && arrowTarget) {
        setArrowCurrent(pt);
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (activeTool === 'brush' && isBrushDrawingRef.current) {
        isBrushDrawingRef.current = false;
        if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
        if (brushPreviewFrameRef.current !== null) {
          cancelAnimationFrame(brushPreviewFrameRef.current);
          brushPreviewFrameRef.current = null;
        }
        const completedPoints = brushPointsRef.current;
        brushPointsRef.current = [];
        setIsBrushDrawing(false);
        if (completedPoints.length >= 2) {
          onAddAnnotation({
            id: `brush-${Date.now()}`,
            layerId: activeLayerId,
            type: 'brush',
            color: activeColor,
            lineWidth: strokeWidth,
            createdAt: new Date().toISOString(),
            points: completedPoints.map((p) => ({ x: p.x, y: p.y, z: p.z })),
          });
        }
        setBrushPoints([]);
      }
    };

    canvas.addEventListener('pointerdown', handlePointerDown, true);
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerup', handlePointerUp);
    canvas.addEventListener('pointercancel', handlePointerUp);

    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown, true);
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerup', handlePointerUp);
      canvas.removeEventListener('pointercancel', handlePointerUp);
      if (brushPreviewFrameRef.current !== null) cancelAnimationFrame(brushPreviewFrameRef.current);
    };
  }, [
    activeTool,
    gl,
    distanceStart,
    arrowTarget,
    activeColor,
    strokeWidth,
    activeLayerId,
    onAddAnnotation,
    onRequestPinText,
    getMeshIntersection,
  ]);

  const brushLinePoints = useMemo((): [number, number, number][] | null => {
    if (!isBrushDrawing || brushPoints.length < 2) return null;
    return brushPoints.map((p) => [p.x, p.y, p.z]);
  }, [isBrushDrawing, brushPoints]);

  const distanceLinePoints = useMemo((): [number, number, number][] | null => {
    if (!distanceStart || !distanceCurrent) return null;
    return [
      [distanceStart.x, distanceStart.y, distanceStart.z],
      [distanceCurrent.x, distanceCurrent.y, distanceCurrent.z],
    ];
  }, [distanceStart, distanceCurrent]);

  const arrowLinePoints = useMemo((): [number, number, number][] | null => {
    if (!arrowTarget || !arrowCurrent) return null;
    return [
      [arrowCurrent.x, arrowCurrent.y, arrowCurrent.z],
      [arrowTarget.x, arrowTarget.y, arrowTarget.z],
    ];
  }, [arrowTarget, arrowCurrent]);

  return (
    <group>
      {/* Active Brush Line Preview */}
      {brushLinePoints && (
        <DreiLine
          points={brushLinePoints}
          color={activeColor}
          lineWidth={strokeWidth}
        />
      )}

      {/* Active Distance Measurement Preview */}
      {distanceStart && distanceCurrent && distanceLinePoints && (
        <group>
          <DreiLine
            points={distanceLinePoints}
            color={activeColor}
            lineWidth={2}
          />
          <mesh position={distanceStart}>
            <sphereGeometry args={[0.3, 16, 16]} />
            <meshBasicMaterial color={activeColor} depthTest={false} />
          </mesh>
          <mesh position={distanceCurrent}>
            <sphereGeometry args={[0.3, 16, 16]} />
            <meshBasicMaterial color={activeColor} depthTest={false} />
          </mesh>
        </group>
      )}

      {/* Active Arrow Pointer Preview */}
      {arrowTarget && arrowCurrent && arrowLinePoints && (
        <group>
          <DreiLine
            points={arrowLinePoints}
            color={activeColor}
            lineWidth={2}
          />
          <mesh position={arrowTarget}>
            <sphereGeometry args={[0.3, 16, 16]} />
            <meshBasicMaterial color={activeColor} depthTest={false} />
          </mesh>
        </group>
      )}
    </group>
  );
}
