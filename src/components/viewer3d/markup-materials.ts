import * as THREE from 'three';

// Pull markup toward the camera so it never z-fights with or sinks into the scan surface
export const OVERLAY_MATERIAL_PROPS = {
  polygonOffset: true,
  polygonOffsetFactor: -4,
  polygonOffsetUnits: -4,
} as const;

/** Highlighter strokes are this many times wider than the selected pen thickness. */
export const HIGHLIGHTER_WIDTH_SCALE = 3;
export const HIGHLIGHTER_OPACITY = 0.4;

/** Stencil value reserved for in-progress previews and selection halos. */
export const RESERVED_STENCIL_REF = 255;

/**
 * A semi-transparent fat line overlaps itself at every joint, which would stack alpha into
 * dark blotches. Writing a per-stroke stencil value and refusing pixels that already carry it
 * draws each pixel once per stroke, while different strokes still blend with each other.
 * Requires the WebGL context to be created with `stencil: true`.
 */
export function highlighterStencilProps(stencilRef: number) {
  return {
    stencilWrite: true,
    stencilRef,
    stencilFunc: THREE.NotEqualStencilFunc,
    stencilZPass: THREE.ReplaceStencilOp,
  } as const;
}
