/**
 * 3D Dental CAD / DICOM Platform — Annotation & Explicit Save Data Types
 * Document Version: 2.0
 */

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error';

export type ToolMode =
  | 'orbit'
  | 'brush'
  | 'distance'
  | 'pin'
  | 'arrow'
  | 'select';

export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

export interface BaseAnnotation {
  id: string;
  layerId: string;
  type: 'brush' | 'distance' | 'pin' | 'arrow';
  color: string;
  lineWidth?: number;
  createdAt: string;
  authorRole?: string;
  authorName?: string;
}

export interface BrushAnnotation extends BaseAnnotation {
  type: 'brush';
  points: Vector3D[]; // Model-space 3D coordinates
}

export interface DistanceAnnotation extends BaseAnnotation {
  type: 'distance';
  startPoint: Vector3D;
  endPoint: Vector3D;
  distanceMm: number;
  label?: string;
}

export interface PinAnnotation extends BaseAnnotation {
  type: 'pin';
  position: Vector3D;
  normal?: Vector3D;
  text: string;
  title?: string;
  resolved?: boolean;
}

export interface ArrowAnnotation extends BaseAnnotation {
  type: 'arrow';
  startPoint: Vector3D;
  endPoint: Vector3D;
  label?: string;
}

export type AnnotationItem =
  | BrushAnnotation
  | DistanceAnnotation
  | PinAnnotation
  | ArrowAnnotation;

export interface AnnotationLayer {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  annotations: AnnotationItem[];
}

export interface AnnotationDocument {
  id: string;
  caseId: string;
  schemaVersion: number;
  revision: number;
  layers: AnnotationLayer[];
  createdAt?: string;
  updatedAt?: string;
}

export interface EditorState {
  document: AnnotationDocument;
  saveStatus: SaveStatus;
  lastSavedRevision: number;
  lastSavedAt?: string;
  saveError?: string;
  activeLayerId: string;
  activeTool: ToolMode;
  selectedAnnotationId: string | null;
}

export interface SaveAnnotationPayload {
  schemaVersion: number;
  expectedRevision: number;
  layers: AnnotationLayer[];
  saveReason?: string;
}

export interface SaveAnnotationResponse {
  success: boolean;
  documentId: string;
  revision: number;
  savedAt: string;
  error?: string;
}

export interface GetAnnotationResponse {
  success: boolean;
  document: AnnotationDocument | null;
  revision: number;
  updatedAt?: string;
  error?: string;
}

export interface AnnotationVersionItem {
  id: string;
  documentId: string;
  revision: number;
  savedBy: string | null;
  savedAt: string;
  layerCount: number;
  annotationCount: number;
}
