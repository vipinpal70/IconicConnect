import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  saveDraftToStorage,
  loadDraftFromStorage,
  clearDraftFromStorage,
} from '../annotation-draft-storage';
import type { AnnotationDocument } from '@/src/types/annotation';

describe('IndexedDB / Local Draft Storage', () => {
  const mockDoc: AnnotationDocument = {
    id: 'doc-test-1',
    caseId: 'case-test-1',
    schemaVersion: 1,
    revision: 2,
    layers: [
      {
        id: 'layer-1',
        name: 'Layer 1',
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
            createdAt: new Date().toISOString(),
            points: [
              { x: 0, y: 0, z: 0 },
              { x: 1, y: 1, z: 1 },
            ],
          },
        ],
      },
    ],
  };

  beforeEach(() => {
    const store: Record<string, string> = {};
    const storageMock = {
      getItem: vi.fn((key: string) => store[key] || null),
      setItem: vi.fn((key: string, value: string) => {
        store[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key];
      }),
      clear: vi.fn(() => {
        for (const k in store) delete store[k];
      }),
      key: vi.fn((i: number) => Object.keys(store)[i] || null),
      length: 0,
    };

    vi.stubGlobal('localStorage', storageMock);
    vi.stubGlobal('window', { localStorage: storageMock });
  });

  it('saves and loads a draft scoped to case and user', async () => {
    await saveDraftToStorage('case-test-1', mockDoc, 'user-123');
    const loaded = await loadDraftFromStorage('case-test-1', 'user-123');

    expect(loaded).not.toBeNull();
    expect(loaded?.document.id).toBe('doc-test-1');
    expect(loaded?.document.layers[0].annotations).toHaveLength(1);
  });

  it('clears draft from storage upon explicit discard or confirmed save', async () => {
    await saveDraftToStorage('case-test-1', mockDoc, 'user-123');
    await clearDraftFromStorage('case-test-1', 'user-123');

    const loaded = await loadDraftFromStorage('case-test-1', 'user-123');
    expect(loaded).toBeNull();
  });

  it('isolates drafts between different cases', async () => {
    await saveDraftToStorage('case-1', mockDoc, 'user-123');
    const loadedCase2 = await loadDraftFromStorage('case-2', 'user-123');
    expect(loadedCase2).toBeNull();
  });
});
