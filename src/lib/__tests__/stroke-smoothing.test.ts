import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { angleArcPoints, angleAtVertex, pathLength, smoothStroke } from '@/src/components/viewer3d/stroke-smoothing';

describe('smoothStroke', () => {
  it('returns short strokes unchanged', () => {
    const pts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0)];
    const out = smoothStroke(pts);
    expect(out).toHaveLength(2);
    expect(out[1].x).toBe(1);
    expect(out[0]).not.toBe(pts[0]);
  });

  it('keeps endpoints and reduces zig-zag jitter', () => {
    const pts = Array.from({ length: 21 }, (_, i) => new THREE.Vector3(i * 0.5, i % 2 === 0 ? 0.2 : -0.2, 0));
    const out = smoothStroke(pts);

    expect(out[0].distanceTo(pts[0])).toBeLessThan(1e-6);
    expect(out[out.length - 1].distanceTo(pts[pts.length - 1])).toBeLessThan(1e-6);

    const interior = out.slice(5, -5);
    const maxDeviation = Math.max(...interior.map((p) => Math.abs(p.y)));
    expect(maxDeviation).toBeLessThan(0.1);
  });

  it('resamples to roughly even spacing', () => {
    const pts = [0, 0.1, 0.15, 3, 3.2, 6].map((x) => new THREE.Vector3(x, 0, 0));
    const out = smoothStroke(pts);
    const gaps = out.slice(1).map((p, i) => p.distanceTo(out[i]));
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(0.01);
  });
});

describe('measurement helpers', () => {
  const v = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);

  it('measures open and closed path length', () => {
    const square = [v(0, 0), v(1, 0), v(1, 1), v(0, 1)];
    expect(pathLength(square)).toBeCloseTo(3);
    expect(pathLength(square, true)).toBeCloseTo(4);
  });

  it('computes the angle at the vertex', () => {
    expect(angleAtVertex(v(1, 0), v(0, 0), v(0, 1))).toBeCloseTo(90);
    expect(angleAtVertex(v(1, 0), v(0, 0), v(1, 1))).toBeCloseTo(45);
    expect(angleAtVertex(v(0, 0), v(0, 0), v(1, 1))).toBe(0);
  });

  it('builds an arc of constant radius from arm to arm', () => {
    const arc = angleArcPoints(v(5, 0), v(0, 0), v(0, 5), 2, 8);
    expect(arc).toHaveLength(9);
    arc.forEach((p) => expect(p.length()).toBeCloseTo(2));
    expect(arc[0].x).toBeCloseTo(2);
    expect(arc[8].y).toBeCloseTo(2);
  });
});
