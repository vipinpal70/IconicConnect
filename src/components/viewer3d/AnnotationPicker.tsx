'use client';

import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import type { AnnotationLayer, ToolMode } from '@/src/types/annotation';
import { pickAnnotation } from './annotation-picking';

/** A press that moves further than this is a rotation, not a click. */
const CLICK_SLOP_PX = 4;

/**
 * Click-to-select (navigate tool) and click/drag-to-erase (eraser tool) for markup, using one
 * screen-space test per click instead of per-object raycasts on every pointer move.
 */
export function AnnotationPicker({
  layers,
  activeTool,
  onSelect,
  onDelete,
}: {
  layers: AnnotationLayer[];
  activeTool: ToolMode;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const gl = useThree((s) => s.gl);
  const get = useThree((s) => s.get);
  const latest = useRef({ layers, activeTool, onSelect, onDelete });

  useEffect(() => {
    latest.current = { layers, activeTool, onSelect, onDelete };
  }, [layers, activeTool, onSelect, onDelete]);

  useEffect(() => {
    const canvas = gl.domElement;
    let press: { x: number; y: number } | null = null;
    let pendingMove: PointerEvent | null = null;
    let moveFrame: number | null = null;
    // One eraser drag can cross a mark many times before React re-renders without it
    const erased = new Set<string>();

    const pickAt = (event: PointerEvent, skipLocked: boolean) => {
      const rect = canvas.getBoundingClientRect();
      return pickAnnotation(latest.current.layers, {
        camera: get().camera,
        width: rect.width,
        height: rect.height,
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        skipLocked,
      });
    };
    const eraseAt = (event: PointerEvent) => {
      const hit = pickAt(event, true);
      if (hit && !erased.has(hit.id)) {
        erased.add(hit.id);
        latest.current.onDelete(hit.id);
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const tool = latest.current.activeTool;
      if (tool === 'eraser') {
        erased.clear();
        eraseAt(event);
      } else if (tool === 'orbit' || tool === 'select') {
        press = { x: event.clientX, y: event.clientY };
      }
    };
    const onPointerMove = (event: PointerEvent) => {
      if (latest.current.activeTool !== 'eraser' || (event.buttons & 1) === 0) return;
      pendingMove = event;
      if (moveFrame !== null) return;
      moveFrame = requestAnimationFrame(() => {
        moveFrame = null;
        if (pendingMove) eraseAt(pendingMove);
        pendingMove = null;
      });
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!press || event.button !== 0) return;
      const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y);
      press = null;
      if (moved > CLICK_SLOP_PX) return;
      const hit = pickAt(event, false);
      if (hit) latest.current.onSelect(hit.id);
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      if (moveFrame !== null) cancelAnimationFrame(moveFrame);
    };
  }, [gl, get]);

  return null;
}
