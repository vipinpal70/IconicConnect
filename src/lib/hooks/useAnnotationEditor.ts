'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type {
  AnnotationDocument,
  AnnotationLayer,
  AnnotationItem,
  SaveStatus,
  ToolMode,
  SaveAnnotationResponse,
  GetAnnotationResponse,
} from '@/src/types/annotation';
import {
  saveDraftToStorage,
  loadDraftFromStorage,
  clearDraftFromStorage,
} from '@/src/lib/storage/annotation-draft-storage';

const DEFAULT_LAYER_COLOR = '#3b82f6'; // Blue

function createInitialDocument(caseId: string): AnnotationDocument {
  const initialLayerId = `layer-${Date.now()}`;
  return {
    id: `doc-${caseId}`,
    caseId,
    schemaVersion: 1,
    revision: 0,
    layers: [
      {
        id: initialLayerId,
        name: 'Default Layer',
        color: DEFAULT_LAYER_COLOR,
        visible: true,
        locked: false,
        opacity: 1,
        annotations: [],
      },
    ],
  };
}

interface UseAnnotationEditorProps {
  caseId: string;
  userId?: string;
  onSaveSuccess?: (revision: number) => void;
}

export function useAnnotationEditor({
  caseId,
  userId,
  onSaveSuccess,
}: UseAnnotationEditorProps) {
  const [doc, setDoc] = useState<AnnotationDocument>(() => createInitialDocument(caseId));
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [lastSavedRevision, setLastSavedRevision] = useState<number>(0);
  const [lastSavedAt, setLastSavedAt] = useState<string | undefined>(undefined);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);

  const [activeTool, setActiveTool] = useState<ToolMode>('orbit');
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [activeColor, setActiveColor] = useState<string>('#ef4444'); // Default red for markings
  const [strokeWidth, setStrokeWidth] = useState<number>(2);

  // Undo / Redo count states to avoid reading refs in render
  const [undoCount, setUndoCount] = useState<number>(0);
  const [redoCount, setRedoCount] = useState<number>(0);

  // Draft recovery state
  const [hasRecoverableDraft, setHasRecoverableDraft] = useState<boolean>(false);
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const [recoveredDraftDoc, setRecoveredDraftDoc] = useState<AnnotationDocument | null>(null);

  // Undo / Redo history refs
  const undoStackRef = useRef<AnnotationDocument[]>([]);
  const redoStackRef = useRef<AnnotationDocument[]>([]);
  const lastSavedSnapshotRef = useRef<AnnotationDocument | null>(null);

  // In-flight save snapshot tracking
  const savingSnapshotRef = useRef<AnnotationDocument | null>(null);
  const isSavingRef = useRef<boolean>(false);

  // Maintain activeLayerId without triggering cascading renders in effects
  const [rawActiveLayerId, setRawActiveLayerId] = useState<string>('');
  const activeLayerId = doc.layers.some((l) => l.id === rawActiveLayerId)
    ? rawActiveLayerId
    : doc.layers[0]?.id || '';

  // Initial load from server + check for IndexedDB draft
  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      try {
        const res = await fetch(`/api/cases/${caseId}/annotations`);
        if (!res.ok) throw new Error('Failed to fetch annotations');
        const data: GetAnnotationResponse = await res.json();

        if (cancelled) return;

        let serverDoc: AnnotationDocument;
        if (data.success && data.document) {
          serverDoc = data.document;
          setLastSavedRevision(data.revision);
          setLastSavedAt(data.updatedAt);
        } else {
          serverDoc = createInitialDocument(caseId);
          setLastSavedRevision(0);
        }

        setDoc(serverDoc);
        lastSavedSnapshotRef.current = serverDoc;
        setSaveStatus('saved');

        // Check if there is an unsaved local draft in IndexedDB
        const localDraft = await loadDraftFromStorage(caseId, userId);
        if (!cancelled && localDraft && localDraft.document) {
          const localAnnotationCount = localDraft.document.layers.reduce(
            (acc, l) => acc + (l.annotations?.length || 0),
            0
          );
          const serverAnnotationCount = serverDoc.layers.reduce(
            (acc, l) => acc + (l.annotations?.length || 0),
            0
          );

          if (
            localAnnotationCount > serverAnnotationCount ||
            localDraft.savedAt > (serverDoc.updatedAt ? new Date(serverDoc.updatedAt).getTime() : 0)
          ) {
            setHasRecoverableDraft(true);
            setDraftSavedAt(localDraft.savedAt);
            setRecoveredDraftDoc(localDraft.document);
          }
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Error loading annotation document:', err);
          setSaveStatus('error');
          setSaveError(err instanceof Error ? err.message : 'Failed to load');
        }
      }
    }

    void loadData();

    return () => {
      cancelled = true;
    };
  }, [caseId, userId]);

  // Navigation Protection: warn if unsaved changes exist
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (saveStatus === 'dirty' || saveStatus === 'saving') {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [saveStatus]);

  // Debounced draft persistence to IndexedDB
  useEffect(() => {
    if (saveStatus !== 'dirty') return;

    const timer = setTimeout(() => {
      void saveDraftToStorage(caseId, doc, userId);
    }, 800);

    return () => clearTimeout(timer);
  }, [doc, saveStatus, caseId, userId]);

  // Helper to commit a state transition into undo history and mark dirty
  const pushState = useCallback((newDoc: AnnotationDocument) => {
    setDoc((prev) => {
      undoStackRef.current.push(prev);
      redoStackRef.current = [];
      setUndoCount(undoStackRef.current.length);
      setRedoCount(0);
      return newDoc;
    });
    setSaveStatus('dirty');
    setSaveError(undefined);
  }, []);

  // Tool / Layer Operations
  const addAnnotation = useCallback((annotation: AnnotationItem) => {
    setDoc((prev) => {
      undoStackRef.current.push(prev);
      redoStackRef.current = [];
      setUndoCount(undoStackRef.current.length);
      setRedoCount(0);

      const targetLayerId = annotation.layerId || activeLayerId || prev.layers[0]?.id;
      const updatedLayers = prev.layers.map((layer) => {
        if (layer.id === targetLayerId) {
          return {
            ...layer,
            annotations: [...layer.annotations, { ...annotation, layerId: targetLayerId }],
          };
        }
        return layer;
      });

      return { ...prev, layers: updatedLayers };
    });
    setSaveStatus('dirty');
    setSaveError(undefined);
  }, [activeLayerId]);

  const updateAnnotation = useCallback((id: string, updates: Partial<AnnotationItem>) => {
    setDoc((prev) => {
      undoStackRef.current.push(prev);
      redoStackRef.current = [];
      setUndoCount(undoStackRef.current.length);
      setRedoCount(0);

      const updatedLayers = prev.layers.map((layer) => ({
        ...layer,
        annotations: layer.annotations.map((ann) =>
          ann.id === id ? ({ ...ann, ...updates } as AnnotationItem) : ann
        ),
      }));

      return { ...prev, layers: updatedLayers };
    });
    setSaveStatus('dirty');
  }, []);

  const deleteAnnotation = useCallback((id: string) => {
    setDoc((prev) => {
      undoStackRef.current.push(prev);
      redoStackRef.current = [];
      setUndoCount(undoStackRef.current.length);
      setRedoCount(0);

      const updatedLayers = prev.layers.map((layer) => ({
        ...layer,
        annotations: layer.annotations.filter((ann) => ann.id !== id),
      }));

      return { ...prev, layers: updatedLayers };
    });
    setSelectedAnnotationId((sel) => (sel === id ? null : sel));
    setSaveStatus('dirty');
  }, []);

  const addLayer = useCallback((name?: string, color?: string) => {
    const newLayerId = `layer-${Date.now()}`;
    const newLayer: AnnotationLayer = {
      id: newLayerId,
      name: name || `Layer ${doc.layers.length + 1}`,
      color: color || DEFAULT_LAYER_COLOR,
      visible: true,
      locked: false,
      opacity: 1,
      annotations: [],
    };

    pushState({
      ...doc,
      layers: [...doc.layers, newLayer],
    });
    setRawActiveLayerId(newLayerId);
  }, [doc, pushState]);

  const updateLayer = useCallback((layerId: string, updates: Partial<AnnotationLayer>) => {
    pushState({
      ...doc,
      layers: doc.layers.map((l) => (l.id === layerId ? { ...l, ...updates } : l)),
    });
  }, [doc, pushState]);

  const deleteLayer = useCallback((layerId: string) => {
    if (doc.layers.length <= 1) return; // Must keep at least one layer
    const filtered = doc.layers.filter((l) => l.id !== layerId);
    pushState({
      ...doc,
      layers: filtered,
    });
    if (activeLayerId === layerId) {
      setRawActiveLayerId(filtered[0]?.id || '');
    }
  }, [doc, activeLayerId, pushState]);

  // Undo / Redo
  const undo = useCallback(() => {
    if (undoStackRef.current.length === 0) return;
    const previous = undoStackRef.current.pop()!;
    redoStackRef.current.push(doc);
    setUndoCount(undoStackRef.current.length);
    setRedoCount(redoStackRef.current.length);
    setDoc(previous);
    setSaveStatus('dirty');
  }, [doc]);

  const redo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;
    const next = redoStackRef.current.pop()!;
    undoStackRef.current.push(doc);
    setUndoCount(undoStackRef.current.length);
    setRedoCount(redoStackRef.current.length);
    setDoc(next);
    setSaveStatus('dirty');
  }, [doc]);

  // Explicit Save
  const saveDocument = useCallback(async () => {
    if (isSavingRef.current) return; // Prevent duplicate concurrent submissions

    isSavingRef.current = true;
    setSaveStatus('saving');
    setSaveError(undefined);

    // Capture consistent snapshot of current document state
    const snapshotToSave = JSON.parse(JSON.stringify(doc)) as AnnotationDocument;
    savingSnapshotRef.current = snapshotToSave;

    try {
      const response = await fetch(`/api/cases/${caseId}/annotations`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schemaVersion: snapshotToSave.schemaVersion || 1,
          expectedRevision: lastSavedRevision,
          layers: snapshotToSave.layers,
          saveReason: 'manual',
        }),
      });

      const data = (await response.json()) as SaveAnnotationResponse;

      if (!response.ok) {
        if (response.status === 409) {
          throw new Error('Revision conflict: another user saved changes. Please refresh or review.');
        }
        throw new Error(data.error || 'Failed to persist annotations');
      }

      setLastSavedRevision(data.revision);
      setLastSavedAt(data.savedAt);
      lastSavedSnapshotRef.current = snapshotToSave;

      // Clear local IndexedDB draft as database transaction committed
      void clearDraftFromStorage(caseId, userId);
      setHasRecoverableDraft(false);

      // Check if user made newer edits while request was in-flight
      setDoc((currentDoc) => {
        const isStillSameAsSnapshot =
          JSON.stringify(currentDoc.layers) === JSON.stringify(snapshotToSave.layers);

        if (isStillSameAsSnapshot) {
          setSaveStatus('saved');
        } else {
          // Keep dirty if newer changes were added while save was in-flight!
          setSaveStatus('dirty');
        }
        return currentDoc;
      });

      if (onSaveSuccess) onSaveSuccess(data.revision);
    } catch (err) {
      console.error('Save failed:', err);
      setSaveStatus('error');
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      isSavingRef.current = false;
      savingSnapshotRef.current = null;
    }
  }, [caseId, doc, lastSavedRevision, userId, onSaveSuccess]);

  // Discard local changes and revert to last saved state
  const discardChanges = useCallback(() => {
    if (!lastSavedSnapshotRef.current) return;
    setDoc(JSON.parse(JSON.stringify(lastSavedSnapshotRef.current)));
    undoStackRef.current = [];
    redoStackRef.current = [];
    setUndoCount(0);
    setRedoCount(0);
    setSaveStatus('saved');
    setSaveError(undefined);
    void clearDraftFromStorage(caseId, userId);
    setHasRecoverableDraft(false);
  }, [caseId, userId]);

  // Recover IndexedDB local draft
  const recoverDraft = useCallback(() => {
    if (!recoveredDraftDoc) return;
    undoStackRef.current.push(doc);
    setUndoCount(undoStackRef.current.length);
    setDoc(recoveredDraftDoc);
    setSaveStatus('dirty');
    setHasRecoverableDraft(false);
  }, [recoveredDraftDoc, doc]);

  const dismissDraftRecovery = useCallback(() => {
    setHasRecoverableDraft(false);
    void clearDraftFromStorage(caseId, userId);
  }, [caseId, userId]);

  return {
    document: doc,
    saveStatus,
    lastSavedRevision,
    lastSavedAt,
    saveError,
    activeTool,
    setActiveTool,
    activeLayerId,
    setActiveLayerId: setRawActiveLayerId,
    selectedAnnotationId,
    setSelectedAnnotationId,
    activeColor,
    setActiveColor,
    strokeWidth,
    setStrokeWidth,
    addAnnotation,
    updateAnnotation,
    deleteAnnotation,
    addLayer,
    updateLayer,
    deleteLayer,
    undo,
    redo,
    canUndo: undoCount > 0,
    canRedo: redoCount > 0,
    saveDocument,
    discardChanges,
    hasRecoverableDraft,
    draftSavedAt,
    recoverDraft,
    dismissDraftRecovery,
  };
}
