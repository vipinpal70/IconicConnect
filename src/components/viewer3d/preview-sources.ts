import type { ModelPurpose } from './scan-archive';

/** One openable 3D file, labelled by where it came from in the case workflow. */
export interface Model3DSource {
  id: string;
  kind: ModelPurpose;
  /** e.g. "Final Design File", "Design Preview", "Lab Scan" */
  title: string;
  fileName: string;
  url: string;
  uploadedAt?: string | null;
  fileSize?: number | null;
}

/**
 * Shared terminology so the case page and the viewer always describe a preview the same way.
 * Tailwind classes are spelled out in full so the compiler can see them.
 */
export const PREVIEW_KIND_META: Record<
  ModelPurpose,
  { label: string; shortLabel: string; description: string; badgeClass: string; dotClass: string }
> = {
  'case-submission': {
    label: 'Case Submission',
    shortLabel: 'Submitted by lab',
    description: 'Scan files the lab uploaded when the case was created.',
    badgeClass: 'bg-sky-950 text-sky-300 border-sky-800',
    dotClass: 'bg-sky-400',
  },
  'design-output': {
    label: 'Design Output',
    shortLabel: 'Final design',
    description: 'Design files uploaded by the Iconic designer / QC team.',
    badgeClass: 'bg-emerald-950 text-emerald-300 border-emerald-800',
    dotClass: 'bg-emerald-400',
  },
};

/** Formats the viewer can open (kept free of three.js imports so list pages stay light). */
const PREVIEWABLE_EXTENSIONS = /\.(zip|dcm|stl|ply|obj)$/i;

export function isPreviewable3DFile(fileName: string | null | undefined): boolean {
  return Boolean(fileName && PREVIEWABLE_EXTENSIONS.test(fileName.split('?')[0]));
}

/** Best-effort file name from a proxy URL (`...?labName=..&fileName=..`) or a plain path. */
export function fileNameFromUrl(url: string): string {
  const param = /[?&]fileName=([^&]+)/i.exec(url)?.[1];
  const raw = param ? decodeURIComponent(param) : url.split('?')[0];
  return raw.split('/').pop() || raw;
}

export function formatFileSize(bytes: number | null | undefined): string | null {
  if (!bytes || bytes <= 0) return null;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
