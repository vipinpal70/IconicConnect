'use client';

import React from 'react';
import { Box, Clock, FileArchive, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/src/components/ui/card';
import { Button } from '@/src/components/ui/button';
import { prefetchModel } from './model-cache';
import { PREVIEW_KIND_META, formatFileSize, type Model3DSource } from './preview-sources';
import type { ModelPurpose } from './scan-archive';

interface Case3DPreviewPanelProps {
  submissionSources: Model3DSource[];
  designSources: Model3DSource[];
  /** Case files that would have been previewable but expired under the retention policy. */
  expiredSubmissionCount: number;
  /** False for a lab user before the design is released to them. */
  canSeeDesignOutput: boolean;
  /** Internal staff (designer / QC / admin) see workflow-oriented empty states. */
  isInternal: boolean;
  onOpen: (sourceId: string) => void;
  /** Called on hover/focus of an open button, e.g. to preload the viewer bundle. */
  onIntent?: () => void;
}

const KIND_ACCENT: Record<ModelPurpose, { border: string; dot: string; chip: string }> = {
  'case-submission': {
    border: 'border-sky-200',
    dot: 'bg-sky-500',
    chip: 'bg-sky-50 text-sky-700 border-sky-200',
  },
  'design-output': {
    border: 'border-emerald-200',
    dot: 'bg-emerald-500',
    chip: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
};

function formatDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Two clearly separated 3D previews for a case:
 *  - Case Submission: what the lab uploaded when creating the case
 *  - Design Output:   what the Iconic designer / QC delivered
 */
export function Case3DPreviewPanel({
  submissionSources,
  designSources,
  expiredSubmissionCount,
  canSeeDesignOutput,
  isInternal,
  onOpen,
  onIntent,
}: Case3DPreviewPanelProps) {
  return (
    <Card className="shadow-card bg-white">
      <CardHeader className="py-2.5 px-4 border-b border-border/50">
        <CardTitle className="text-sm font-semibold text-black flex items-center gap-2">
          <Box className="h-4 w-4 text-primary" />
          3D Preview
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <PreviewColumn
          kind="case-submission"
          sources={submissionSources}
          onOpen={onOpen}
          onIntent={onIntent}
          emptyState={
            expiredSubmissionCount > 0 ? (
              <EmptyState
                icon={<AlertTriangle className="h-4 w-4 text-amber-600" />}
                text="The lab's 3D files have expired and are no longer available. Ask an administrator to upload them again."
              />
            ) : (
              <EmptyState
                icon={<FileArchive className="h-4 w-4 text-muted-foreground" />}
                text="No 3D scan files (ZIP, DCM, STL, PLY or OBJ) were uploaded with this case."
              />
            )
          }
        />
        <PreviewColumn
          kind="design-output"
          sources={canSeeDesignOutput ? designSources : []}
          onOpen={onOpen}
          onIntent={onIntent}
          emptyState={
            <EmptyState
              icon={<Clock className="h-4 w-4 text-muted-foreground" />}
              text={
                isInternal
                  ? 'Appears here once the designer or QC uploads the final design files.'
                  : 'Your final design will appear here as soon as it is ready for review.'
              }
            />
          }
        />
      </CardContent>
    </Card>
  );
}

function PreviewColumn({
  kind,
  sources,
  onOpen,
  onIntent,
  emptyState,
}: {
  kind: ModelPurpose;
  sources: Model3DSource[];
  onOpen: (sourceId: string) => void;
  onIntent?: () => void;
  emptyState: React.ReactNode;
}) {
  const meta = PREVIEW_KIND_META[kind];
  const accent = KIND_ACCENT[kind];

  return (
    <section
      aria-label={meta.label}
      className={`flex flex-col rounded-lg border ${accent.border} bg-white p-3 min-w-0`}
    >
      <header className="flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <span className={`h-2 w-2 rounded-full ${accent.dot}`} aria-hidden />
          {meta.label}
        </h4>
        <span className={`text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded border ${accent.chip}`}>
          {meta.shortLabel}
        </span>
      </header>
      <p className="mt-1 text-xs text-muted-foreground">{meta.description}</p>

      <div className="mt-3 flex-1 space-y-2">
        {sources.length === 0
          ? emptyState
          : sources.map((source) => <SourceRow key={source.id} source={source} onOpen={onOpen} onIntent={onIntent} />)}
      </div>
    </section>
  );
}

function SourceRow({
  source,
  onOpen,
  onIntent,
}: {
  source: Model3DSource;
  onOpen: (sourceId: string) => void;
  onIntent?: () => void;
}) {
  const details = [source.title, formatFileSize(source.fileSize), formatDate(source.uploadedAt)].filter(Boolean);
  // Start downloading/parsing on hover or keyboard focus, so the viewer usually opens already loaded
  const warm = () => {
    onIntent?.();
    prefetchModel({ url: source.url, fileName: source.fileName, purpose: source.kind });
  };

  return (
    <div className="flex items-center justify-between gap-3 rounded-md bg-muted/30 px-2.5 py-2">
      <div className="min-w-0">
        <p className="text-xs font-medium text-gray-900 truncate" title={source.fileName}>
          {source.fileName}
        </p>
        <p className="text-[11px] text-muted-foreground truncate">{details.join(' · ')}</p>
      </div>
      <Button
        size="sm"
        variant="outline"
        onPointerEnter={warm}
        onFocus={warm}
        onClick={() => onOpen(source.id)}
        aria-label={`Open ${PREVIEW_KIND_META[source.kind].label} 3D preview: ${source.fileName}`}
        className="shrink-0 h-7 text-xs gap-1.5 border-blue-200 text-blue-700 hover:bg-blue-50"
      >
        <Box className="h-3.5 w-3.5" /> View in 3D
      </Button>
    </div>
  );
}

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span>{text}</span>
    </div>
  );
}
