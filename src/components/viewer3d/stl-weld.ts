/**
 * Binary STL → indexed mesh in one pass.
 *
 * STL stores every triangle corner separately. three's STLLoader + mergeVertices first builds the
 * full unshared position and normal arrays, then welds them through a string-keyed hash map: ~10 s and
 * several GB of garbage for a 6.6 M-triangle full-arch scan. This reads the file once and welds exactly
 * equal corners (same 32-bit float pattern) through an open-addressing hash table: ~0.7 s, no garbage.
 *
 * Exact matching is correct for STL: shared corners are written from the same float, so they are
 * bit-identical. (mergeVertices' 1e-4 tolerance additionally merges a handful of near-duplicates.)
 */

const HEADER_BYTES = 84
const TRIANGLE_BYTES = 50

export function isBinaryStl(bytes: Uint8Array): boolean {
  if (bytes.byteLength < HEADER_BYTES) return false
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const triangles = view.getUint32(80, true)
  // The size check is authoritative; some binary exporters start the header with "solid"
  return HEADER_BYTES + triangles * TRIANGLE_BYTES === bytes.byteLength
}

/** Raw bits of a little-endian float; -0 is folded into +0 so both weld to the same vertex. */
function floatBits(view: DataView, offset: number): number {
  const bits = view.getUint32(offset, true)
  return bits === 0x80000000 ? 0 : bits
}

export interface WeldedMesh {
  positions: Float32Array
  index: Uint32Array
}

export function weldBinaryStl(bytes: Uint8Array): WeldedMesh {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const triangles = view.getUint32(80, true)
  const corners = triangles * 3

  let tableSize = 1
  while (tableSize < corners * 1.5) tableSize <<= 1
  const mask = tableSize - 1
  const table = new Int32Array(tableSize).fill(-1)
  const keys = new Uint32Array(corners * 3) // raw float bits of each unique vertex
  const index = new Uint32Array(corners)
  let vertexCount = 0

  for (let t = 0; t < triangles; t++) {
    // Skip the 12-byte facet normal; it is recomputed from the welded mesh
    const base = HEADER_BYTES + t * TRIANGLE_BYTES + 12
    for (let c = 0; c < 3; c++) {
      const offset = base + c * 12
      const x = floatBits(view, offset)
      const y = floatBits(view, offset + 4)
      const z = floatBits(view, offset + 8)
      let slot = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & mask
      for (;;) {
        const id = table[slot]
        if (id === -1) {
          table[slot] = vertexCount
          keys[vertexCount * 3] = x
          keys[vertexCount * 3 + 1] = y
          keys[vertexCount * 3 + 2] = z
          index[t * 3 + c] = vertexCount++
          break
        }
        if (keys[id * 3] === x && keys[id * 3 + 1] === y && keys[id * 3 + 2] === z) {
          index[t * 3 + c] = id
          break
        }
        slot = (slot + 1) & mask
      }
    }
  }

  // Same bits, reinterpreted as floats (copy so the large scratch buffer can be freed)
  const positions = new Float32Array(keys.buffer, 0, vertexCount * 3).slice()
  return { positions, index }
}
