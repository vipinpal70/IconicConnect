/**
 * Storage names for design outputs and previews.
 *
 * Lab scans live at `<lab>/<original name>` and staff outputs used to as well, so an output named like
 * the scan it was designed from (which the matching rule *requires*) overwrote the lab's original scan.
 * Outputs and previews now get their own case- and upload-scoped folder:
 *
 *   <lab>/case-outputs/<caseId>/<uploadId>/<original name>
 *
 * so they can never collide with a scan, with another case, or with an earlier upload of the same case
 * (a failed re-upload therefore can't clobber the output that is still live). The last segment stays the
 * original name, so downloads keep it. Shape enforced server-side by isValidUploadFileName().
 */

export type CaseFileKind = 'output' | 'preview';

const FOLDER: Record<CaseFileKind, string> = { output: 'case-outputs', preview: 'case-previews' };
const MAX_NAME_LENGTH = 255; // isValidUploadFileName cap for the whole name

function randomId(): string {
  return globalThis.crypto.randomUUID();
}

export function caseScopedStorageName(kind: CaseFileKind, caseId: string, fileName: string, uploadId = randomId()): string {
  const prefix = `${FOLDER[kind]}/${caseId}/${uploadId}/`;
  const room = MAX_NAME_LENGTH - prefix.length;
  // Keep the tail of very long names so the extension survives
  const name = fileName.length > room ? fileName.slice(-room) : fileName;
  return prefix + name;
}

const UPLOAD_FOLDER = 'uploads';
const MAX_UPLOAD_NAME_LENGTH = 200;

/**
 * Storage name for any other upload (lab scans, reference images, chat attachments, teeth library…):
 * `uploads/<uploadId>/<original name>`, chosen by the upload server — so two same-named files never
 * share an object. Names that already carry a case-scoped folder (outputs, previews, hold images) are
 * kept as they are. Existing files keep their old flat `<lab>/<name>` keys and are served unchanged.
 */
export function uploadStorageName(fileName: string, uploadId = randomId()): string {
  if (fileName.includes('/')) return fileName;
  const name = fileName.length > MAX_UPLOAD_NAME_LENGTH ? fileName.slice(-MAX_UPLOAD_NAME_LENGTH) : fileName;
  return `${UPLOAD_FOLDER}/${uploadId}/${name}`;
}

/** The user-facing name: the last path segment of a storage name. */
export function displayFileName(storageName: string): string {
  return storageName.split('/').pop() || storageName;
}

/** Re-name a File for upload under its case-scoped storage name (contents and type unchanged). */
export function withCaseScopedName(kind: CaseFileKind, caseId: string, file: File): File {
  return new File([file], caseScopedStorageName(kind, caseId, file.name), { type: file.type, lastModified: file.lastModified });
}
