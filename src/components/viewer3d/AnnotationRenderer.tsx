'use client';

import React, { useMemo } from 'react';
import * as THREE from 'three';
import { Html, Line as DreiLine } from '@react-three/drei';
import type {
  AnnotationItem,
  AnnotationLayer,
  AngleAnnotation,
  BrushAnnotation,
  DistanceAnnotation,
  PinAnnotation,
  PolylineAnnotation,
  ArrowAnnotation,
} from '@/src/types/annotation';
import { Trash2 } from 'lucide-react';
import { angleArcPoints } from './stroke-smoothing';
import {
  HIGHLIGHTER_OPACITY,
  OVERLAY_MATERIAL_PROPS,
  RESERVED_STENCIL_REF,
  highlighterStencilProps,
} from './markup-materials';

interface AnnotationRendererProps {
  layers: AnnotationLayer[];
  selectedId: string | null;
  onDelete: (id: string) => void;
  /**
   * Hide the HTML labels (pins, measurements) while the camera moves: each one is a DOM element
   * repositioned every frame. Selecting and erasing is handled by AnnotationPicker.
   */
  hideLabels?: boolean;
}

type Tuple3 = [number, number, number];

export function AnnotationRenderer({ layers, selectedId, onDelete, hideLabels = false }: AnnotationRendererProps) {
  // Each highlighter stroke gets its own stencil value so it only blocks overlaps with itself
  const highlighterStencilRefs = useMemo(() => {
    const refs = new Map<string, number>();
    for (const layer of layers) {
      for (const ann of layer.annotations) {
        if (ann.type === 'brush' && ann.style === 'highlighter') {
          refs.set(ann.id, (refs.size % (RESERVED_STENCIL_REF - 1)) + 1);
        }
      }
    }
    return refs;
  }, [layers]);

  return (
    <group>
      {layers.map((layer) => {
        if (!layer.visible) return null;

        return (
          <group key={layer.id}>
            {layer.annotations.map((ann) => (
              <AnnotationItemView
                key={ann.id}
                annotation={ann}
                // Selection is shown with a halo/badge so the mark keeps its own color
                color={ann.color || layer.color}
                opacity={layer.opacity ?? 1.0}
                isSelected={selectedId === ann.id}
                stencilRef={highlighterStencilRefs.get(ann.id)}
                hideLabels={hideLabels}
                onDelete={() => onDelete(ann.id)}
              />
            ))}
          </group>
        );
      })}
    </group>
  );
}

function AnnotationItemView({
  annotation: ann,
  stencilRef,
  ...common
}: {
  annotation: AnnotationItem;
  color: string;
  opacity: number;
  isSelected: boolean;
  stencilRef?: number;
  hideLabels: boolean;
  onDelete: () => void;
}) {
  switch (ann.type) {
    case 'brush':
      return <BrushItem annotation={ann} stencilRef={stencilRef} {...common} />;
    case 'polyline':
      return <PolylineItem annotation={ann} {...common} />;
    case 'distance':
      return <DistanceItem annotation={ann} {...common} />;
    case 'angle':
      return <AngleItem annotation={ann} {...common} />;
    case 'pin':
      return <PinItem annotation={ann} {...common} />;
    case 'arrow':
      return <ArrowItem annotation={ann} {...common} />;
    default:
      return null;
  }
}

// ----------------------------------------------------
// Shared stroke styling
// ----------------------------------------------------
const DEFAULT_LINE_WIDTH = 3;
const SELECTION_HALO_COLOR = '#ffffff';

const toTuple = (p: { x: number; y: number; z: number }): Tuple3 => [p.x, p.y, p.z];
const toVector3 = (p: { x: number; y: number; z: number }) => new THREE.Vector3(p.x, p.y, p.z);

function StrokeLine({
  points,
  color,
  width,
  opacity,
  isSelected,
  stencilRef,
}: {
  points: Tuple3[];
  color: string;
  width: number;
  opacity: number;
  isSelected: boolean;
  /** Set for highlighter strokes: draws each pixel once so the translucent stroke stays even. */
  stencilRef?: number;
}) {
  const isHighlighter = stencilRef !== undefined;
  return (
    <>
      {isSelected && (
        <DreiLine
          points={points}
          color={SELECTION_HALO_COLOR}
          lineWidth={width + 5}
          transparent
          opacity={0.55}
          depthWrite={false}
          renderOrder={1}
          {...(isHighlighter ? highlighterStencilProps(RESERVED_STENCIL_REF) : {})}
          {...OVERLAY_MATERIAL_PROPS}
        />
      )}
      <DreiLine
        points={points}
        color={color}
        lineWidth={width}
        // Same (transparent) render pass as the halo, so renderOrder keeps the stroke on top of it
        transparent
        opacity={isHighlighter ? opacity * HIGHLIGHTER_OPACITY : opacity}
        depthWrite={!isHighlighter}
        renderOrder={2}
        {...(isHighlighter ? highlighterStencilProps(stencilRef) : {})}
        {...OVERLAY_MATERIAL_PROPS}
      />
    </>
  );
}

