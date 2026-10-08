/**
 * Upload file names become part of an R2 key (`labName/fileName`). They must be a single, plain segment —
 * except for one strictly-shaped, case-scoped form used by hold-image uploads:
 *   hold-images/<caseId uuid>/<uuid>-<plain file name>
 * (see HoldImagesField / hold_images-plan.md §4.10). Nothing else may contain a path separator, so
 * traversal (`..`, absolute paths, other folders) is still rejected.
 */
const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
// eslint-disable-next-line no-control-regex
const PLAIN_SEGMENT = /^[^\u0000-\u001f\u007f/\\]+$/
const HOLD_IMAGE_KEY = new RegExp(`^hold-images/${UUID}/${UUID}-[^\\u0000-\\u001f\\u007f/\\\\]+$`)

export function isValidUploadFileName(name: unknown): name is string {
  if (typeof name !== 'string') return false
  if (name.length === 0 || name.length > 255) return false
  if (name === '.' || name === '..') return false
  return PLAIN_SEGMENT.test(name) || HOLD_IMAGE_KEY.test(name)
}
