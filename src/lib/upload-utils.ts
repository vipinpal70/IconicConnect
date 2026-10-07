interface UploadProgressCallback {
  (progress: number): void;
}

interface UploadSuccessCallback {
  (response: any): void;
}

interface UploadErrorCallback {
  (error: string): void;
}

interface UploadOptions {
  clientId?: string | null;
  role?: "client" | "admin" | "subuser" | string;
}

const CHUNK_SIZE = 64 * 1024 * 1024; // 64MB parts
const CONCURRENCY = 10;

async function safeJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Uploads a file to R2 via presigned multipart upload.
 *
 * Flow (mirrors S3/R2 multipart upload):
 *   1. init     → server CreateMultipartUpload, returns { uploadId, key }
 *   2. sign     → server returns a presigned UploadPart URL per part
 *   3. PUT x N  → browser uploads each 64MB slice DIRECTLY to R2 in parallel,
 *                 reading the ETag from each response
 *   4. complete → server CompleteMultipartUpload with the ordered { PartNumber, ETag } list
 *
 * Part bytes never pass through our server, so upload bandwidth isn't doubled and
 * parallel parts can saturate the client's full uplink.
 */
export async function uploadFileInChunks(
  file: File,
  options: UploadOptions,
  onProgress: UploadProgressCallback,
  onSuccess: UploadSuccessCallback,
  onError: UploadErrorCallback
) {
  let initData: { uploadId: string; key: string; labName: string; fileName: string; fileUrl: string } | null = null;

  try {
    // 1. Initialise the multipart upload
    const initParams = new URLSearchParams({
      action: "init",
      fileName: file.name,
      fileType: file.type || "application/octet-stream",
      fileSize: String(file.size),
    });
    if (options.clientId) initParams.set("clientId", options.clientId);

    const initRes = await fetch(`/api/cases/upload?${initParams.toString()}`, { method: "POST" });
    if (!initRes.ok) {
      throw new Error((await safeJson(initRes))?.error || `Failed to start upload (${initRes.status})`);
    }
    initData = await initRes.json();
    const { uploadId, key } = initData!;

    const totalParts = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));

    // 2. Get a presigned UploadPart URL for every part
    const signRes = await fetch(`/api/cases/upload?action=sign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, uploadId, totalParts }),
    });
    if (!signRes.ok) {
      throw new Error((await safeJson(signRes))?.error || `Failed to sign upload (${signRes.status})`);
    }
    const { urls } = (await signRes.json()) as { urls: Array<{ partNumber: number; url: string }> };
    const urlByPart = new Map(urls.map((u) => [u.partNumber, u.url]));

    // 3. PUT every part directly to R2, in parallel
    const loadedSizes = new Array(totalParts).fill(0);
    const etags = new Array<{ PartNumber: number; ETag: string } | null>(totalParts).fill(null);
    const queue = Array.from({ length: totalParts }, (_, i) => i);
    let failed = false;

    const uploadPart = (index: number) =>
      new Promise<void>((resolve, reject) => {
        const start = index * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const blob = file.slice(start, end);
        const partNumber = index + 1;
        const signedUrl = urlByPart.get(partNumber);

        if (!signedUrl) {
          reject(new Error(`Missing signed URL for part ${partNumber}`));
          return;
        }

        const xhr = new XMLHttpRequest();

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            loadedSizes[index] = event.loaded;
            const totalLoaded = loadedSizes.reduce((sum, size) => sum + size, 0);
            // Cap at 99% until CompleteMultipartUpload confirms assembly
            onProgress(Math.min(Math.round((totalLoaded / file.size) * 100), 99));
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            // R2 returns the part's ETag in the response header (exposed via CORS)
            const etag = xhr.getResponseHeader("ETag");
            if (!etag) {
              reject(new Error(`Part ${partNumber} did not return an ETag (check R2 CORS ExposeHeaders)`));
              return;
            }
            etags[index] = { PartNumber: partNumber, ETag: etag };
            resolve();
          } else {
            reject(new Error(`Part ${partNumber} failed with status ${xhr.status}`));
          }
        };

        xhr.onerror = () => reject(new Error("Network connection error"));

        // PUT straight to R2 — the auth is carried in the presigned URL query string
        xhr.open("PUT", signedUrl, true);
        xhr.send(blob);
      });

    const worker = async (): Promise<void> => {
      while (!failed) {
        const index = queue.shift();
        if (index === undefined) return;
        await uploadPart(index);
      }
    };

    try {
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, totalParts) }, () => worker())
      );
    } catch (err) {
      failed = true;
      throw err;
    }

    // 3. Complete the upload
    const parts = etags.filter((p): p is { PartNumber: number; ETag: string } => p !== null);
    const completeRes = await fetch(`/api/cases/upload?action=complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key,
        uploadId,
        labName: initData!.labName,
        fileName: initData!.fileName,
        fileSize: file.size,
        fileType: file.type || "application/octet-stream",
        parts,
      }),
    });
    if (!completeRes.ok) {
      throw new Error((await safeJson(completeRes))?.error || `Failed to finalise upload (${completeRes.status})`);
    }

    const finalResponse = await completeRes.json();
    onProgress(100);
    onSuccess(finalResponse);
  } catch (err: any) {
    // Best-effort cleanup so R2 doesn't accumulate dangling multipart uploads
    if (initData) {
      fetch(`/api/cases/upload?action=abort`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: initData.key, uploadId: initData.uploadId }),
      }).catch(() => { });
    }
    onError(err?.message || "Upload aborted");
  }
}

