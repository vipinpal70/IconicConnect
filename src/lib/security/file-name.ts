/** Upload file names become part of an R2 key (`labName/fileName`) — keep them to a single, plain segment. */
export function isValidUploadFileName(name: unknown): name is string {
  if (typeof name !== 'string') return false
  if (name.length === 0 || name.length > 255) return false
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f/\\]/.test(name)) return false
  if (name === '.' || name === '..') return false
  return true
}
