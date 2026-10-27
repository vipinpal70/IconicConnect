'use client';

import React, { useMemo } from 'react';
import * as THREE from 'three';
import { Html, Line as DreiLine } from '@react-three/drei';
import type {
  AnnotationLayer,
  BrushAnnotation,
  DistanceAnnotation,
  PinAnnotation,
  ArrowAnnotation,
} from '@/src/types/annotation';
import { Trash2 } from 'lucide-react';

interface AnnotationRendererProps {
  layers: AnnotationLayer[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

export function AnnotationRenderer({
  layers,
  selectedId,
  onSelect,
  onDelete,
}: AnnotationRendererProps) {
  return (
    <group>
      {layers.map((layer) => {
        if (!layer.visible) return null;

        return (
          <group key={layer.id}>
            {layer.annotations.map((ann) => {
              const isSelected = selectedId === ann.id;
              const effectiveColor = isSelected ? '#3b82f6' : ann.color || layer.color;
              const opacity = layer.opacity ?? 1.0;

              if (ann.type === 'brush') {
                return (
                  <BrushItem
                    key={ann.id}
                    annotation={ann}
                    color={effectiveColor}
                    opacity={opacity}
                    isSelected={isSelected}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(ann.id);
                    }}
                  />
                );
              }

              if (ann.type === 'distance') {
                return (
                  <DistanceItem
                    key={ann.id}
                    annotation={ann}
                    color={effectiveColor}
                    opacity={opacity}
                    isSelected={isSelected}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(ann.id);
                    }}
                    onDelete={() => onDelete(ann.id)}
                  />
                );
              }

              if (ann.type === 'pin') {
                return (
                  <PinItem
                    key={ann.id}
                    annotation={ann}
                    color={effectiveColor}
                    opacity={opacity}
                    isSelected={isSelected}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(ann.id);
                    }}
                    onDelete={() => onDelete(ann.id)}
                  />
                );
              }

              if (ann.type === 'arrow') {
                return (
                  <ArrowItem
                    key={ann.id}
                    annotation={ann}
                    color={effectiveColor}
                    opacity={opacity}
                    isSelected={isSelected}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(ann.id);
                    }}
                    onDelete={() => onDelete(ann.id)}
                  />
                );
              }

              return null;
            })}
          </group>
        );
      })}
    </group>
  );
}

// ----------------------------------------------------
// Brush Line
// ----------------------------------------------------
function BrushItem({
  annotation,
  color,
  opacity,
  isSelected,
  onClick,
}: {
  annotation: BrushAnnotation;
  color: string;
  opacity: number;
  isSelected: boolean;
  onClick: (e: { stopPropagation: () => void }) => void;
}) {
  const points = useMemo(() => {
    if (!annotation.points || annotation.points.length < 2) return null;
    return annotation.points.map((p): [number, number, number] => [p.x, p.y, p.z]);
  }, [annotation.points]);

  if (!points) return null;

  return (
    <group onClick={onClick}>
      <DreiLine
        points={points}
        color={color}
        lineWidth={isSelected ? 4 : annotation.lineWidth || 2}
        transparent={opacity < 1}
        opacity={opacity}
      />
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
  onClick,
  onDelete,
}: {
  annotation: DistanceAnnotation;
  color: string;
  opacity: number;
  isSelected: boolean;
  onClick: (e: { stopPropagation: () => void }) => void;
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
    <group onClick={onClick}>
      <DreiLine
        points={linePoints}
        color={color}
        lineWidth={isSelected ? 3 : 2}
        transparent={opacity < 1}
        opacity={opacity}
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
      <Html position={midPoint} center distanceFactor={25} style={{ pointerEvents: 'auto' }}>
        <div
          className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold shadow-md whitespace-nowrap transition-transform ${
            isSelected
              ? 'bg-blue-600 text-white ring-2 ring-blue-300 scale-105'
              : 'bg-zinc-900/90 text-zinc-100 hover:bg-zinc-800'
          }`}
        >
          <span>{annotation.distanceMm.toFixed(2)} mm</span>
          {isSelected && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="hover:text-red-300 transition-colors"
              title="Delete measurement"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      </Html>
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
  onClick,
  onDelete,
}: {
  annotation: PinAnnotation;
  color: string;
  opacity: number;
  isSelected: boolean;
  onClick: (e: { stopPropagation: () => void }) => void;
  onDelete: () => void;
}) {
  const pos = useMemo(
    () => new THREE.Vector3(annotation.position.x, annotation.position.y, annotation.position.z),
    [annotation.position]
  );

  return (
    <group position={pos} onClick={onClick}>
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
    </group>
  );
}

// ----------------------------------------------------
// Arrow Reference Marker
// ----------------------------------------------------
function ArrowItem({
  annotation,
  color,
  isSelected,
  onClick,
  onDelete,
}: {
  annotation: ArrowAnnotation;
  color: string;
  opacity: number;
  isSelected: boolean;
  onClick: (e: { stopPropagation: () => void }) => void;
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

  const direction = useMemo(() => new THREE.Vector3().subVectors(end, start).normalize(), [start, end]);
  const length = useMemo(() => start.distanceTo(end), [start, end]);

  const arrowHelper = useMemo(() => {
    return new THREE.ArrowHelper(direction, start, Math.max(length, 0.5), color, 0.8, 0.4);
  }, [direction, start, length, color]);

  return (
    <group onClick={onClick}>
      <primitive object={arrowHelper} />
      {isSelected && (
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
