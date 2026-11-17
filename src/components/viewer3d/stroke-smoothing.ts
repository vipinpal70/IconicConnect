import * as THREE from 'three';

/** Distance (model units, mm) a stroke is lifted off the scan surface to avoid z-fighting. */
export const SURFACE_OFFSET_MM = 0.06;

/** Minimum spacing between raw samples captured while drawing. */
export const MIN_SAMPLE_SPACING_MM = 0.08;

/** Target spacing of the resampled, smoothed curve. */
const RESAMPLE_SPACING_MM = 0.1;
const MAX_RESAMPLED_POINTS = 4000;

/**
 * Turn jittery raw pointer samples into a smooth stroke.
 *
 * 1. Moving-average pass removes hand/raycast jitter (endpoints are kept fixed).
 * 2. Centripetal Catmull-Rom resampling yields evenly spaced points so
 *    fat lines render with clean joins instead of kinks.
 */
export function smoothStroke(points: THREE.Vector3[], window = 3): THREE.Vector3[] {
  if (points.length < 3) return points.map((p) => p.clone());

  const averaged = points.map((p, i) => {
    if (i === 0 || i === points.length - 1) return p.clone();
    const radius = Math.min(window, i, points.length - 1 - i);
    const sum = new THREE.Vector3();
    for (let j = i - radius; j <= i + radius; j++) sum.add(points[j]);
    return sum.divideScalar(radius * 2 + 1);
  });

  const curve = new THREE.CatmullRomCurve3(averaged, false, 'centripetal');
  // Default 200 arc-length divisions is too coarse for long strokes and makes spacing uneven
  curve.arcLengthDivisions = Math.max(200, averaged.length * 4);
  const length = curve.getLength();
  const divisions = Math.min(MAX_RESAMPLED_POINTS, Math.max(averaged.length, Math.ceil(length / RESAMPLE_SPACING_MM)));
  return curve.getSpacedPoints(divisions);
}

/** Total length of a polyline path in model units (mm). */
export function pathLength(points: THREE.Vector3[], closed = false): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += points[i].distanceTo(points[i - 1]);
  if (closed && points.length > 2) total += points[points.length - 1].distanceTo(points[0]);
  return total;
}

/** Angle ABC at `vertex`, in degrees (0–180). Returns 0 for degenerate arms. */
export function angleAtVertex(start: THREE.Vector3, vertex: THREE.Vector3, end: THREE.Vector3): number {
  const a = new THREE.Vector3().subVectors(start, vertex);
  const b = new THREE.Vector3().subVectors(end, vertex);
  if (a.lengthSq() === 0 || b.lengthSq() === 0) return 0;
  return THREE.MathUtils.radToDeg(a.angleTo(b));
}

/** Points along the arc between the two arms of an angle, for drawing the angle indicator. */
export function angleArcPoints(
  start: THREE.Vector3,
  vertex: THREE.Vector3,
  end: THREE.Vector3,
  radius: number,
  segments = 24,
): THREE.Vector3[] {
  const a = new THREE.Vector3().subVectors(start, vertex).normalize();
  const b = new THREE.Vector3().subVectors(end, vertex).normalize();
  const angle = a.angleTo(b);
  if (!Number.isFinite(angle) || angle === 0) return [];
  const sinAngle = Math.sin(angle);
  const out: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    // Spherical interpolation between the two arm directions
    const dir =
      sinAngle < 1e-6
        ? a.clone().lerp(b, t).normalize()
        : a
            .clone()
            .multiplyScalar(Math.sin((1 - t) * angle) / sinAngle)
            .add(b.clone().multiplyScalar(Math.sin(t * angle) / sinAngle));
    out.push(vertex.clone().addScaledVector(dir, radius));
  }
  return out;
}
