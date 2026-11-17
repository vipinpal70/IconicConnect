'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import {
  Save,
  RotateCcw,
  Undo2,
  Redo2,
  Paintbrush,
  Highlighter,
  Spline,
  Ruler,
  DraftingCompass,
  MapPin,
  MoveRight,
  Eraser,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Plus,
  Trash2,
  History,
  Layers,
  Camera,
  Maximize2,
  Minimize2,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  X,
} from 'lucide-react';
import { useAnnotationEditor } from '@/src/lib/hooks/useAnnotationEditor';
import { ModelMesh, type ScanFileInfo } from './ModelMesh';
import { prefetchModel } from './model-cache';
import { PREVIEW_KIND_META, type Model3DSource } from './preview-sources';
import { AnnotationRenderer } from './AnnotationRenderer';
import { DrawingInteraction } from './DrawingInteraction';
import { DrawingStylePanel, MAX_STROKE_WIDTH, MIN_STROKE_WIDTH } from './DrawingStylePanel';
import type { Vector3D, AnnotationVersionItem, ToolMode } from '@/src/types/annotation';
import { Button } from '@/src/components/ui/button';

interface Dental3DViewerProps {
  caseId: string;
  caseNumber?: string;
  /** Every 3D file the user may open for this case; the header switches between them. */
  sources: Model3DSource[];
  initialSourceId?: string;
  userId?: string;
  onClose?: () => void;
  isFullScreenDefault?: boolean;
}

interface ToolDefinition {
  id: ToolMode;
  label: string;
  shortcut: string;
  icon: React.ReactNode;
  /** Shown in the hint bar while the tool is active. */
  hint?: string;
}

// Grouped as: navigate · draw · measure · annotate · erase
const TOOL_GROUPS: ToolDefinition[][] = [
  [{ id: 'orbit', label: 'Orbit & Pan', shortcut: 'v', icon: <Camera className="w-4 h-4" /> }],
  [
    { id: 'brush', label: 'Freehand Pen', shortcut: 'b', icon: <Paintbrush className="w-4 h-4" />, hint: 'Drag on the scan to draw' },
    { id: 'highlighter', label: 'Highlighter', shortcut: 'h', icon: <Highlighter className="w-4 h-4" />, hint: 'Drag to highlight an area' },
    {
      id: 'polyline',
      label: 'Surface Line / Margin',
      shortcut: 'l',
      icon: <Spline className="w-4 h-4" />,
      hint: 'Click to place points · click the first point to close · Enter or double-click to finish · Backspace removes a point',
    },
    { id: 'arrow', label: 'Arrow Pointer', shortcut: 'a', icon: <MoveRight className="w-4 h-4" />, hint: 'Click the target, then click where the arrow starts' },
  ],
  [
    { id: 'distance', label: 'Distance Measurement', shortcut: 'm', icon: <Ruler className="w-4 h-4" />, hint: 'Click two points to measure' },
    {
      id: 'angle',
      label: 'Angle Measurement',
      shortcut: 'n',
      icon: <DraftingCompass className="w-4 h-4" />,
      hint: 'Click start, vertex, then end point · Backspace removes a point',
    },
  ],
  [{ id: 'pin', label: 'Comment Pin', shortcut: 'p', icon: <MapPin className="w-4 h-4" />, hint: 'Click the scan to drop a comment' }],
  [{ id: 'eraser', label: 'Eraser', shortcut: 'e', icon: <Eraser className="w-4 h-4" />, hint: 'Click or drag across marks to erase · locked layers are protected' }],
];
const ALL_TOOLS = TOOL_GROUPS.flat();

/** Tools that draw with the current color/thickness (and so show the style bar). */
const STYLED_TOOLS = new Set<ToolMode>(['brush', 'highlighter', 'polyline', 'arrow', 'distance', 'angle', 'pin']);

interface OrbitControlsLike {
  object: { position: { set: (x: number, y: number, z: number) => void } };
  target: { set: (x: number, y: number, z: number) => void };
  minDistance: number;
  maxDistance: number;
  update: () => void;
}

interface ModelBounds {
  center: { x: number; y: number; z: number };
  radius: number;
}

function ModelCameraFraming({
  bounds,
  controlsRef,
}: {
  bounds: ModelBounds | null;
  controlsRef: React.RefObject<OrbitControlsLike | null>;
}) {
  useEffect(() => {
    if (!bounds) return;
    const controls = controlsRef.current;
    if (!controls) return;

    const { center, radius } = bounds;
    const distance = Math.max(radius / Math.sin((45 * Math.PI) / 360) * 0.62, 2);
    controls.minDistance = Math.max(radius * 0.08, 0.2);
    controls.maxDistance = Math.max(radius * 12, 100);
    controls.target.set(center.x, center.y, center.z);
    controls.object.position.set(center.x + distance * 0.16, center.y + distance * 0.38, center.z + distance);
    controls.update();
  }, [bounds, controlsRef]);

  return null;
}

