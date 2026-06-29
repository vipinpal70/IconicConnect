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

/**
 * Uploads a file to the Next.js /api/cases/upload endpoint using parallel chunk streams.
 * Fallbacks to standard single chunk if the file is small (< 10MB).
 */
export async function uploadFileInChunks(
  file: File,
  options: UploadOptions,
  onProgress: UploadProgressCallback,
  onSuccess: UploadSuccessCallback,
  onError: UploadErrorCallback
) {
  const CHUNK_SIZE = 64 * 1024 * 1024; // 64MB chunks

  // If the file is smaller than 10MB, upload it as a single chunk/file
  if (file.size <= CHUNK_SIZE) {
    try {
      let url = `/api/cases/upload?fileName=${encodeURIComponent(file.name)}`;
      if (options.clientId) {
        url += `&clientId=${encodeURIComponent(options.clientId)}`;
      }

      const xhr = new XMLHttpRequest();
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            onSuccess(JSON.parse(xhr.responseText));
          } catch {
            onError("Failed to parse upload response");
          }
        } else {
          onError(`Upload failed with status ${xhr.status}`);
        }
      };

      xhr.onerror = () => onError("Network upload error");
      xhr.open("POST", url, true);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      xhr.send(file);
    } catch (err: any) {
      onError(err.message || "Upload initialization failed");
    }
    return;
  }

  // Large file Chunked Upload
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  const uploadId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const loadedSizes = new Array(totalChunks).fill(0);

  // Queue of chunk indices to upload
  const chunkQueue = Array.from({ length: totalChunks }, (_, i) => i);
  const activeUploads = new Set<Promise<void>>();
  let hasFailed = false;
  let finalResponse: any = null;

  const uploadNextChunk = async (): Promise<void> => {
    if (chunkQueue.length === 0 || hasFailed) return;

    const chunkIndex = chunkQueue.shift()!;
    const start = chunkIndex * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunkBlob = file.slice(start, end);

    let url = `/api/cases/upload?fileName=${encodeURIComponent(file.name)}&chunkIndex=${chunkIndex}&totalChunks=${totalChunks}&uploadId=${uploadId}`;
    if (options.clientId) {
      url += `&clientId=${encodeURIComponent(options.clientId)}`;
    }

    const uploadPromise = new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          loadedSizes[chunkIndex] = event.loaded;
          const totalLoaded = loadedSizes.reduce((sum, size) => sum + size, 0);
          const percent = Math.min(Math.round((totalLoaded / file.size) * 100), 99); // Max 99% until server merges and confirms
          onProgress(percent);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const res = JSON.parse(xhr.responseText);
            if (res && res.fileUrl) {
              finalResponse = res;
            }
            resolve();
          } catch {
            reject(new Error("Failed to parse chunk response"));
          }
        } else {
          reject(new Error(`Chunk ${chunkIndex} upload failed with status ${xhr.status}`));
        }
      };

      xhr.onerror = () => reject(new Error("Network connection error"));

      xhr.open("POST", url, true);
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      xhr.send(chunkBlob);
    });

    activeUploads.add(uploadPromise);

    try {
      await uploadPromise;
      activeUploads.delete(uploadPromise);

      // Request next chunk recursively
      await uploadNextChunk();
    } catch (err) {
      hasFailed = true;
      activeUploads.delete(uploadPromise);
      throw err;
    }
  };

  // Limit parallel requests (concurrency pool size = 10)
  const concurrencyLimit = Math.min(10, totalChunks);
  const uploadThreads = [];

  for (let i = 0; i < concurrencyLimit; i++) {
    uploadThreads.push(uploadNextChunk());
  }

  try {
    await Promise.all(uploadThreads);
    // Use the final merge response containing file details
    if (finalResponse) {
      onProgress(100);
      onSuccess(finalResponse);
    } else {
      onError("Upload complete, but failed to retrieve file assembly confirmation.");
    }
  } catch (err: any) {
    onError(err.message || "Upload aborted");
  }
}
