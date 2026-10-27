'use client';

import React, { useState, useRef, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import {
  Save,
  RotateCcw,
  Undo2,
  Redo2,
  Paintbrush,
  Ruler,
  MapPin,
  MoveRight,
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
  Sliders,
} from 'lucide-react';
import { useAnnotationEditor } from '@/src/lib/hooks/useAnnotationEditor';
import { ModelMesh } from './ModelMesh';
import { AnnotationRenderer } from './AnnotationRenderer';
import { DrawingInteraction } from './DrawingInteraction';
import type { ToolMode, Vector3D, AnnotationVersionItem } from '@/src/types/annotation';
import { Button } from '@/src/components/ui/button';

interface Dental3DViewerProps {
  caseId: string;
  caseNumber?: string;
  modelUrl?: string | null;
  fileName?: string;
  userId?: string;
  onClose?: () => void;
  isFullScreenDefault?: boolean;
}

const PRESET_COLORS = [
  '#ef4444', // Red
  '#3b82f6', // Blue
  '#10b981', // Green
  '#f59e0b', // Amber
  '#8b5cf6', // Purple
  '#06b6d4', // Cyan
];

export function Dental3DViewer({
  caseId,
  caseNumber,
  modelUrl,
  fileName,
  userId,
  onClose,
  isFullScreenDefault = false,
}: Dental3DViewerProps) {
  const [isFullScreen, setIsFullScreen] = useState(isFullScreenDefault);
  const [isLayersOpen, setIsLayersOpen] = useState(true);
  const [isVersionsOpen, setIsVersionsOpen] = useState(false);
  const [versionsList, setVersionsList] = useState<AnnotationVersionItem[]>([]);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);

  // Model rendering preferences
  const [wireframe, setWireframe] = useState(false);
  const [materialMode, setMaterialMode] = useState<'enamel' | 'clay' | 'normal'>('enamel');
  const [modelOpacity, setModelOpacity] = useState(1.0);

  // Pin text input dialog
  const [pinDialogPoint, setPinDialogPoint] = useState<{ point: Vector3D; normal?: Vector3D } | null>(null);
  const [pinTitle, setPinTitle] = useState('');
  const [pinText, setPinText] = useState('');

  const orbitControlsRef = useRef<any>(null);

  const {
    document: doc,
    saveStatus,
    lastSavedRevision,
    lastSavedAt,
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
    onSaveSuccess: () => {
      // Refresh version history if modal is open
      if (isVersionsOpen) void loadVersions();
    },
  });

  // Camera preset view angles
  const setCameraView = (view: 'top' | 'front' | 'left' | 'right' | 'reset') => {
    if (!orbitControlsRef.current) return;
    const controls = orbitControlsRef.current;

    switch (view) {
      case 'top':
        controls.object.position.set(0, 45, 0.001);
        break;
      case 'front':
        controls.object.position.set(0, 0, 45);
        break;
      case 'left':
        controls.object.position.set(-45, 0, 0);
        break;
      case 'right':
        controls.object.position.set(45, 0, 0);
        break;
      case 'reset':
        controls.object.position.set(0, 20, 35);
        controls.target.set(0, 0, 0);
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

  const activeLayer = doc.layers.find((l) => l.id === activeLayerId) || doc.layers[0];

  return (
    <div
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
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm tracking-wide text-zinc-100">
              3D CAD QC Preview
            </span>
            {caseNumber && (
              <span className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono">
                Case #{caseNumber}
              </span>
            )}
            {fileName && (
              <span className="text-xs text-zinc-400 truncate max-w-[180px]" title={fileName}>
                {fileName}
              </span>
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
        {/* Floating Left Toolbar */}
        <div className="absolute left-3 top-3 z-10 flex flex-col gap-1.5 p-1.5 bg-zinc-900/90 border border-zinc-800 rounded-xl shadow-xl backdrop-blur">
          {/* Orbit Navigation Tool */}
          <ToolbarButton
            icon={<Camera className="w-4 h-4" />}
            label="Orbit & Pan (Camera)"
            active={activeTool === 'orbit'}
            onClick={() => setActiveTool('orbit')}
          />

          {/* 3D Brush Drawing Tool */}
          <ToolbarButton
            icon={<Paintbrush className="w-4 h-4" />}
            label="3D Surface Brush / Freehand"
            active={activeTool === 'brush'}
            onClick={() => setActiveTool('brush')}
          />

          {/* Distance Measurement Tool */}
          <ToolbarButton
            icon={<Ruler className="w-4 h-4" />}
            label="Distance Measurement (mm)"
            active={activeTool === 'distance'}
            onClick={() => setActiveTool('distance')}
          />

          {/* Comment Pin Tool */}
          <ToolbarButton
            icon={<MapPin className="w-4 h-4" />}
            label="Drop Comment Pin"
            active={activeTool === 'pin'}
            onClick={() => setActiveTool('pin')}
          />

          {/* Arrow Pointer Tool */}
          <ToolbarButton
            icon={<MoveRight className="w-4 h-4" />}
            label="Arrow Pointer"
            active={activeTool === 'arrow'}
            onClick={() => setActiveTool('arrow')}
          />

          <div className="h-[1px] bg-zinc-700 my-1" />

          {/* Color Palettes */}
          <div className="flex flex-col gap-1 items-center px-1 py-1">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setActiveColor(c)}
                className={`w-4 h-4 rounded-full transition-transform ${
                  activeColor === c ? 'scale-125 ring-2 ring-white' : 'hover:scale-110 opacity-80'
                }`}
                style={{ backgroundColor: c }}
                title={`Select color ${c}`}
              />
            ))}
          </div>

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

            {/* Layer List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {doc.layers.map((layer) => {
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
                        {doc.layers.length > 1 && (
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
                            {ann.type === 'brush' && <Paintbrush className="w-3 h-3 text-zinc-400" />}
                            {ann.type === 'distance' && <Ruler className="w-3 h-3 text-zinc-400" />}
                            {ann.type === 'pin' && <MapPin className="w-3 h-3 text-zinc-400" />}
                            {ann.type === 'arrow' && <MoveRight className="w-3 h-3 text-zinc-400" />}
                            <span className="truncate">
                              {ann.type === 'distance'
                                ? `${ann.distanceMm.toFixed(2)} mm`
                                : ann.type === 'pin'
                                ? ann.title || ann.text.slice(0, 15)
                                : `${ann.type} markup`}
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
          shadows
          className="w-full h-full cursor-crosshair"
          gl={{ antialias: true, preserveDrawingBuffer: true }}
        >
          <PerspectiveCamera makeDefault position={[0, 20, 35]} fov={45} />
          <OrbitControls
            ref={orbitControlsRef}
            makeDefault
            enableDamping
            dampingFactor={0.08}
            minDistance={2}
            maxDistance={200}
          />

          {/* Lighting */}
          <ambientLight intensity={0.7} />
          <directionalLight position={[10, 20, 15]} intensity={1.2} castShadow />
          <directionalLight position={[-10, 10, -10]} intensity={0.6} />
          <hemisphereLight intensity={0.4} groundColor="#222" />

          {/* Dental Mesh */}
          <ModelMesh
            modelUrl={modelUrl}
            wireframe={wireframe}
            materialMode={materialMode}
            opacity={modelOpacity}
          />

          {/* Render Persistent Markup & Annotations */}
          <AnnotationRenderer
            layers={doc.layers}
            selectedId={selectedAnnotationId}
            onSelect={setSelectedAnnotationId}
            onDelete={deleteAnnotation}
          />

          {/* Active Drawing Tool Interactivity */}
          <DrawingInteraction
            activeTool={activeTool}
            activeColor={activeColor}
            strokeWidth={strokeWidth}
            activeLayerId={activeLayerId}
            onAddAnnotation={addAnnotation}
            onRequestPinText={handleRequestPinText}
            orbitControlsRef={orbitControlsRef}
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