function MeasurementBadge({
  position,
  text,
  isSelected,
  deleteLabel,
  onDelete,
}: {
  position: THREE.Vector3;
  text: string;
  isSelected: boolean;
  deleteLabel: string;
  onDelete: () => void;
}) {
  return (
    <Html position={position} center distanceFactor={25} style={{ pointerEvents: 'auto' }}>
      <div
        className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold shadow-md whitespace-nowrap transition-transform ${
          isSelected
            ? 'bg-blue-600 text-white ring-2 ring-blue-300 scale-105'
            : 'bg-zinc-900/90 text-zinc-100 hover:bg-zinc-800'
        }`}
      >
        <span>{text}</span>
        {isSelected && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="hover:text-red-300 transition-colors"
            title={deleteLabel}
            aria-label={deleteLabel}
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </div>
    </Html>
  );
}

// ----------------------------------------------------
// Brush Line (pen & highlighter)
// ----------------------------------------------------
function BrushItem({
  annotation,
  color,
  opacity,
  isSelected,
  stencilRef,
}: {
  annotation: BrushAnnotation;
  color: string;
  opacity: number;
  isSelected: boolean;
  stencilRef?: number;
}) {
  const points = useMemo(() => {
    if (!annotation.points || annotation.points.length < 2) return null;
    return annotation.points.map(toTuple);
  }, [annotation.points]);

  if (!points) return null;

  return (
    <group>
      <StrokeLine
        points={points}
        color={color}
        width={annotation.lineWidth || DEFAULT_LINE_WIDTH}
        opacity={opacity}
        isSelected={isSelected}
        stencilRef={annotation.style === 'highlighter' ? stencilRef : undefined}
      />
    </group>
  );
}

// ----------------------------------------------------
// Surface Polyline / Margin Line
// ----------------------------------------------------
function PolylineItem({
  annotation,
  color,
  opacity,
  isSelected,
  hideLabels = false,
  onDelete,
}: {
  annotation: PolylineAnnotation;
  color: string;
  opacity: number;
  isSelected: boolean;
  hideLabels?: boolean;
  onDelete: () => void;
}) {
  const points = useMemo(
    () => (annotation.points && annotation.points.length >= 2 ? annotation.points.map(toTuple) : null),
    [annotation.points],
  );
  const vertices = useMemo(() => (annotation.vertices ?? []).map(toVector3), [annotation.vertices]);
  const badgePosition = useMemo(
    () => (annotation.points?.length ? toVector3(annotation.points[Math.floor(annotation.points.length / 2)]) : null),
    [annotation.points],
  );

  if (!points) return null;

  return (
    <group>
      <StrokeLine
        points={points}
        color={color}
        width={annotation.lineWidth || DEFAULT_LINE_WIDTH}
        opacity={opacity}
        isSelected={isSelected}
      />
      {isSelected &&
        vertices.map((v, i) => (
          <mesh key={i} position={v} renderOrder={10}>
            <sphereGeometry args={[0.18, 12, 12]} />
            <meshBasicMaterial color={color} depthTest={false} />
          </mesh>
        ))}
      {isSelected && badgePosition && !hideLabels && (
        <MeasurementBadge
          position={badgePosition}
          text={`${annotation.closed ? 'Outline' : 'Path'} · ${annotation.lengthMm.toFixed(2)} mm`}
          isSelected
          deleteLabel="Delete line"
          onDelete={onDelete}
        />
      )}
    </group>
  );
}

// ----------------------------------------------------
// Angle Measurement
// ----------------------------------------------------
function AngleItem({
  annotation,
  color,
  opacity,
  isSelected,
  hideLabels = false,
  onDelete,
}: {
  annotation: AngleAnnotation;
  color: string;
  opacity: number;
  isSelected: boolean;
  hideLabels?: boolean;
  onDelete: () => void;
}) {
  const geometry = useMemo(() => {
    const start = toVector3(annotation.startPoint);
    const vertex = toVector3(annotation.vertex);
    const end = toVector3(annotation.endPoint);
    const radius = Math.max(0.4, Math.min(2.5, 0.35 * Math.min(start.distanceTo(vertex), end.distanceTo(vertex))));
    const arc = angleArcPoints(start, vertex, end, radius);
    return {
      arms: [toTuple(start), toTuple(vertex), toTuple(end)],
      arc: arc.length >= 2 ? arc.map(toTuple) : null,
      badgePosition: arc.length ? arc[Math.floor(arc.length / 2)] : vertex,
      start,
      vertex,
      end,
    };
  }, [annotation.startPoint, annotation.vertex, annotation.endPoint]);

  return (
    <group>
      <StrokeLine
        points={geometry.arms}
        color={color}
        width={annotation.lineWidth || 2}
        opacity={opacity}
        isSelected={isSelected}
      />
      {geometry.arc && (
        <DreiLine points={geometry.arc} color={color} lineWidth={1.5} depthTest={false} renderOrder={3} />
      )}
      {[geometry.start, geometry.vertex, geometry.end].map((p, i) => (
        <mesh key={i} position={p} renderOrder={10}>
          <sphereGeometry args={[i === 1 ? 0.3 : 0.22, 16, 16]} />
          <meshBasicMaterial color={color} depthTest={false} />
        </mesh>
      ))}
      {!hideLabels && (
        <MeasurementBadge
          position={geometry.badgePosition}
          text={`${annotation.angleDeg.toFixed(1)}°`}
          isSelected={isSelected}
          deleteLabel="Delete angle"
          onDelete={onDelete}
        />
      )}
    </group>
  );
}

// ----------------------------------------------------
// Distance Measurement
// ----------------------------------------------------
function DistanceItem({
  annotation,
  color,
  opacity,
  isSelected,
  hideLabels = false,
  onDelete,
}: {
  annotation: DistanceAnnotation;
  color: string;
  opacity: number;
  isSelected: boolean;
  hideLabels?: boolean;
  onDelete: () => void;
}) {
  const p1 = useMemo(
    () => new THREE.Vector3(annotation.startPoint.x, annotation.startPoint.y, annotation.startPoint.z),
    [annotation.startPoint]
  );
  const p2 = useMemo(
    () => new THREE.Vector3(annotation.endPoint.x, annotation.endPoint.y, annotation.endPoint.z),
    [annotation.endPoint]
  );

  const midPoint = useMemo(() => new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5), [p1, p2]);

  const linePoints = useMemo((): [number, number, number][] => {
    return [
      [annotation.startPoint.x, annotation.startPoint.y, annotation.startPoint.z],
      [annotation.endPoint.x, annotation.endPoint.y, annotation.endPoint.z],
    ];
  }, [annotation.startPoint, annotation.endPoint]);

  return (
    <group>
      <StrokeLine
        points={linePoints}
        color={color}
        width={annotation.lineWidth || 2}
        opacity={opacity}
        isSelected={isSelected}
      />

      {/* Endpoint marker 1 */}
      <mesh position={p1}>
        <sphereGeometry args={[0.3, 16, 16]} />
        <meshBasicMaterial color={color} depthTest={false} />
      </mesh>

      {/* Endpoint marker 2 */}
      <mesh position={p2}>
        <sphereGeometry args={[0.3, 16, 16]} />
        <meshBasicMaterial color={color} depthTest={false} />
      </mesh>

      {/* Measurement badge in 3D space */}
      {!hideLabels && (
        <MeasurementBadge
          position={midPoint}
          text={`${annotation.distanceMm.toFixed(2)} mm`}
          isSelected={isSelected}
          deleteLabel="Delete measurement"
          onDelete={onDelete}
        />
      )}
    </group>
  );
}

// ----------------------------------------------------
// Comment Pin
// ----------------------------------------------------
function PinItem({
  annotation,
  color,
  opacity,
  isSelected,
  hideLabels = false,
  onDelete,
}: {
  annotation: PinAnnotation;
  color: string;
  opacity: number;
  isSelected: boolean;
  hideLabels?: boolean;
  onDelete: () => void;
}) {
  const pos = useMemo(
    () => new THREE.Vector3(annotation.position.x, annotation.position.y, annotation.position.z),
    [annotation.position]
  );
  // Stand the pin along the surface normal so it reads correctly from any side and on Z-up scans
  const orientation = useMemo(() => {
    const n = annotation.normal;
    const normal = n ? new THREE.Vector3(n.x, n.y, n.z) : new THREE.Vector3(0, 1, 0);
    if (normal.lengthSq() < 1e-8) normal.set(0, 1, 0);
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal.normalize());
  }, [annotation.normal]);

  return (
    <group position={pos} quaternion={orientation}>
      {/* 3D Pin Head */}
      <mesh position={[0, 0.6, 0]}>
        <sphereGeometry args={[0.4, 16, 16]} />
        <meshStandardMaterial
          color={color}
          roughness={0.2}
          metalness={0.5}
          transparent={opacity < 1}
          opacity={opacity}
        />
      </mesh>

      {/* 3D Pin Point */}
      <mesh position={[0, 0.2, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.2, 0.5, 16]} />
        <meshStandardMaterial color="#71717a" metalness={0.8} />
      </mesh>

      {/* Pin Badge Overlay */}
      {!hideLabels && (
      <Html position={[0, 1.2, 0]} center distanceFactor={25} style={{ pointerEvents: 'auto' }}>
        <div
          className={`group flex items-start gap-1.5 p-1.5 rounded-lg shadow-lg border max-w-[200px] text-xs transition-all ${
            isSelected
              ? 'bg-white text-zinc-900 border-blue-500 ring-2 ring-blue-400'
              : 'bg-zinc-900/95 text-zinc-100 border-zinc-700 hover:border-zinc-500'
          }`}
        >
          <div
            className="w-2.5 h-2.5 rounded-full shrink-0 mt-0.5"
            style={{ backgroundColor: color }}
          />
          <div className="flex-1 min-w-0">
            {annotation.title && (
              <div className="font-semibold text-[11px] truncate leading-tight">
                {annotation.title}
              </div>
            )}
            <div className="text-[10px] opacity-90 break-words line-clamp-3">
              {annotation.text}
            </div>
            {annotation.authorRole && (
              <div className="text-[9px] text-zinc-400 uppercase mt-0.5">
                {annotation.authorRole}
              </div>
            )}
          </div>
          {isSelected && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="text-red-500 hover:text-red-700 p-0.5"
              title="Delete comment pin"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      </Html>
      )}
    </group>
  );
}

// ----------------------------------------------------
// Arrow Reference Marker
// ----------------------------------------------------
function ArrowItem({
  annotation,
  color,
  opacity,
  isSelected,
  hideLabels = false,
  onDelete,
}: {
  annotation: ArrowAnnotation;
  color: string;
  opacity: number;
  isSelected: boolean;
  hideLabels?: boolean;
  onDelete: () => void;
}) {
  const start = useMemo(
    () => new THREE.Vector3(annotation.startPoint.x, annotation.startPoint.y, annotation.startPoint.z),
    [annotation.startPoint]
  );
  const end = useMemo(
    () => new THREE.Vector3(annotation.endPoint.x, annotation.endPoint.y, annotation.endPoint.z),
    [annotation.endPoint]
  );

  const lineWidth = annotation.lineWidth || 2;

  // Shaft stops at the base of the head so thick shafts don't poke through the tip
  const geometry = useMemo(() => {
    const direction = new THREE.Vector3().subVectors(end, start);
    const length = Math.max(direction.length(), 0.5);
    direction.normalize();
    const headLength = Math.min(0.6 + lineWidth * 0.15, length * 0.5);
    const headRadius = 0.22 + lineWidth * 0.06;
    const headBase = end.clone().addScaledVector(direction, -headLength);
    const headCenter = end.clone().addScaledVector(direction, -headLength / 2);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
    const shaft: [number, number, number][] = [
      [start.x, start.y, start.z],
      [headBase.x, headBase.y, headBase.z],
    ];
    return { shaft, headCenter, headLength, headRadius, quaternion };
  }, [start, end, lineWidth]);

  return (
    <group>
      <StrokeLine
        points={geometry.shaft}
        color={color}
        width={lineWidth}
        opacity={opacity}
        isSelected={isSelected}
      />
      <mesh position={geometry.headCenter} quaternion={geometry.quaternion}>
        <coneGeometry args={[geometry.headRadius, geometry.headLength, 20]} />
        <meshBasicMaterial color={color} transparent={opacity < 1} opacity={opacity} />
      </mesh>
      {isSelected && !hideLabels && (
        <Html position={end} center distanceFactor={25} style={{ pointerEvents: 'auto' }}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="p-1 rounded-full bg-red-600 text-white shadow hover:bg-red-700"
            title="Delete arrow marker"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </Html>
      )}
    </group>
  );
}
