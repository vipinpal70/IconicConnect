import * as THREE from 'three';
import type { AnnotationItem, AnnotationLayer, Vector3D } from '@/src/types/annotation';

/**
 * Screen-space picking for markup.
 *
 * Previously every annotation carried R3F pointer handlers, so R3F raycast every stroke (Line2 has no
 * BVH; the test is linear in segments) on every pointer move, including while rotating the model.
 * Now markup is only tested on a click (or an eraser drag), by projecting its points to the screen
 * and measuring the distance to the cursor.
 */

const PIN_HEAD_OFFSET = 0.6;
const PIN_PICK_RADIUS_PX = 16;
const MIN_LINE_PICK_PX = 7;

function pickPoints(annotation: AnnotationItem): Vector3D[] {
  switch (annotation.type) {
    case 'brush':
    case 'polyline':
      return annotation.points ?? [];
    case 'distance':
    case 'arrow':
      return [annotation.startPoint, annotation.endPoint];
    case 'angle':
      return [annotation.startPoint, annotation.vertex, annotation.endPoint];
    case 'pin':
      return [];
    default:
      return [];
  }
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export interface PickOptions {
  camera: THREE.Camera;
  /** Canvas size in CSS pixels. */
  width: number;
  height: number;
  /** Cursor position relative to the canvas, in CSS pixels. */
  x: number;
  y: number;
  /** Skip annotations on locked layers (the eraser must not touch them). */
  skipLocked?: boolean;
}

/** The annotation under the cursor, or null. Hidden layers are never picked. */
export function pickAnnotation(layers: AnnotationLayer[], options: PickOptions): AnnotationItem | null {
  const { camera, width, height, x, y, skipLocked = false } = options;
  const projected = new THREE.Vector3();
  const toScreen = (p: Vector3D): [number, number] | null => {
    projected.set(p.x, p.y, p.z).project(camera);
    if (projected.z > 1 || projected.z < -1) return null; // behind the camera / clipped
    return [((projected.x + 1) / 2) * width, ((1 - projected.y) / 2) * height];
  };

  let best: AnnotationItem | null = null;
  let bestDistance = Infinity;
  const consider = (annotation: AnnotationItem, distance: number, threshold: number) => {
    if (distance <= threshold && distance < bestDistance) {
      best = annotation;
      bestDistance = distance;
    }
  };

  for (const layer of layers) {
    if (!layer.visible || (skipLocked && layer.locked)) continue;
    for (const annotation of layer.annotations) {
      if (annotation.type === 'pin') {
        const n = annotation.normal ?? { x: 0, y: 1, z: 0 };
        const length = Math.hypot(n.x, n.y, n.z) || 1;
        const head = {
          x: annotation.position.x + (n.x / length) * PIN_HEAD_OFFSET,
          y: annotation.position.y + (n.y / length) * PIN_HEAD_OFFSET,
          z: annotation.position.z + (n.z / length) * PIN_HEAD_OFFSET,
        };
        const screen = toScreen(head);
        if (screen) consider(annotation, Math.hypot(screen[0] - x, screen[1] - y), PIN_PICK_RADIUS_PX);
        continue;
      }

      const points = pickPoints(annotation);
      const threshold = Math.max(MIN_LINE_PICK_PX, (annotation.lineWidth ?? 3) / 2 + 5);
      let previous: [number, number] | null = null;
      for (const point of points) {
        const screen = toScreen(point);
        if (screen && previous) {
          consider(annotation, distanceToSegment(x, y, previous[0], previous[1], screen[0], screen[1]), threshold);
        } else if (screen && points.length === 1) {
          consider(annotation, Math.hypot(screen[0] - x, screen[1] - y), threshold);
        }
        previous = screen;
      }
    }
  }
  return best;
}
