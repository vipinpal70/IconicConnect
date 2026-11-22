/**
 * 3D Dental CAD / DICOM Platform — Annotation & Explicit Save Data Types
 * Document Version: 2.0
 */

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error';

export type ToolMode =
  | 'orbit'
  | 'brush'
  | 'highlighter'
  | 'polyline'
  | 'distance'
  | 'angle'
  | 'pin'
  | 'arrow'
  | 'eraser'
  | 'select';

export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

export interface BaseAnnotation {
  id: string;
  layerId: string;
  type: 'brush' | 'polyline' | 'distance' | 'angle' | 'pin' | 'arrow';
  color: string;
  lineWidth?: number;
  createdAt: string;
  authorRole?: string;
  authorName?: string;
}

export interface BrushAnnotation extends BaseAnnotation {
  type: 'brush';
  points: Vector3D[]; // Model-space 3D coordinates
  style?: 'pen' | 'highlighter'; // Absent = pen
}

/** Click-placed path that follows the scan surface (e.g. margin line, outline). */
export interface PolylineAnnotation extends BaseAnnotation {
  type: 'polyline';
  points: Vector3D[]; // Dense surface-following path
  vertices: Vector3D[]; // User-placed control points
  closed: boolean;
  lengthMm: number;
}

export interface AngleAnnotation extends BaseAnnotation {
  type: 'angle';
  startPoint: Vector3D;
  vertex: Vector3D;
  endPoint: Vector3D;
  angleDeg: number;
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
  | PolylineAnnotation
  | DistanceAnnotation
  | AngleAnnotation
  | PinAnnotation
  | ArrowAnnotation;

/**
 * Which 3D preview a layer was drawn on: the lab's case submission or the final design output.
 * Absent on layers saved before the split (those were drawn on the case submission).
 */
export type AnnotationSource = 'case-submission' | 'design-output';

export interface AnnotationLayer {
  id: string;
  name: string;
  source?: AnnotationSource;
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
