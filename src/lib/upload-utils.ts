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
 * Uploads a file to R2 via the /api/cases/upload multipart endpoint.
 *
 * Flow (mirrors S3/R2 multipart upload):
 *   1. init     → CreateMultipartUpload, returns { uploadId, key }
 *   2. part x N → UploadPart for each 64MB slice, uploaded in parallel, returns an ETag
 *   3. complete → CompleteMultipartUpload with the ordered { PartNumber, ETag } list
 *
 * Nothing is buffered as a whole file: each request streams a single slice, and the
 * server streams it straight through to R2.
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

    // 2. Upload every part in parallel
    const totalParts = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
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

        const partParams = new URLSearchParams({
          action: "part",
          key,
          uploadId,
          partNumber: String(partNumber),
        });

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
            try {
              const res = JSON.parse(xhr.responseText);
              if (!res.etag) throw new Error("missing ETag");
              etags[index] = { PartNumber: partNumber, ETag: res.etag };
              resolve();
            } catch {
              reject(new Error(`Failed to read part ${partNumber} response`));
            }
          } else {
            reject(new Error(`Part ${partNumber} failed with status ${xhr.status}`));
          }
        };

        xhr.onerror = () => reject(new Error("Network connection error"));

        xhr.open("POST", `/api/cases/upload?${partParams.toString()}`, true);
        xhr.setRequestHeader("Content-Type", "application/octet-stream");
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
      }).catch(() => {});
    }
    onError(err?.message || "Upload aborted");
  }
}
