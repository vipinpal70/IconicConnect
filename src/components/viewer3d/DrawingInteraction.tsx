'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { Html, Line as DreiLine } from '@react-three/drei';
import type { ToolMode, AnnotationItem, Vector3D } from '@/src/types/annotation';
import {
  MIN_SAMPLE_SPACING_MM,
  SURFACE_OFFSET_MM,
  angleAtVertex,
  pathLength,
  smoothStroke,
} from './stroke-smoothing';
import {
  HIGHLIGHTER_OPACITY,
  HIGHLIGHTER_WIDTH_SCALE,
  OVERLAY_MATERIAL_PROPS,
  RESERVED_STENCIL_REF,
  highlighterStencilProps,
} from './markup-materials';

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

type Tuple3 = [number, number, number];

interface PolylineDraft {
  vertices: THREE.Vector3[];
  segments: THREE.Vector3[][]; // segments[i] = surface path from vertex i to vertex i + 1
}

/** Clicking within this many pixels of the first polyline vertex closes the outline. */
const CLOSE_SNAP_PX = 12;
/** Spacing of the surface samples between two placed polyline vertices. */
const TRACE_SPACING_MM = 0.2;

const toTuple = (p: THREE.Vector3): Tuple3 => [p.x, p.y, p.z];
const toVector3D = (p: THREE.Vector3): Vector3D => ({
  x: Math.round(p.x * 1000) / 1000,
  y: Math.round(p.y * 1000) / 1000,
  z: Math.round(p.z * 1000) / 1000,
});

