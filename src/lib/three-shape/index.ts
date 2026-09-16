/**
 * 3Shape DentalContainer extraction — public surface.
 *
 * Runtime port of the read-only toolkit in `scripts/case-xml-extract/`
 * (xml-work-plan.md §2). Nothing here writes to the DB.
 *
 * Typical use (endpoint):
 *   const reader = r2RangeReader(key)
 *   const result = await extractPackage(reader, fileName)
 */
export { extractPackage, type ExtractResult } from './package'
export { r2RangeReader } from './r2-zip'
export { bufferRangeReader, type RangeReader } from './zip'
export { PARSER_VERSION } from './version'
export type { MappedDraft } from './map-to-case'
export type {
  ThreeShapeCase,
  DataQuality,
  DataQualityWarning,
  DataQualityError,
  WarningCode,
  ErrorCode,
  Component,
} from './model'
