"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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

type DownloadInfo = { state: "never" | "downloaded" | "updated"; lastAt: string | null; lastBy: string | null };

type Manifest = {
  cases: Array<{ caseId: string; caseNumber: string | null; files: number; bytes: number; download?: DownloadInfo }>;
  alreadyDownloaded?: Array<{ caseId: string; caseNumber: string | null; lastAt: string; lastBy: string | null }>;
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
function submitDownloadForm(action: string, caseIds: string[], include: Include | undefined, includeDownloaded: boolean) {
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
  if (includeDownloaded) add("includeDownloaded", "true");
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
  canReset = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: Scope;
  caseIds: string[];
  onStarted?: () => void;
  /** Admin only: show a per-case "Reset" that makes an already-downloaded case downloadable again. */
  canReset?: boolean;
}) {
  const queryClient = useQueryClient();
  const [includeDownloaded, setIncludeDownloaded] = useState(false);
  const [resetting, setResetting] = useState<string | null>(null);
  const [include, setInclude] = useState<Include>({ scan: true, reference: true, teethLibrary: true, outputs: false });
  const endpoints = ENDPOINTS[scope];
  const includeKey = scope === "internal_files" ? include : null;

  const { data: manifest, isFetching: loading, error: queryError } = useQuery<Manifest>({
    queryKey: ["bulk-download-manifest", scope, caseIds, includeKey, includeDownloaded],
    enabled: open && caseIds.length > 0,
    gcTime: 0,
    retry: false,
    queryFn: async ({ signal }) => {
      const res = await fetch(endpoints.manifest, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseIds, include, includeDownloaded }),
        signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to prepare download");
      return data as Manifest;
    },
  });
  const error = queryError ? (queryError as Error).message : null;

  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

  const resetCase = async (caseId: string) => {
    setResetting(caseId);
    try {
      await fetch(`/api/admin/cases/${caseId}/bulk-download/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope }),
      });
      await queryClient.invalidateQueries({ queryKey: ["bulk-download-manifest"] });
    } finally {
      setResetting(null);
    }
  };

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

        <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
          <input
            type="checkbox"
            checked={includeDownloaded}
            onChange={(e) => setIncludeDownloaded(e.target.checked)}
          />
          Include cases I already downloaded
        </label>

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
                    <span className="font-medium">
                      {c.caseNumber ?? c.caseId}
                      {c.download?.state === "updated" && (
                        <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                          Updated since download
                        </span>
                      )}
                    </span>
                    <span className="text-muted-foreground">{c.files} file{c.files === 1 ? "" : "s"} · {formatBytes(c.bytes)}</span>
                  </li>
                ))}
              </ul>
              {(manifest.alreadyDownloaded?.length ?? 0) > 0 && (
                <div className="rounded border border-amber-200 bg-amber-50 p-2 text-amber-900">
                  <p className="font-medium">
                    {manifest.alreadyDownloaded!.length} case{manifest.alreadyDownloaded!.length === 1 ? "" : "s"} already downloaded
                    {includeDownloaded ? "" : " — skipped"}
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {manifest.alreadyDownloaded!.map((a) => (
                      <li key={a.caseId} className="flex items-center justify-between gap-2">
                        <span>
                          {a.caseNumber ?? a.caseId} · {fmt(a.lastAt)}{a.lastBy ? ` · ${a.lastBy}` : ""}
                        </span>
                        {canReset && (
                          <button
                            type="button"
                            className="text-[11px] underline disabled:opacity-50"
                            disabled={resetting === a.caseId}
                            onClick={() => resetCase(a.caseId)}
                          >
                            {resetting === a.caseId ? "Resetting…" : "Reset"}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {manifest.skipped.filter((s) => !s.reason.startsWith("Already downloaded")).length > 0 && (
                <details className="text-muted-foreground">
                  <summary className="cursor-pointer">
                    {manifest.skipped.filter((s) => !s.reason.startsWith("Already downloaded")).length} item(s) will be skipped
                  </summary>
                  <ul className="mt-1 list-disc pl-4">
                    {manifest.skipped.filter((s) => !s.reason.startsWith("Already downloaded")).map((s, i) => (
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
              submitDownloadForm(endpoints.download, caseIds, scope === "internal_files" ? include : undefined, includeDownloaded);
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
