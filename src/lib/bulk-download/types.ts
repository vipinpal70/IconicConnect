import type { Profile } from '@/src/db/schema/profile'

export type DownloadScope = 'client_output' | 'internal_files'

export type InternalInclude = {
  scan: boolean
  reference: boolean
  teethLibrary: boolean
  outputs: boolean
}

export type SourceRef =
  | { kind: 'r2'; key: string }
  | { kind: 'http'; url: string }
  | { kind: 'text'; content: string }

export type ZipEntryPlan = {
  caseId: string
  caseNumber: string
  /** Path inside the case folder, e.g. `scan/foo.stl`. */
  path: string
  source: SourceRef
  /** Bytes, when known up front (DB column or HEAD). */
  size: number | null
}

export type SkippedItem = { caseId: string | null; caseNumber?: string | null; reason: string }

export type AuthedProfile = Profile