function flattenPolyline(draft: PolylineDraft): THREE.Vector3[] {
  const path = [draft.vertices[0]];
  for (const segment of draft.segments) path.push(...segment);
  return path;
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
  const { camera, scene, gl } = useThree();

  // Dedicated raycaster: firstHitOnly lets three-mesh-bvh stop at the nearest triangle,
  // which keeps per-event picking cheap enough to sample every coalesced pointer event.
  const raycaster = useMemo(() => {
    const r = new THREE.Raycaster() as THREE.Raycaster & { firstHitOnly?: boolean };
    r.firstHitOnly = true;
    return r;
  }, []);
  const ndcRef = useRef(new THREE.Vector2());

  const isFreehandTool = activeTool === 'brush' || activeTool === 'highlighter';
  const freehandWidth = activeTool === 'highlighter' ? strokeWidth * HIGHLIGHTER_WIDTH_SCALE : strokeWidth;

  // In-flight interactive states
  const [brushPoints, setBrushPoints] = useState<THREE.Vector3[]>([]);
  const brushPointsRef = useRef<THREE.Vector3[]>([]);
  const isBrushDrawingRef = useRef(false);
  const brushPreviewFrameRef = useRef<number | null>(null);
  const meshCacheRef = useRef<THREE.Mesh[]>([]);
  const [distanceStart, setDistanceStart] = useState<THREE.Vector3 | null>(null);
  const [distanceCurrent, setDistanceCurrent] = useState<THREE.Vector3 | null>(null);
  const [arrowTarget, setArrowTarget] = useState<THREE.Vector3 | null>(null);
  const [arrowCurrent, setArrowCurrent] = useState<THREE.Vector3 | null>(null);
  const [polyline, setPolyline] = useState<PolylineDraft | null>(null);
  const [anglePoints, setAnglePoints] = useState<THREE.Vector3[]>([]);
  const [hoverPoint, setHoverPoint] = useState<THREE.Vector3 | null>(null);

  // Disable OrbitControls when drawing markup tools are active
  useEffect(() => {
    const controls = orbitControlsRef.current as OrbitControlsLike | null;
    if (controls) {
      controls.enabled = activeTool === 'orbit';
    }
  }, [activeTool, orbitControlsRef]);

  const getDentalMeshes = useCallback((): THREE.Mesh[] => {
    const cachedMeshes = meshCacheRef.current;
    if (cachedMeshes.length === 0 || cachedMeshes.some((mesh) => !mesh.parent)) {
      cachedMeshes.length = 0;
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh && mesh.userData.isDentalModel && mesh.geometry) cachedMeshes.push(mesh);
      });
    }
    return cachedMeshes.filter((mesh) => mesh.visible);
  }, [scene]);

  const raycastNdc = useCallback((ndc: THREE.Vector2): THREE.Intersection | null => {
    raycaster.setFromCamera(ndc, camera);
    return raycaster.intersectObjects(getDentalMeshes(), false)[0] || null;
  }, [camera, getDentalMeshes, raycaster]);

  // Raycast helper to find intersection on dental mesh
  const getMeshIntersection = useCallback((e: PointerEvent): THREE.Intersection | null => {
    const rect = gl.domElement.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
      return null;
    }
    ndcRef.current.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    return raycastNdc(ndcRef.current);
  }, [gl, raycastNdc]);

  // Hit point lifted along the surface normal so the stroke sits on top of the scan
  const getSurfacePoint = useCallback((hit: THREE.Intersection): THREE.Vector3 => {
    const pt = hit.point.clone();
    if (hit.face) {
      const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      pt.addScaledVector(normal, SURFACE_OFFSET_MM);
    }
    return pt;
  }, []);

  // Surface-following path between two placed points: sample the straight segment,
  // then re-project each sample onto the visible scan surface from the current view.
  const traceSurface = useCallback((from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] => {
    const steps = Math.min(400, Math.max(1, Math.ceil(from.distanceTo(to) / TRACE_SPACING_MM)));
    const out: THREE.Vector3[] = [];
    const sample = new THREE.Vector3();
    const ndc = new THREE.Vector2();
    for (let i = 1; i <= steps; i++) {
      sample.lerpVectors(from, to, i / steps);
      if (i === steps) {
        out.push(to.clone());
        break;
      }
      const projected = sample.clone().project(camera);
      ndc.set(projected.x, projected.y);
      const hit = raycastNdc(ndc);
      out.push(hit ? getSurfacePoint(hit) : sample.clone());
    }
    return out;
  }, [camera, getSurfacePoint, raycastNdc]);

  const screenDistancePx = useCallback((a: THREE.Vector3, e: PointerEvent): number => {
    const rect = gl.domElement.getBoundingClientRect();
    const p = a.clone().project(camera);
    const x = ((p.x + 1) / 2) * rect.width + rect.left;
    const y = ((1 - p.y) / 2) * rect.height + rect.top;
    return Math.hypot(x - e.clientX, y - e.clientY);
  }, [camera, gl]);

  const commitPolyline = useCallback((draft: PolylineDraft | null, closed: boolean) => {
    if (!draft || draft.vertices.length < 2) return;
    const finalDraft = closed
      ? { ...draft, segments: [...draft.segments, traceSurface(draft.vertices[draft.vertices.length - 1], draft.vertices[0])] }
      : draft;
    const path = flattenPolyline(finalDraft);
    onAddAnnotation({
      id: `poly-${Date.now()}`,
      layerId: activeLayerId,
      type: 'polyline',
      color: activeColor,
      lineWidth: strokeWidth,
      createdAt: new Date().toISOString(),
      points: path.map(toVector3D),
      vertices: draft.vertices.map(toVector3D),
      closed,
      lengthMm: pathLength(path),
    });
    setPolyline(null);
  }, [activeColor, activeLayerId, onAddAnnotation, strokeWidth, traceSurface]);

  const resetInFlightRefs = useCallback(() => {
    isBrushDrawingRef.current = false;
    brushPointsRef.current = [];
    if (brushPreviewFrameRef.current !== null) {
      cancelAnimationFrame(brushPreviewFrameRef.current);
      brushPreviewFrameRef.current = null;
    }
  }, []);

  const resetInFlightState = useCallback(() => {
    setBrushPoints([]);
    setDistanceStart(null);
    setDistanceCurrent(null);
    setArrowTarget(null);
    setArrowCurrent(null);
    setPolyline(null);
    setAnglePoints([]);
    setHoverPoint(null);
  }, []);

  // Switching tools or pressing Escape abandons any half-finished markup
  const [previousTool, setPreviousTool] = useState(activeTool);
  if (previousTool !== activeTool) {
    setPreviousTool(activeTool);
    resetInFlightState();
  }
  useEffect(() => {
    resetInFlightRefs();
  }, [activeTool, resetInFlightRefs]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;

      if (e.key === 'Escape') {
        resetInFlightRefs();
        resetInFlightState();
      } else if (e.key === 'Enter' && polyline) {
        e.preventDefault();
        commitPolyline(polyline, false);
      } else if (e.key === 'Backspace' && polyline) {
        e.preventDefault();
        setPolyline(
          polyline.vertices.length <= 1
            ? null
            : { vertices: polyline.vertices.slice(0, -1), segments: polyline.segments.slice(0, -1) },
        );
      } else if (e.key === 'Backspace' && anglePoints.length > 0) {
        e.preventDefault();
        setAnglePoints(anglePoints.slice(0, -1));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [anglePoints, commitPolyline, polyline, resetInFlightRefs, resetInFlightState]);

  useEffect(() => {
    const canvas = gl.domElement;

    const scheduleBrushPreview = () => {
      if (brushPreviewFrameRef.current !== null) return;
      brushPreviewFrameRef.current = requestAnimationFrame(() => {
        brushPreviewFrameRef.current = null;
        setBrushPoints([...brushPointsRef.current]);
      });
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (activeTool === 'orbit' || activeTool === 'eraser' || e.button !== 0) return;

      const hit = getMeshIntersection(e);
      if (!hit) return;

      const pt = hit.point.clone();

      if (activeTool === 'brush' || activeTool === 'highlighter') {
        e.preventDefault();
        canvas.setPointerCapture(e.pointerId);
        isBrushDrawingRef.current = true;
        brushPointsRef.current = [getSurfacePoint(hit)];
        setBrushPoints([...brushPointsRef.current]);
      } else if (activeTool === 'polyline') {
        const surfacePt = getSurfacePoint(hit);
        if (!polyline) {
          setPolyline({ vertices: [surfacePt], segments: [] });
          return;
        }
        if (polyline.vertices.length >= 3 && screenDistancePx(polyline.vertices[0], e) < CLOSE_SNAP_PX) {
          commitPolyline(polyline, true);
          return;
        }
        const last = polyline.vertices[polyline.vertices.length - 1];
        // The second click of a double-click lands on the same spot; don't add a zero-length segment
        if (last.distanceTo(surfacePt) < 0.05) return;
        setPolyline({
          vertices: [...polyline.vertices, surfacePt],
          segments: [...polyline.segments, traceSurface(last, surfacePt)],
        });
      } else if (activeTool === 'angle') {
        const next = [...anglePoints, pt];
        if (next.length < 3) {
          setAnglePoints(next);
          return;
        }
        const [start, vertex, end] = next;
        const angleDeg = angleAtVertex(start, vertex, end);
        if (angleDeg > 0) {
          onAddAnnotation({
            id: `angle-${Date.now()}`,
            layerId: activeLayerId,
            type: 'angle',
            color: activeColor,
            lineWidth: strokeWidth,
            createdAt: new Date().toISOString(),
            startPoint: toVector3D(start),
            vertex: toVector3D(vertex),
            endPoint: toVector3D(end),
            angleDeg,
          });
        }
        setAnglePoints([]);
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
              lineWidth: strokeWidth,
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
            lineWidth: strokeWidth,
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
      if (activeTool === 'orbit' || activeTool === 'eraser') return;

      if (activeTool === 'brush' || activeTool === 'highlighter') {
        if (!isBrushDrawingRef.current) return;
        // Coalesced events recover the high-frequency samples the browser batches per frame,
        // which is what makes fast strokes follow the hand instead of cutting corners.
        const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
        const points = brushPointsRef.current;
        let added = false;
        for (const ev of events.length > 0 ? events : [e]) {
          const hit = getMeshIntersection(ev);
          if (!hit) continue;
          const pt = getSurfacePoint(hit);
          const last = points[points.length - 1];
          if (!last || last.distanceTo(pt) > MIN_SAMPLE_SPACING_MM) {
            points.push(pt);
            added = true;
          }
        }
        if (added) scheduleBrushPreview();
        return;
      }

      const hit = getMeshIntersection(e);
      if (!hit) return;
      const pt = hit.point.clone();

      if (activeTool === 'distance' && distanceStart) {
        setDistanceCurrent(pt);
      } else if (activeTool === 'arrow' && arrowTarget) {
        setArrowCurrent(pt);
      } else if ((activeTool === 'polyline' && polyline) || (activeTool === 'angle' && anglePoints.length > 0)) {
        setHoverPoint(pt);
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      if ((activeTool === 'brush' || activeTool === 'highlighter') && isBrushDrawingRef.current) {
        isBrushDrawingRef.current = false;
        if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
        if (brushPreviewFrameRef.current !== null) {
          cancelAnimationFrame(brushPreviewFrameRef.current);
          brushPreviewFrameRef.current = null;
        }
        const completedPoints = brushPointsRef.current;
        brushPointsRef.current = [];
        if (completedPoints.length >= 2) {
          const isHighlighter = activeTool === 'highlighter';
          onAddAnnotation({
            id: `brush-${Date.now()}`,
            layerId: activeLayerId,
            type: 'brush',
            color: activeColor,
            lineWidth: isHighlighter ? strokeWidth * HIGHLIGHTER_WIDTH_SCALE : strokeWidth,
            style: isHighlighter ? 'highlighter' : undefined,
            createdAt: new Date().toISOString(),
            points: smoothStroke(completedPoints).map(toVector3D),
          });
        }
        setBrushPoints([]);
      }
    };

    const handleDoubleClick = () => {
      if (activeTool === 'polyline' && polyline) commitPolyline(polyline, false);
    };

    canvas.addEventListener('pointerdown', handlePointerDown, true);
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerup', handlePointerUp);
    canvas.addEventListener('pointercancel', handlePointerUp);
    canvas.addEventListener('dblclick', handleDoubleClick);

    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown, true);
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerup', handlePointerUp);
      canvas.removeEventListener('pointercancel', handlePointerUp);
      canvas.removeEventListener('dblclick', handleDoubleClick);
      if (brushPreviewFrameRef.current !== null) cancelAnimationFrame(brushPreviewFrameRef.current);
    };
  }, [
    activeTool,
    gl,
    distanceStart,
    arrowTarget,
    polyline,
    anglePoints,
    activeColor,
    strokeWidth,
    activeLayerId,
    onAddAnnotation,
    onRequestPinText,
    getMeshIntersection,
    getSurfacePoint,
    traceSurface,
    screenDistancePx,
    commitPolyline,
  ]);

  // Live preview uses the same smoothing as the committed stroke, so what you see is what you get
  const brushLinePoints = useMemo((): Tuple3[] | null => {
    if (brushPoints.length < 2) return null;
    return smoothStroke(brushPoints).map(toTuple);
  }, [brushPoints]);

  const distanceLinePoints = useMemo((): Tuple3[] | null => {
    if (!distanceStart || !distanceCurrent) return null;
    return [toTuple(distanceStart), toTuple(distanceCurrent)];
  }, [distanceStart, distanceCurrent]);

  const arrowLinePoints = useMemo((): Tuple3[] | null => {
    if (!arrowTarget || !arrowCurrent) return null;
    return [toTuple(arrowCurrent), toTuple(arrowTarget)];
  }, [arrowTarget, arrowCurrent]);

  const polylinePathPoints = useMemo((): Tuple3[] | null => {
    if (!polyline || polyline.vertices.length < 2) return null;
    return flattenPolyline(polyline).map(toTuple);
  }, [polyline]);

  const polylineRubberBand = useMemo((): Tuple3[] | null => {
    if (!polyline || !hoverPoint) return null;
    return [toTuple(polyline.vertices[polyline.vertices.length - 1]), toTuple(hoverPoint)];
  }, [polyline, hoverPoint]);

  const anglePreviewPoints = useMemo((): Tuple3[] | null => {
    const pts = hoverPoint ? [...anglePoints, hoverPoint] : anglePoints;
    if (pts.length < 2) return null;
    return pts.map(toTuple);
  }, [anglePoints, hoverPoint]);

  const previewAngleDeg = anglePoints.length === 2 && hoverPoint
    ? angleAtVertex(anglePoints[0], anglePoints[1], hoverPoint)
    : null;

  return (
    <group>
      {/* Active Brush / Highlighter Preview */}
      {brushLinePoints && isFreehandTool && (
        <DreiLine
          points={brushLinePoints}
          color={activeColor}
          lineWidth={freehandWidth}
          transparent={activeTool === 'highlighter'}
          opacity={activeTool === 'highlighter' ? HIGHLIGHTER_OPACITY : 1}
          depthWrite={activeTool !== 'highlighter'}
          {...(activeTool === 'highlighter' ? highlighterStencilProps(RESERVED_STENCIL_REF) : {})}
          {...OVERLAY_MATERIAL_PROPS}
        />
      )}

      {/* Active Polyline Preview */}
      {polyline && (
        <group>
          {polylinePathPoints && (
            <DreiLine points={polylinePathPoints} color={activeColor} lineWidth={strokeWidth} {...OVERLAY_MATERIAL_PROPS} />
          )}
          {polylineRubberBand && (
            <DreiLine
              points={polylineRubberBand}
              color={activeColor}
              lineWidth={Math.max(1, strokeWidth - 1)}
              dashed
              dashSize={0.3}
              gapSize={0.2}
              depthTest={false}
            />
          )}
          {polyline.vertices.map((v, i) => (
            <mesh key={i} position={v} renderOrder={10}>
              <sphereGeometry args={[i === 0 && polyline.vertices.length >= 3 ? 0.3 : 0.18, 16, 16]} />
              <meshBasicMaterial color={i === 0 ? '#ffffff' : activeColor} depthTest={false} />
            </mesh>
          ))}
        </group>
      )}

      {/* Active Angle Preview */}
      {anglePoints.length > 0 && (
        <group>
          {anglePreviewPoints && (
            <DreiLine
              points={anglePreviewPoints}
              color={activeColor}
              lineWidth={strokeWidth}
              dashed
              dashSize={0.4}
              gapSize={0.25}
              depthTest={false}
            />
          )}
          {anglePoints.map((p, i) => (
            <mesh key={i} position={p} renderOrder={10}>
              <sphereGeometry args={[i === 1 ? 0.35 : 0.25, 16, 16]} />
              <meshBasicMaterial color={activeColor} depthTest={false} />
            </mesh>
          ))}
          {previewAngleDeg !== null && (
            <AngleBadge position={anglePoints[1]} angleDeg={previewAngleDeg} />
          )}
        </group>
      )}

      {/* Active Distance Measurement Preview */}
      {distanceStart && distanceCurrent && distanceLinePoints && (
        <group>
          <DreiLine
            points={distanceLinePoints}
            color={activeColor}
            lineWidth={strokeWidth}
            dashed
            dashSize={0.4}
            gapSize={0.25}
            depthTest={false}
          />
          <mesh position={distanceStart} renderOrder={10}>
            <sphereGeometry args={[0.3, 16, 16]} />
            <meshBasicMaterial color={activeColor} depthTest={false} />
          </mesh>
          <mesh position={distanceCurrent} renderOrder={10}>
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
            lineWidth={strokeWidth}
            dashed
            dashSize={0.4}
            gapSize={0.25}
            depthTest={false}
          />
          <mesh position={arrowTarget} renderOrder={10}>
            <sphereGeometry args={[0.3, 16, 16]} />
            <meshBasicMaterial color={activeColor} depthTest={false} />
          </mesh>
        </group>
      )}
    </group>
  );
}

function AngleBadge({ position, angleDeg }: { position: THREE.Vector3; angleDeg: number }) {
  return (
    <Html position={position} center distanceFactor={25} style={{ pointerEvents: 'none' }}>
      <div className="px-2 py-0.5 rounded-full text-[11px] font-semibold shadow-md whitespace-nowrap bg-zinc-900/90 text-zinc-100 -translate-y-5">
        {angleDeg.toFixed(1)}°
      </div>
    </Html>
  );
}