export interface BulkUploadResult {
  storageKey: string;
  fileName: string;
  fileSize: number | null;
  fileType: string;
}

/**
 * Upload a design-output file to R2 via the INDEPENDENT bulk endpoint
 * (`/api/cases/bulk/upload`). Mirrors {@link uploadFileInChunks} but the object is staged
 * under `bulk-staging/<uploaderId>/…` and the resolved `storageKey` is returned so the
 * caller can later match/confirm or delete it. Existing single-upload callers are unaffected.
 */
export async function uploadBulkFile(
  file: File,
  onProgress: UploadProgressCallback,
): Promise<BulkUploadResult> {
  let initData: { uploadId: string; storageKey: string; fileName: string } | null = null;

  try {
    // 1. Init
    const initParams = new URLSearchParams({
      action: "init",
      fileName: file.name,
      fileType: file.type || "application/octet-stream",
      fileSize: String(file.size),
    });
    const initRes = await fetch(`/api/cases/bulk/upload?${initParams.toString()}`, { method: "POST" });
    if (!initRes.ok) {
      throw new Error((await safeJson(initRes))?.error || `Failed to start upload (${initRes.status})`);
    }
    initData = await initRes.json();
    const { uploadId, storageKey } = initData!;

    const totalParts = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));

    // 2. Sign
    const signRes = await fetch(`/api/cases/bulk/upload?action=sign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storageKey, uploadId, totalParts }),
    });
    if (!signRes.ok) {
      throw new Error((await safeJson(signRes))?.error || `Failed to sign upload (${signRes.status})`);
    }
    const { urls } = (await signRes.json()) as { urls: Array<{ partNumber: number; url: string }> };
    const urlByPart = new Map(urls.map((u) => [u.partNumber, u.url]));

    // 3. PUT every part directly to R2, in parallel
    const loadedSizes = new Array(totalParts).fill(0);
    const etags = new Array<{ PartNumber: number; ETag: string } | null>(totalParts).fill(null);
    const queue = Array.from({ length: totalParts }, (_, i) => i);
    let failed = false;

    const uploadPart = (index: number) =>
      new Promise<void>((resolve, reject) => {
        const start = index * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const blob = file.slice(start, end);
        const partNumber = index + 1;
        const signedUrl = urlByPart.get(partNumber);

        if (!signedUrl) {
          reject(new Error(`Missing signed URL for part ${partNumber}`));
          return;
        }

        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            loadedSizes[index] = event.loaded;
            const totalLoaded = loadedSizes.reduce((sum, size) => sum + size, 0);
            onProgress(Math.min(Math.round((totalLoaded / file.size) * 100), 99));
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            const etag = xhr.getResponseHeader("ETag");
            if (!etag) {
              reject(new Error(`Part ${partNumber} did not return an ETag (check R2 CORS ExposeHeaders)`));
              return;
            }
            etags[index] = { PartNumber: partNumber, ETag: etag };
            resolve();
          } else {
            reject(new Error(`Part ${partNumber} failed with status ${xhr.status}`));
          }
        };
        xhr.onerror = () => reject(new Error("Network connection error"));
        xhr.open("PUT", signedUrl, true);
        xhr.send(blob);
      });

    const worker = async (): Promise<void> => {
      while (!failed) {
        const index = queue.shift();
        if (index === undefined) return;
        await uploadPart(index);
      }
    };

    try {
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, totalParts) }, () => worker()));
    } catch (err) {
      failed = true;
      throw err;
    }

    // 4. Complete
    const parts = etags.filter((p): p is { PartNumber: number; ETag: string } => p !== null);
    const completeRes = await fetch(`/api/cases/bulk/upload?action=complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storageKey,
        uploadId,
        fileName: initData!.fileName,
        fileSize: file.size,
        fileType: file.type || "application/octet-stream",
        parts,
      }),
    });
    if (!completeRes.ok) {
      throw new Error((await safeJson(completeRes))?.error || `Failed to finalise upload (${completeRes.status})`);
    }

    const finalResponse = (await completeRes.json()) as BulkUploadResult;
    onProgress(100);
    return finalResponse;
  } catch (err: unknown) {
    if (initData) {
      fetch(`/api/cases/bulk/upload?action=abort`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storageKey: initData.storageKey, uploadId: initData.uploadId }),
      }).catch(() => {});
    }
    throw new Error(err instanceof Error ? err.message : "Upload aborted");
  }
}
