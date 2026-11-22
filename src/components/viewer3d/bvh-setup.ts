import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

let isBvhInitialized = false;

/**
 * Initialize BVH (Bounding Volume Hierarchy) acceleration for Three.js raycasting.
 * Enables 60fps surface picking and drawing on dense dental meshes.
 */
export function initBvhAcceleration() {
  if (isBvhInitialized) return;

  (THREE.BufferGeometry.prototype as unknown as { computeBoundsTree: typeof computeBoundsTree }).computeBoundsTree = computeBoundsTree;
  (THREE.BufferGeometry.prototype as unknown as { disposeBoundsTree: typeof disposeBoundsTree }).disposeBoundsTree = disposeBoundsTree;
  THREE.Mesh.prototype.raycast = acceleratedRaycast;

  isBvhInitialized = true;
}