export function Dental3DViewer({
  caseId,
  caseNumber,
  sources,
  initialSourceId,
  userId,
  onClose,
  isFullScreenDefault = false,
}: Dental3DViewerProps) {
  const [activeSourceId, setActiveSourceId] = useState(initialSourceId ?? sources[0]?.id);
  const activeSource = sources.find((s) => s.id === activeSourceId) ?? sources[0] ?? null;
  const previewKind = activeSource?.kind ?? 'case-submission';
  const previewMeta = PREVIEW_KIND_META[previewKind];
  const [isFullScreen, setIsFullScreen] = useState(isFullScreenDefault);
  const [isLayersOpen, setIsLayersOpen] = useState(true);
  const [isVersionsOpen, setIsVersionsOpen] = useState(false);
  const [versionsList, setVersionsList] = useState<AnnotationVersionItem[]>([]);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);
  const [modelLoadError, setModelLoadError] = useState<string | null>(null);
  const [modelLoadProgress, setModelLoadProgress] = useState<{ loadedBytes: number; totalBytes: number | null } | null>(null);
  const pendingLoadProgressRef = useRef<{ loadedBytes: number; totalBytes: number | null } | null>(null);
  const loadProgressFrameRef = useRef<number | null>(null);
  const [scanFiles, setScanFiles] = useState<ScanFileInfo[]>([]);
  const [scanVisibility, setScanVisibility] = useState<Record<string, boolean>>({});
  const [modelBounds, setModelBounds] = useState<ModelBounds | null>(null);

  // Model rendering preferences
  const [wireframe, setWireframe] = useState(false);
  const [materialMode, setMaterialMode] = useState<'enamel' | 'clay' | 'normal'>('enamel');
  const [modelOpacity, setModelOpacity] = useState(1.0);

  // Pin text input dialog
  const [pinDialogPoint, setPinDialogPoint] = useState<{ point: Vector3D; normal?: Vector3D } | null>(null);
  const [pinTitle, setPinTitle] = useState('');
  const [pinText, setPinText] = useState('');

  const orbitControlsRef = useRef<OrbitControlsLike | null>(null);

  const handleScanFilesChange = useCallback((files: ScanFileInfo[]) => {
    setScanFiles(files);
    const hasPrimaryScanPair = files.some(({ name }) =>
      /(?:^|\/)mb antagonist scan\.dcm$/i.test(name.replace(/\\/g, '/')),
    ) && files.some(({ name }) =>
      /(?:^|\/)mb preparation scan\.dcm$/i.test(name.replace(/\\/g, '/')),
    );
    setScanVisibility((current) =>
      Object.fromEntries(files.map(({ name, category }) => {
        const normalizedName = name.replace(/\\/g, '/');
        // Designed restorations are what a design output is about — always show them
        const defaultVisible = category === 'cad' || category === 'mesh'
          ? true
          : hasPrimaryScanPair
          ? /(?:^|\/)mb (?:antagonist|preparation) scan\.dcm$/i.test(normalizedName)
          : !/(?:^|\/)(?:raw |pre.?preparation|.*articulatorbitescan)/i.test(normalizedName);
        return [name, current[name] ?? defaultVisible];
      })),
    );
  }, []);

  const handleModelLoadProgress = useCallback((progress: { loadedBytes: number; totalBytes: number | null } | null) => {
    pendingLoadProgressRef.current = progress;
    if (loadProgressFrameRef.current !== null) return;
    loadProgressFrameRef.current = requestAnimationFrame(() => {
      loadProgressFrameRef.current = null;
      setModelLoadProgress(pendingLoadProgressRef.current);
    });
  }, []);

  useEffect(
    () => () => {
      if (loadProgressFrameRef.current !== null) cancelAnimationFrame(loadProgressFrameRef.current);
    },
    [],
  );

  const {
    layers,
    saveStatus,
    lastSavedRevision,
    saveError,
    activeTool,
    setActiveTool,
    activeLayerId,
    setActiveLayerId,
    selectedAnnotationId,
    setSelectedAnnotationId,
    activeColor,
    setActiveColor,
    strokeWidth,
    setStrokeWidth,
    addAnnotation,
    deleteAnnotation,
    addLayer,
    updateLayer,
    deleteLayer,
    undo,
    redo,
    canUndo,
    canRedo,
    saveDocument,
    discardChanges,
    hasRecoverableDraft,
    draftSavedAt,
    recoverDraft,
    dismissDraftRecovery,
  } = useAnnotationEditor({
    caseId,
    userId,
    source: previewKind,
    onSaveSuccess: () => {
      if (isVersionsOpen) void loadVersions();
    },
  });

  // Camera preset view angles
  const setCameraView = (view: 'top' | 'front' | 'left' | 'right' | 'reset') => {
    if (!orbitControlsRef.current) return;
    const controls = orbitControlsRef.current;
    const distance = Math.max(modelBounds?.radius ?? 20, 1) * 2.4;
    const center = modelBounds?.center ?? { x: 0, y: 0, z: 0 };

    switch (view) {
      case 'top':
        controls.object.position.set(center.x, center.y + distance, center.z + 0.001);
        break;
      case 'front':
        controls.object.position.set(center.x, center.y + distance * 0.15, center.z + distance);
        break;
      case 'left':
        controls.object.position.set(center.x - distance, center.y + distance * 0.15, center.z);
        break;
      case 'right':
        controls.object.position.set(center.x + distance, center.y + distance * 0.15, center.z);
        break;
      case 'reset':
        controls.object.position.set(center.x + distance * 0.16, center.y + distance * 0.38, center.z + distance);
        controls.target.set(center.x, center.y, center.z);
        break;
    }
    controls.update();
  };

  const handleRequestPinText = useCallback((point: Vector3D, normal?: Vector3D) => {
    setPinDialogPoint({ point, normal });
    setPinTitle('');
    setPinText('');
  }, []);

  const handleCreatePin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pinDialogPoint || !pinText.trim()) return;

    addAnnotation({
      id: `pin-${Date.now()}`,
      layerId: activeLayerId,
      type: 'pin',
      color: activeColor,
      createdAt: new Date().toISOString(),
      position: pinDialogPoint.point,
      normal: pinDialogPoint.normal,
      title: pinTitle.trim() || undefined,
      text: pinText.trim(),
    });

    setPinDialogPoint(null);
    setPinTitle('');
    setPinText('');
  };

  const loadVersions = async () => {
    setIsLoadingVersions(true);
    try {
      const res = await fetch(`/api/cases/${caseId}/annotations/versions`);
      if (res.ok) {
        const data = await res.json();
        setVersionsList(data.versions || []);
      }
    } catch (err) {
      console.error('Failed to load version history:', err);
    } finally {
      setIsLoadingVersions(false);
    }
  };

  const activeLayer = layers.find((l) => l.id === activeLayerId) || layers[0];
  const activeToolHint = ALL_TOOLS.find((t) => t.id === activeTool)?.hint;

  useEffect(() => {
    if (!isFullScreen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isFullScreen]);

  // Markup shortcuts: tools, undo/redo, and [ / ] to change stroke thickness
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      if (pinDialogPoint) return;

      const key = event.key.toLowerCase();
      if (event.ctrlKey || event.metaKey) {
        if (key === 'z' && !event.shiftKey) {
          event.preventDefault();
          undo();
        } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
          event.preventDefault();
          redo();
        }
        return;
      }
      if (event.altKey) return;

      if (event.key === '[') setStrokeWidth((w) => Math.max(MIN_STROKE_WIDTH, w - 1));
      else if (event.key === ']') setStrokeWidth((w) => Math.min(MAX_STROKE_WIDTH, w + 1));
      else {
        const tool = ALL_TOOLS.find((t) => t.shortcut === key);
        if (tool) setActiveTool(tool.id);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pinDialogPoint, undo, redo, setStrokeWidth, setActiveTool]);

  useEffect(() => {
    if (!isFullScreen || !onClose) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (saveStatus === 'dirty' && !confirm('You have unsaved changes. Exit anyway?')) return;
      onClose();
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isFullScreen, onClose, saveStatus]);

  return (
    <div
      role="dialog"
      aria-modal={isFullScreen}
      aria-label="3D CAD case viewer"
      className={`relative flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden select-none font-sans ${
        isFullScreen
          ? 'fixed inset-0 z-50 w-screen h-screen'
          : 'w-full h-[650px] rounded-xl border border-zinc-800 shadow-2xl'
      }`}
    >
      {/* ---------------------------------------------------------------- */}
      {/* Top Header Bar                                                   */}
      {/* ---------------------------------------------------------------- */}
      <header className="flex items-center justify-between px-4 py-2.5 bg-zinc-900/95 border-b border-zinc-800 backdrop-blur z-20 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-bold text-sm tracking-wide text-zinc-100 whitespace-nowrap">
              3D Preview
            </span>
            {caseNumber && (
              <span className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono whitespace-nowrap">
                Case #{caseNumber}
              </span>
            )}
            {activeSource && (
              <>
                <span
                  className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${previewMeta.badgeClass}`}
                  title={previewMeta.description}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${previewMeta.dotClass}`} />
                  {previewMeta.label}
                </span>
                <span className="text-xs text-zinc-400 truncate max-w-[220px]" title={activeSource.fileName}>
                  {activeSource.fileName}
                </span>
              </>
            )}
          </div>

          <div className="h-4 w-[1px] bg-zinc-700 mx-1" />

          {/* Revision badge */}
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-950 text-indigo-300 border border-indigo-800">
            Rev {lastSavedRevision}
          </span>

          {/* Save Status Badge */}
          {saveStatus === 'saved' && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 bg-emerald-950/60 px-2.5 py-0.5 rounded-full border border-emerald-800/80">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Saved
            </span>
          )}

          {saveStatus === 'dirty' && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400 bg-amber-950/60 px-2.5 py-0.5 rounded-full border border-amber-800/80">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              Unsaved changes
            </span>
          )}

          {saveStatus === 'saving' && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-400 bg-blue-950/60 px-2.5 py-0.5 rounded-full border border-blue-800/80">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              Saving to database…
            </span>
          )}

          {saveStatus === 'error' && (
            <span
              className="inline-flex items-center gap-1.5 text-xs font-medium text-red-400 bg-red-950/60 px-2.5 py-0.5 rounded-full border border-red-800/80 cursor-help"
              title={saveError || 'Save failed'}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              Save failed
            </span>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          {/* Discard changes */}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (saveStatus === 'dirty') {
                if (confirm('Discard all unsaved edits and restore the last saved version from the database?')) {
                  discardChanges();
                }
              }
            }}
            disabled={saveStatus !== 'dirty'}
            className="text-xs text-zinc-300 hover:text-white hover:bg-zinc-800"
            title="Discard unsaved changes"
          >
            <RotateCcw className="w-3.5 h-3.5 mr-1" />
            Discard
          </Button>

          {/* Explicit Save Button */}
          <Button
            size="sm"
            onClick={() => void saveDocument()}
            disabled={saveStatus === 'saving'}
            className={`text-xs font-semibold px-4 transition-all shadow ${
              saveStatus === 'dirty'
                ? 'bg-blue-600 hover:bg-blue-500 text-white animate-pulse'
                : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200'
            }`}
          >
            {saveStatus === 'saving' ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Save className="w-3.5 h-3.5 mr-1.5" />
                Save Annotations
              </>
            )}
          </Button>

          <div className="h-4 w-[1px] bg-zinc-700 mx-1" />

          {/* Versions modal trigger */}
          <button
            type="button"
            onClick={() => {
              setIsVersionsOpen(true);
              void loadVersions();
            }}
            className="p-1.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
            title="Audit / Version History"
          >
            <History className="w-4 h-4" />
          </button>

          {/* Layer toggle button */}
          <button
            type="button"
            onClick={() => setIsLayersOpen((prev) => !prev)}
            className={`p-1.5 rounded transition-colors ${
              isLayersOpen ? 'text-blue-400 bg-blue-950/60' : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'
            }`}
            title="Toggle Layers & Annotations Panel"
          >
            <Layers className="w-4 h-4" />
          </button>

          {/* Fullscreen toggle */}
          <button
            type="button"
            onClick={() => setIsFullScreen((prev) => !prev)}
            className="p-1.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
            title={isFullScreen ? 'Exit Fullscreen' : 'Fullscreen'}
          >
            {isFullScreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>

          {/* Close button */}
          {onClose && (
            <button
              type="button"
              onClick={() => {
                if (saveStatus === 'dirty') {
                  if (!confirm('You have unsaved changes. Exit anyway?')) return;
                }
                onClose();
              }}
              className="p-1.5 rounded text-zinc-400 hover:text-red-400 hover:bg-zinc-800 transition-colors ml-1"
              title="Close 3D Viewer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      {/* ---------------------------------------------------------------- */}
      {/* Preview Source Switcher (case submission ↔ design output)        */}
      {/* ---------------------------------------------------------------- */}
      {sources.length > 1 && (
        <div
          role="tablist"
          aria-label="Choose which 3D files to preview"
          className="flex items-center gap-1.5 px-4 py-1.5 bg-zinc-900/80 border-b border-zinc-800 overflow-x-auto shrink-0 z-20"
        >
          {sources.map((source) => {
            const meta = PREVIEW_KIND_META[source.kind];
            const selected = source.id === activeSource?.id;
            const request = { url: source.url, fileName: source.fileName, purpose: source.kind };
            return (
              <button
                key={source.id}
                type="button"
                role="tab"
                aria-selected={selected}
                title={`${meta.description}\n${source.fileName}`}
                onClick={() => {
                  setActiveSourceId(source.id);
                  setSelectedAnnotationId(null);
                }}
                // Warm the cache on intent so the switch is instant
                onPointerEnter={() => prefetchModel(request)}
                onFocus={() => prefetchModel(request)}
                className={`flex items-center gap-2 px-3 py-1 rounded-lg text-xs whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
                  selected ? 'bg-zinc-800 text-zinc-100 ring-1 ring-zinc-600' : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${meta.dotClass}`} />
                <span className="font-semibold">{meta.label}</span>
                <span className="text-zinc-500">·</span>
                <span>{source.title}</span>
              </button>
            );
          })}
          <span className="ml-auto pl-3 text-[11px] text-zinc-500 whitespace-nowrap hidden md:inline">
            Markup is saved separately for each preview
          </span>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Draft Recovery Alert Banner                                      */}
      {/* ---------------------------------------------------------------- */}
      {hasRecoverableDraft && (
        <div className="flex items-center justify-between px-4 py-2 bg-amber-950/90 border-b border-amber-800 text-amber-200 text-xs z-20">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              Unsaved local draft detected from a previous session
              {draftSavedAt ? ` (${new Date(draftSavedAt).toLocaleTimeString()})` : ''}.
              Restore your work or start fresh?
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={recoverDraft}
              className="px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold rounded shadow transition-colors"
            >
              Recover Draft
            </button>
            <button
              type="button"
              onClick={dismissDraftRecovery}
              className="px-2 py-1 text-amber-300 hover:text-white transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Main Viewport & Floating Controls                                */}
      {/* ---------------------------------------------------------------- */}
      <div className="relative flex-1 w-full h-full overflow-hidden">
        {modelLoadError && (
          <div
            role="alert"
            className="absolute top-4 left-1/2 -translate-x-1/2 z-20 max-w-[min(90%,40rem)] rounded-lg border border-amber-700 bg-amber-950/95 px-4 py-3 text-sm text-amber-100 shadow-lg"
          >
            {modelLoadError}
          </div>
        )}
        {modelLoadProgress && (
          <div
            role="status"
            aria-live="polite"
            className="absolute top-4 left-1/2 -translate-x-1/2 z-20 w-[min(90%,24rem)] rounded-xl border border-zinc-700 bg-zinc-900/95 px-4 py-3 text-sm text-zinc-100 shadow-xl backdrop-blur"
          >
            <div className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4 shrink-0 animate-spin text-blue-400" />
              <span className="font-medium">
                {modelLoadProgress.totalBytes && modelLoadProgress.loadedBytes >= modelLoadProgress.totalBytes
                  ? `Preparing ${previewMeta.label}…`
                  : `Loading ${previewMeta.label}`}
              </span>
              <span className="ml-auto text-xs tabular-nums text-zinc-400">
                {modelLoadProgress.totalBytes
                  ? `${Math.min(100, Math.round((modelLoadProgress.loadedBytes / modelLoadProgress.totalBytes) * 100))}%`
                  : `${(modelLoadProgress.loadedBytes / (1024 * 1024)).toFixed(0)} MB`}
              </span>
            </div>
            {modelLoadProgress.totalBytes && (
              <div
                className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-700"
                role="progressbar"
                aria-label="3D scan download progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.min(100, Math.round((modelLoadProgress.loadedBytes / modelLoadProgress.totalBytes) * 100))}
              >
                <div
                  className="h-full rounded-full bg-blue-500 transition-[width]"
                  style={{ width: `${Math.min(100, (modelLoadProgress.loadedBytes / modelLoadProgress.totalBytes) * 100)}%` }}
                />
              </div>
            )}
          </div>
        )}
        {/* Floating Left Toolbar */}
        <div className="absolute left-3 top-3 z-10 flex flex-col gap-1.5 p-1.5 bg-zinc-900/90 border border-zinc-800 rounded-xl shadow-xl backdrop-blur">
          {TOOL_GROUPS.map((group, groupIndex) => (
            <React.Fragment key={groupIndex}>
              {groupIndex > 0 && <div className="h-[1px] bg-zinc-700 my-0.5" />}
              {group.map((tool) => (
                <ToolbarButton
                  key={tool.id}
                  icon={tool.icon}
                  label={`${tool.label} (${tool.shortcut.toUpperCase()})`}
                  active={activeTool === tool.id}
                  onClick={() => setActiveTool(tool.id)}
                />
              ))}
            </React.Fragment>
          ))}
          <div className="h-[1px] bg-zinc-700 my-1" />

          {/* Current stroke style — opens the brush to edit it */}
          <button
            type="button"
            title={`Stroke: ${activeColor}, ${strokeWidth}px`}
            aria-label="Current stroke style"
            onClick={() => activeTool === 'orbit' && setActiveTool('brush')}
            className="w-8 h-8 mx-auto rounded-lg flex items-center justify-center hover:bg-zinc-800"
          >
            <span
              className="rounded-full ring-1 ring-white/30"
              style={{
                width: Math.min(22, Math.max(6, strokeWidth * 1.6)),
                height: Math.min(22, Math.max(6, strokeWidth * 1.6)),
                backgroundColor: activeColor,
              }}
            />
          </button>

          <div className="h-[1px] bg-zinc-700 my-1" />

          {/* Undo / Redo */}
          <ToolbarButton
            icon={<Undo2 className="w-4 h-4" />}
            label="Undo (Ctrl+Z)"
            disabled={!canUndo}
            onClick={undo}
          />
          <ToolbarButton
            icon={<Redo2 className="w-4 h-4" />}
            label="Redo (Ctrl+Y)"
            disabled={!canRedo}
            onClick={redo}
          />
        </div>

        {/* Contextual how-to for the active tool */}
        {activeToolHint && (
          <div
            role="status"
            className="absolute bottom-14 left-1/2 -translate-x-1/2 z-10 max-w-[min(90%,40rem)] px-3 py-1.5 rounded-full bg-zinc-900/90 border border-zinc-800 text-[11px] text-zinc-300 shadow-lg backdrop-blur text-center"
          >
            {activeToolHint} · Esc to cancel
          </div>
        )}

        {/* Stroke style bar for markup tools */}
        {STYLED_TOOLS.has(activeTool) && (
          <div className={`absolute left-16 top-3 z-10 overflow-x-auto ${isLayersOpen ? 'max-w-[calc(100%-24rem)]' : 'max-w-[calc(100%-5rem)]'}`}>
            <DrawingStylePanel
              color={activeColor}
              width={strokeWidth}
              onColorChange={setActiveColor}
              onWidthChange={setStrokeWidth}
            />
          </div>
        )}

        {/* Floating Bottom View Presets & Settings */}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900/90 border border-zinc-800 rounded-full shadow-xl backdrop-blur text-xs">
          <span className="text-[10px] text-zinc-400 font-semibold uppercase mr-1">View</span>
          <button
            type="button"
            onClick={() => setCameraView('top')}
            className="px-2 py-0.5 rounded hover:bg-zinc-800 text-zinc-300"
          >
            Top
          </button>
          <button
            type="button"
            onClick={() => setCameraView('front')}
            className="px-2 py-0.5 rounded hover:bg-zinc-800 text-zinc-300"
          >
            Front
          </button>
          <button
            type="button"
            onClick={() => setCameraView('left')}
            className="px-2 py-0.5 rounded hover:bg-zinc-800 text-zinc-300"
          >
            Left
          </button>
          <button
            type="button"
            onClick={() => setCameraView('right')}
            className="px-2 py-0.5 rounded hover:bg-zinc-800 text-zinc-300"
          >
            Right
          </button>
          <button
            type="button"
            onClick={() => setCameraView('reset')}
            className="px-2 py-0.5 rounded hover:bg-zinc-800 text-zinc-300"
          >
            Reset
          </button>

          <div className="h-3 w-[1px] bg-zinc-700 mx-1" />

          {/* Wireframe toggle */}
          <button
            type="button"
            onClick={() => setWireframe((w) => !w)}
            className={`px-2 py-0.5 rounded transition-colors ${
              wireframe ? 'bg-indigo-600 text-white' : 'hover:bg-zinc-800 text-zinc-400'
            }`}
          >
            Wireframe
          </button>

          {/* Shading toggle */}
          <button
            type="button"
            onClick={() =>
              setMaterialMode((m) => (m === 'enamel' ? 'clay' : m === 'clay' ? 'normal' : 'enamel'))
            }
            className="px-2 py-0.5 rounded hover:bg-zinc-800 text-zinc-300 uppercase text-[10px] font-mono"
            title="Toggle Material: Enamel -> Clay -> Normal"
          >
            {materialMode}
          </button>

          <div className="h-3 w-[1px] bg-zinc-700 mx-1" />

          {/* Opacity slider */}
          <div className="flex items-center gap-1.5 px-1">
            <span className="text-[10px] text-zinc-400">Opacity</span>
            <input
              type="range"
              min="0.1"
              max="1"
              step="0.05"
              value={modelOpacity}
              onChange={(e) => setModelOpacity(parseFloat(e.target.value))}
              className="w-16 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
          </div>
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* Right Collapsible Layer & Annotation Manager                     */}
        {/* ---------------------------------------------------------------- */}
        {isLayersOpen && (
          <aside className="absolute right-3 top-3 bottom-3 z-10 w-72 bg-zinc-900/95 border border-zinc-800 rounded-xl shadow-2xl backdrop-blur flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
                <Layers className="w-3.5 h-3.5 text-blue-400" />
                <span>Layers & Markup</span>
              </div>
              <button
                type="button"
                onClick={() => addLayer()}
                className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium shadow"
              >
                <Plus className="w-3 h-3" /> Add Layer
              </button>
            </div>

            <section className="shrink-0 border-b border-zinc-800 px-3 py-3" aria-label="Scan components">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                  <Eye className="h-3.5 w-3.5" />
                  <span>Scan components</span>
                  {scanFiles.length > 0 && (
                    <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 text-[10px] tabular-nums text-zinc-300">
                      {scanFiles.length}
                    </span>
                  )}
                </div>
                {scanFiles.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const allVisible = scanFiles.every((file) => scanVisibility[file.name] !== false);
                      setScanVisibility(Object.fromEntries(scanFiles.map(({ name }) => [name, !allVisible])));
                    }}
                    className="text-[10px] font-medium text-blue-300 hover:text-blue-200"
                  >
                    {scanFiles.every((file) => scanVisibility[file.name] !== false) ? 'Hide all' : 'Show all'}
                  </button>
                )}
              </div>
              {scanFiles.length === 0 ? (
                <p className="text-[11px] text-zinc-500">
                  {modelLoadProgress ? 'Loading scan objects…' : 'No separate scan components for this model.'}
                </p>
              ) : (
                <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
                  {scanFiles.map((file) => {
                    const visible = scanVisibility[file.name] !== false;
                    const label = file.name.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) || file.name;
                    return (
                      <button
                        key={file.name}
                        type="button"
                        aria-pressed={visible}
                        onClick={() => setScanVisibility((current) => ({ ...current, [file.name]: !visible }))}
                        className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors ${
                          visible
                            ? 'border-zinc-700 bg-zinc-800/80 text-zinc-200 hover:bg-zinc-800'
                            : 'border-transparent bg-zinc-950/50 text-zinc-500 hover:bg-zinc-800/60'
                        }`}
                        title={`${file.name} · ${file.vertices.toLocaleString()} vertices · ${file.triangles.toLocaleString()} triangles`}
                      >
                        {visible ? (
                          <Eye className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                        ) : (
                          <EyeOff className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
                        )}
                        <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: file.color }} />
                        <span className="min-w-0 flex-1 truncate text-[11px]">{label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Layer List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {layers.map((layer) => {
                const isActive = layer.id === activeLayerId;

                return (
                  <div
                    key={layer.id}
                    onClick={() => setActiveLayerId(layer.id)}
                    className={`p-2 rounded-lg border text-xs transition-all cursor-pointer ${
                      isActive
                        ? 'bg-zinc-800/90 border-blue-500/80 shadow'
                        : 'bg-zinc-900/70 border-zinc-800 hover:border-zinc-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1 mb-1.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: layer.color }}
                        />
                        <span className="font-semibold text-zinc-200 truncate">
                          {layer.name}
                        </span>
                        <span className="text-[10px] text-zinc-500 font-mono">
                          ({layer.annotations.length})
                        </span>
                      </div>

                      <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                        {/* Visibility Toggle */}
                        <button
                          type="button"
                          onClick={() => updateLayer(layer.id, { visible: !layer.visible })}
                          className={`p-1 rounded hover:bg-zinc-700 ${
                            layer.visible ? 'text-zinc-300' : 'text-zinc-600'
                          }`}
                          title={layer.visible ? 'Hide layer' : 'Show layer'}
                        >
                          {layer.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                        </button>

                        {/* Lock Toggle */}
                        <button
                          type="button"
                          onClick={() => updateLayer(layer.id, { locked: !layer.locked })}
                          className={`p-1 rounded hover:bg-zinc-700 ${
                            layer.locked ? 'text-amber-400' : 'text-zinc-600'
                          }`}
                          title={layer.locked ? 'Unlock layer' : 'Lock layer'}
                        >
                          {layer.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                        </button>

                        {/* Delete layer */}
                        {layers.length > 1 && (
                          <button
                            type="button"
                            onClick={() => deleteLayer(layer.id)}
                            className="p-1 rounded hover:bg-red-950 text-zinc-500 hover:text-red-400"
                            title="Delete layer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Opacity Slider */}
                    <div className="flex items-center gap-2 mt-1" onClick={(e) => e.stopPropagation()}>
                      <span className="text-[10px] text-zinc-500">Opacity</span>
                      <input
                        type="range"
                        min="0.1"
                        max="1"
                        step="0.05"
                        value={layer.opacity ?? 1}
                        onChange={(e) => updateLayer(layer.id, { opacity: parseFloat(e.target.value) })}
                        className="w-full h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                      />
                    </div>
                  </div>
                );
              })}

              {/* Annotations under the currently active layer */}
              {activeLayer && activeLayer.annotations.length > 0 && (
                <div className="pt-2 border-t border-zinc-800">
                  <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider block mb-1">
                    Annotations in {activeLayer.name}
                  </span>
                  <div className="space-y-1">
                    {activeLayer.annotations.map((ann) => {
                      const isSelected = selectedAnnotationId === ann.id;

                      return (
                        <div
                          key={ann.id}
                          onClick={() => setSelectedAnnotationId(ann.id)}
                          className={`flex items-center justify-between p-1.5 rounded text-[11px] cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-blue-950/80 text-blue-200 border border-blue-600'
                              : 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
                          }`}
                        >
                          <div className="flex items-center gap-1.5 truncate">
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: ann.color || activeLayer.color }}
                            />
                            {ann.type === 'brush' &&
                              (ann.style === 'highlighter' ? (
                                <Highlighter className="w-3 h-3 text-zinc-400" />
                              ) : (
                                <Paintbrush className="w-3 h-3 text-zinc-400" />
                              ))}
                            {ann.type === 'polyline' && <Spline className="w-3 h-3 text-zinc-400" />}
                            {ann.type === 'distance' && <Ruler className="w-3 h-3 text-zinc-400" />}
                            {ann.type === 'angle' && <DraftingCompass className="w-3 h-3 text-zinc-400" />}
                            {ann.type === 'pin' && <MapPin className="w-3 h-3 text-zinc-400" />}
                            {ann.type === 'arrow' && <MoveRight className="w-3 h-3 text-zinc-400" />}
                            <span className="truncate">
                              {ann.type === 'distance'
                                ? `${ann.distanceMm.toFixed(2)} mm`
                                : ann.type === 'angle'
                                ? `Angle ${ann.angleDeg.toFixed(1)}°`
                                : ann.type === 'polyline'
                                ? `${ann.closed ? 'Outline' : 'Line'} ${ann.lengthMm.toFixed(1)} mm`
                                : ann.type === 'pin'
                                ? ann.title || ann.text.slice(0, 15)
                                : ann.type === 'brush'
                                ? ann.style === 'highlighter' ? 'Highlight' : 'Freehand stroke'
                                : 'Arrow'}
                            </span>
                          </div>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteAnnotation(ann.id);
                            }}
                            className="p-1 hover:text-red-400 text-zinc-500"
                            title="Delete annotation"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </aside>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Three.js R3F 3D Canvas                                           */}
        {/* ---------------------------------------------------------------- */}
        <Canvas
          dpr={[1, 1.75]}
          shadows
          className={`w-full h-full ${activeTool === 'orbit' ? 'cursor-grab' : 'cursor-crosshair'}`}
          // Stencil buffer lets translucent highlighter strokes render evenly (see markup-materials.ts)
          gl={{ antialias: true, stencil: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' }}
        >
          <PerspectiveCamera makeDefault position={[0, 20, 35]} fov={45} />
          <color attach="background" args={['#171d2b']} />
          <OrbitControls
            ref={orbitControlsRef as never}
            makeDefault
            enableDamping
            dampingFactor={0.08}
            minDistance={2}
            maxDistance={modelBounds ? modelBounds.radius * 12 : 200}
          />
            <ModelCameraFraming bounds={modelBounds} controlsRef={orbitControlsRef} />

          {/* Lighting */}
          <ambientLight intensity={0.85} />
          <directionalLight position={[12, 18, 12]} intensity={1.65} />
          <directionalLight position={[-12, 8, -10]} intensity={0.75} />
          <hemisphereLight intensity={0.65} groundColor="#444" />

          {/* Dental Mesh */}
          <ModelMesh
            modelUrl={activeSource?.url}
            fileName={activeSource?.fileName}
            purpose={previewKind}
            wireframe={wireframe}
            materialMode={materialMode}
            opacity={modelOpacity}
            onLoadError={setModelLoadError}
            onLoadProgress={handleModelLoadProgress}
            visibleScanFiles={scanVisibility}
            onScanFilesChange={handleScanFilesChange}
            onModelBoundsChange={setModelBounds}
          />

          {/* Render Persistent Markup & Annotations */}
          <AnnotationRenderer
            layers={layers}
            selectedId={selectedAnnotationId}
            onSelect={setSelectedAnnotationId}
            onDelete={deleteAnnotation}
            isErasing={activeTool === 'eraser'}
          />

          {/* Active Drawing Tool Interactivity */}
          <DrawingInteraction
            activeTool={activeTool}
            activeColor={activeColor}
            strokeWidth={strokeWidth}
            activeLayerId={activeLayerId}
            onAddAnnotation={addAnnotation}
            onRequestPinText={handleRequestPinText}
            orbitControlsRef={orbitControlsRef as never}
          />
        </Canvas>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Comment Pin Creation Dialog                                      */}
      {/* ---------------------------------------------------------------- */}
      {pinDialogPoint && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <form
            onSubmit={handleCreatePin}
            className="w-full max-w-sm bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-4 text-zinc-100"
          >
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
              <MapPin className="w-4 h-4 text-blue-400" /> Add QC / Designer Review Pin
            </h3>
            <div className="space-y-3 mb-4">
              <div>
                <label className="text-[11px] text-zinc-400 block mb-1">Pin Title (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Margin gap or undercut"
                  value={pinTitle}
                  onChange={(e) => setPinTitle(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-100 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="text-[11px] text-zinc-400 block mb-1">Notes / Instructions *</label>
                <textarea
                  rows={3}
                  required
                  placeholder="Describe necessary correction or anatomical note…"
                  value={pinText}
                  onChange={(e) => setPinText(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-100 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPinDialogPoint(null)}
                className="px-3 py-1.5 rounded text-xs text-zinc-400 hover:text-white"
              >
                Cancel
              </button>
              <Button type="submit" size="sm" className="bg-blue-600 hover:bg-blue-500 text-white text-xs">
                Place Pin
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Version History Modal                                            */}
      {/* ---------------------------------------------------------------- */}
      {isVersionsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-4 text-zinc-100 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-indigo-400" />
                <h3 className="text-sm font-semibold">Annotation Revision History</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsVersionsOpen(false)}
                className="text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-3 space-y-2">
              {isLoadingVersions ? (
                <div className="text-center py-6 text-xs text-zinc-400">Loading audit history…</div>
              ) : versionsList.length === 0 ? (
                <div className="text-center py-6 text-xs text-zinc-500">
                  No previous saved revisions recorded yet.
                </div>
              ) : (
                versionsList.map((ver) => (
                  <div
                    key={ver.id}
                    className="p-2.5 rounded-lg border border-zinc-800 bg-zinc-800/40 text-xs flex items-center justify-between"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-indigo-400">Revision {ver.revision}</span>
                        {ver.revision === lastSavedRevision && (
                          <span className="text-[10px] bg-emerald-950 text-emerald-400 px-1.5 py-0.2 rounded border border-emerald-800">
                            Current
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-zinc-400 mt-0.5">
                        Saved by {ver.savedBy} • {new Date(ver.savedAt).toLocaleString()}
                      </div>
                    </div>
                    <div className="text-right text-[11px] text-zinc-400 font-mono">
                      {ver.layerCount} layers • {ver.annotationCount} marks
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="pt-3 border-t border-zinc-800 text-right">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setIsVersionsOpen(false)}
                className="text-xs"
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ToolbarButton({
  icon,
  label,
  active = false,
  disabled = false,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`p-2 rounded-lg transition-colors flex items-center justify-center ${
        disabled
          ? 'opacity-30 cursor-not-allowed text-zinc-500'
          : active
          ? 'bg-blue-600 text-white shadow'
          : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'
      }`}
    >
      {icon}
    </button>
  );
}
