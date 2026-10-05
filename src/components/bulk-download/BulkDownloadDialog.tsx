"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Download } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";

type Scope = "client_output" | "internal_files";

type Manifest = {
  cases: Array<{ caseId: string; caseNumber: string | null; files: number; bytes: number }>;
  skipped: Array<{ caseId: string | null; caseNumber?: string | null; reason: string }>;
  totalFiles: number;
  totalBytes: number;
  maxBytes: number;
  overLimit: boolean;
};

type Include = { scan: boolean; reference: boolean; teethLibrary: boolean; outputs: boolean };

const ENDPOINTS: Record<Scope, { manifest: string; download: string }> = {
  client_output: {
    manifest: "/api/client/cases/bulk-download/manifest",
    download: "/api/client/cases/bulk-download",
  },
  internal_files: {
    manifest: "/api/cases/bulk/download/manifest",
    download: "/api/cases/bulk/download",
  },
};

function formatBytes(n: number) {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

/** Hidden form POST — the browser streams the ZIP straight to disk (no JS memory use). */
function submitDownloadForm(action: string, caseIds: string[], include?: Include) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = action;
  form.target = "_blank";
  form.style.display = "none";
  const add = (name: string, value: string) => {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  };
  add("caseIds", JSON.stringify(caseIds));
  if (include) add("include", JSON.stringify(include));
  document.body.appendChild(form);
  form.submit();
  form.remove();
}

export function BulkDownloadDialog({
  open,
  onOpenChange,
  scope,
  caseIds,
  onStarted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: Scope;
  caseIds: string[];
  onStarted?: () => void;
}) {
  const [include, setInclude] = useState<Include>({ scan: true, reference: true, teethLibrary: true, outputs: false });
  const endpoints = ENDPOINTS[scope];
  const includeKey = scope === "internal_files" ? include : null;

  const { data: manifest, isFetching: loading, error: queryError } = useQuery<Manifest>({
    queryKey: ["bulk-download-manifest", scope, caseIds, includeKey],
    enabled: open && caseIds.length > 0,
    gcTime: 0,
    retry: false,
    queryFn: async ({ signal }) => {
      const res = await fetch(endpoints.manifest, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseIds, include }),
        signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to prepare download");
      return data as Manifest;
    },
  });
  const error = queryError ? (queryError as Error).message : null;

  const canDownload = !loading && !error && manifest && manifest.totalFiles > 0 && !manifest.overLimit;
  const includeOptions: Array<[keyof Include, string]> = [
    ["scan", "Scan files"],
    ["reference", "Reference images"],
    ["teethLibrary", "Teeth library"],
    ["outputs", "Design outputs & previews"],
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{scope === "client_output" ? "Download case outputs" : "Download case files"}</DialogTitle>
          <DialogDescription>
            {caseIds.length} case{caseIds.length === 1 ? "" : "s"} selected. Files are bundled into one ZIP, one folder per case.
          </DialogDescription>
        </DialogHeader>

        {scope === "internal_files" && (
          <div className="grid grid-cols-2 gap-2">
            {includeOptions.map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={include[key]}
                  onChange={(e) => setInclude((p) => ({ ...p, [key]: e.target.checked }))}
                />
                {label}
              </label>
            ))}
          </div>
        )}

        <div className="min-h-24 text-xs space-y-2">
          {loading && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking files…
            </div>
          )}
          {error && <p className="text-red-600">{error}</p>}
          {!loading && !error && manifest && (
            <>
              <p className="font-semibold">
                {manifest.totalFiles} file{manifest.totalFiles === 1 ? "" : "s"} · {formatBytes(manifest.totalBytes)}
              </p>
              {manifest.overLimit && (
                <p className="text-red-600">
                  Over the {formatBytes(manifest.maxBytes)} limit — select fewer cases.
                </p>
              )}
              <ul className="max-h-40 overflow-y-auto divide-y border rounded">
                {manifest.cases.map((c) => (
                  <li key={c.caseId} className="flex justify-between px-2 py-1">
                    <span className="font-medium">{c.caseNumber ?? c.caseId}</span>
                    <span className="text-muted-foreground">{c.files} file{c.files === 1 ? "" : "s"} · {formatBytes(c.bytes)}</span>
                  </li>
                ))}
              </ul>
              {manifest.skipped.length > 0 && (
                <details className="text-muted-foreground">
                  <summary className="cursor-pointer">{manifest.skipped.length} item(s) will be skipped</summary>
                  <ul className="mt-1 list-disc pl-4">
                    {manifest.skipped.map((s, i) => (
                      <li key={i}>{s.caseNumber ?? s.caseId ?? "—"}: {s.reason}</li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            size="sm"
            disabled={!canDownload}
            onClick={() => {
              submitDownloadForm(endpoints.download, caseIds, scope === "internal_files" ? include : undefined);
              onOpenChange(false);
              onStarted?.();
            }}
          >
            <Download className="h-3.5 w-3.5 mr-1.5" /> Download ZIP
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
