declare module '3shape-dcm' {
  export interface ParsedDcmMesh {
    vertices: Float32Array
    indices: Uint32Array
    colors: Uint8Array | null
    meta: Record<string, unknown>
  }

  export class HPSError extends Error {
    code: string
  }

  export function parse(input: ArrayBuffer | Uint8Array | string): ParsedDcmMesh
}
