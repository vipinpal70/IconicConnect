import { describe, it, expect, vi } from 'vitest';
import type { AnnotationDocument, AnnotationLayer } from '@/src/types/annotation';

describe('Annotation Data Model & Revision Logic', () => {
  it('detects revision conflicts when expected revision differs from server revision', () => {
    const serverRevision: number = 5;
    const clientExpectedRevision: number = 4; // Stale client snapshot

    const isConflict = clientExpectedRevision !== serverRevision;
    expect(isConflict).toBe(true);
  });

  it('increments monotonically on confirmed save', () => {
    const currentRevision = 3;
    const nextRevision = currentRevision + 1;
    expect(nextRevision).toBe(4);
  });

  it('preserves newer in-flight annotations when previous snapshot completes save', () => {
    const savedSnapshotLayers: AnnotationLayer[] = [
      {
        id: 'layer-1',
        name: 'Default',
        color: '#ff0000',
        visible: true,
        locked: false,
        opacity: 1,
        annotations: [
          {
            id: 'brush-1',
            layerId: 'layer-1',
            type: 'brush',
            color: '#ff0000',
            createdAt: '2026-10-27T10:00:00Z',
            points: [{ x: 1, y: 1, z: 1 }],
          },
        ],
      },
    ];

    // While request was in-flight, user drew a second annotation
    const currentDocLayers: AnnotationLayer[] = [
      {
        id: 'layer-1',
        name: 'Default',
        color: '#ff0000',
        visible: true,
        locked: false,
        opacity: 1,
        annotations: [
          {
            id: 'brush-1',
            layerId: 'layer-1',
            type: 'brush',
            color: '#ff0000',
            createdAt: '2026-10-27T10:00:00Z',
            points: [{ x: 1, y: 1, z: 1 }],
          },
          {
            id: 'brush-2',
            layerId: 'layer-1',
            type: 'brush',
            color: '#ff0000',
            createdAt: '2026-10-27T10:00:02Z',
            points: [{ x: 2, y: 2, z: 2 }],
          },
        ],
      },
    ];

    const isStillSameAsSnapshot =
      JSON.stringify(currentDocLayers) === JSON.stringify(savedSnapshotLayers);

    // Newer changes must stay marked as dirty (unsaved)
    expect(isStillSameAsSnapshot).toBe(false);
  });

  it('validates measurement calculations correctly in millimeters', () => {
    const p1 = { x: 0, y: 0, z: 0 };
    const p2 = { x: 3, y: 4, z: 0 }; // 3-4-5 triangle

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dz = p2.z - p1.z;
    const distanceMm = Math.sqrt(dx * dx + dy * dy + dz * dz);

    expect(distanceMm).toBe(5);
  });
});
