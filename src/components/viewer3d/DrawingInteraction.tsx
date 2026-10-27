'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
  const { camera, raycaster, scene } = useThree();

  // In-flight interactive states
  const [isBrushDrawing, setIsBrushDrawing] = useState(false);
  const [brushPoints, setBrushPoints] = useState<THREE.Vector3[]>([]);
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
  const getMeshIntersection = useCallback((e: MouseEvent): THREE.Intersection | null => {
    const canvas = e.target as HTMLCanvasElement;
    if (!canvas || !canvas.getBoundingClientRect) return null;

    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(new THREE.Vector2(x, y), camera);

    // Filter for mesh objects in scene
    const meshes: THREE.Mesh[] = [];
    scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh && obj.visible && (obj as THREE.Mesh).geometry) {
        meshes.push(obj as THREE.Mesh);
      }
    });

    const intersects = raycaster.intersectObjects(meshes, false);
    return intersects[0] || null;
  }, [camera, raycaster, scene]);

  useEffect(() => {
    const handlePointerDown = (e: MouseEvent) => {
      if (activeTool === 'orbit') return;

      const hit = getMeshIntersection(e);
      if (!hit) return;

      const pt = hit.point.clone();

      if (activeTool === 'brush') {
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

    const handlePointerMove = (e: MouseEvent) => {
      if (activeTool === 'orbit') return;

      const hit = getMeshIntersection(e);
      if (!hit) return;
      const pt = hit.point.clone();

      if (activeTool === 'brush' && isBrushDrawing) {
        setBrushPoints((prev) => {
          const last = prev[prev.length - 1];
          // Sample point only if moved at least 0.3mm from previous point
          if (!last || last.distanceTo(pt) > 0.3) {
            return [...prev, pt];
          }
          return prev;
        });
      } else if (activeTool === 'distance' && distanceStart) {
        setDistanceCurrent(pt);
      } else if (activeTool === 'arrow' && arrowTarget) {
        setArrowCurrent(pt);
      }
    };

    const handlePointerUp = () => {
      if (activeTool === 'brush' && isBrushDrawing) {
        setIsBrushDrawing(false);
        if (brushPoints.length >= 2) {
          onAddAnnotation({
            id: `brush-${Date.now()}`,
            layerId: activeLayerId,
            type: 'brush',
            color: activeColor,
            lineWidth: strokeWidth,
            createdAt: new Date().toISOString(),
            points: brushPoints.map((p) => ({ x: p.x, y: p.y, z: p.z })),
          });
        }
        setBrushPoints([]);
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('mouseup', handlePointerUp);

    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('mouseup', handlePointerUp);
    };
  }, [
    activeTool,
    isBrushDrawing,
    brushPoints,
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
